/**
 * The nine hydration / parity queries, each reachable from a Data Browser tab.
 *
 * Spec §2.2 lists them as one row; that row is only honest if every one of
 * them can actually be RUN from the screen. So each spec below records not
 * just the document but the tab it hangs off and the input that reaches it —
 * and `tests/data/hydrate.test.ts` asserts every id has a home tab, so a query
 * cannot be defined here and quietly orphaned.
 *
 * The awkward cases are the interesting ones, and none of them are smoothed:
 *
 * - **`employeesByIds`** hangs off a tab with ZERO rows on the sandbox. A
 *   row-click cannot reach it, so the employees tab exposes an id box in its
 *   empty state. An empty result from a real query is a real result.
 * - **`discountQuote`** and **`discountsByCodes`** need a coupon code, which
 *   no order row carries. The orders detail pane takes the codes as input and
 *   quotes them against that order's real `totalMinor` — the order supplies
 *   the money, the merchant supplies the code.
 * - **`ledgerPostings`** takes app REFERENCES, not account ids. It is reached
 *   from the accounts tab because that is where a merchant reconciling the
 *   books already is, and the pane says plainly that an unknown reference
 *   returns an empty list rather than an error.
 * - **`locationsOfKind`** returns SERVICE locations (tables/rooms), not
 *   outlets. It sits on the outlets tab as the adjacent read a merchant wants
 *   there, labelled as a different resource — see `lib/data/proxy.ts` for why
 *   the two must never be conflated.
 */

import { classifyGraphQLErrors, type SyncError } from '@/lib/sync/errors';
import { callGraphQL, type CallMeta, type TransportBridge } from './transport';
import type { DataTabSlug } from './views';

export type HydrationId =
  | 'catalogSearch'
  | 'partySearch'
  | 'discountsByCodes'
  | 'discountQuote'
  | 'locationsOfKind'
  | 'ledgerPostings'
  | 'cmsEntryBody'
  | 'employeesByIds'
  | 'mediaItems';

/** How the pane collects the query's argument. */
export type HydrationInputKind =
  /** One free-text term (a search). */
  | 'term'
  /** A comma-separated list (ids, codes, references). */
  | 'list'
  /** A single id, prefilled from the selected row. */
  | 'id'
  /** A list of codes quoted against the selected row's total. */
  | 'codes-with-total';

export interface HydrationColumn {
  key: string;
  label: string;
}

export interface HydrationSpec {
  id: HydrationId;
  /** GraphQL root field, which is also the key in `data`. */
  field: string;
  label: string;
  /** The tab whose detail pane runs it. */
  tab: DataTabSlug;
  /** Scope the platform checks. Shown so a denial is legible. */
  scope: string;
  /** What the pane is for, in one sentence, on screen. */
  blurb: string;
  input: HydrationInputKind;
  inputLabel: string;
  /** Prefilled from the selected row's field, when there is one. */
  prefillFrom: string | null;
  /** Placeholder shown when nothing prefills it. */
  placeholder: string;
  query: string;
  /** Build variables from the pane's input. */
  variables: (input: HydrationRunInput) => Record<string, unknown>;
  /** Columns for the result table. `body` results render as one row. */
  columns: HydrationColumn[];
  /** What an empty result MEANS here — never "something went wrong". */
  emptyMeaning: string;
}

export interface HydrationRunInput {
  /** Raw text from the pane's single input. */
  value: string;
  /** The selected row's `totalMinor`, for `discountQuote`. */
  totalMinor?: number | null;
  limit?: number | null;
}

/** Split a comma/space separated list into trimmed, non-empty entries. */
export function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export const HYDRATIONS: Record<HydrationId, HydrationSpec> = {
  partySearch: {
    id: 'partySearch',
    field: 'partySearch',
    label: 'partySearch(term, limit)',
    tab: 'customers',
    scope: 'read:customers',
    blurb:
      'PartyPort::search over the platform, not over the rows this screen walked. Prefilled from the selected customer so you can see the server agree with the walk — and disagree when the walk is stale.',
    input: 'term',
    inputLabel: 'Search term',
    prefillFrom: 'name',
    placeholder: 'Name, phone or email',
    query: `query ShowcasePartySearch($term: String!, $limit: Int) {
  partySearch(term: $term, limit: $limit) {
    id name phone email isActive storefrontCustomerId balanceMinorUnits
  }
}`,
    variables: (input) => ({ term: input.value.trim(), limit: input.limit ?? 25 }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'isActive', label: 'Active' },
      { key: 'balanceMinorUnits', label: 'Balance (minor)' },
    ],
    emptyMeaning:
      'No ACTIVE party matched. The port searches active parties only, so an inactive customer visible in the table above will legitimately not appear here.',
  },

  catalogSearch: {
    id: 'catalogSearch',
    field: 'catalogSearch',
    label: 'catalogSearch(term, limit)',
    tab: 'items',
    scope: 'read:catalog',
    blurb:
      'The server-side term search, as opposed to the FilterBar above which filters the walked rows. Running both on the same term is the clearest way to see which side answered.',
    input: 'term',
    inputLabel: 'Search term',
    prefillFrom: 'name',
    placeholder: 'Item name or SKU',
    query: `query ShowcaseCatalogSearch($term: String!, $limit: Int) {
  catalogSearch(term: $term, limit: $limit) {
    id name sku priceMinor isActive categoryId imageUrl
  }
}`,
    variables: (input) => ({ term: input.value.trim(), limit: input.limit ?? 25 }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'name', label: 'Name' },
      { key: 'sku', label: 'SKU' },
      { key: 'priceMinor', label: 'Price (minor)' },
      { key: 'isActive', label: 'Active' },
    ],
    emptyMeaning: 'No ACTIVE item matched the term. Inactive items are not searched.',
  },

  discountsByCodes: {
    id: 'discountsByCodes',
    field: 'discountsByCodes',
    label: 'discountsByCodes(codes)',
    tab: 'orders',
    scope: 'read:discounts',
    blurb:
      'Coupon definitions for the codes you name. Matching is case-insensitive platform-side and each row carries its own `code`, so correlate on the field — never on list position.',
    input: 'list',
    inputLabel: 'Coupon codes',
    prefillFrom: null,
    placeholder: 'WELCOME10, SUMMER',
    query: `query ShowcaseDiscountsByCodes($codes: [String!]!) {
  discountsByCodes(codes: $codes) {
    id code type value isActive minimumOrderMinor maximumDiscountMinor startsAt expiresAt
  }
}`,
    variables: (input) => ({ codes: splitList(input.value) }),
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'type', label: 'Type' },
      { key: 'value', label: 'Value' },
      { key: 'isActive', label: 'Active' },
      { key: 'minimumOrderMinor', label: 'Min order (minor)' },
      { key: 'expiresAt', label: 'Expires' },
    ],
    emptyMeaning:
      'None of those codes exist on this profile. An unknown code is absent from the result rather than an error, which is why you correlate on `code`.',
  },

  discountQuote: {
    id: 'discountQuote',
    field: 'discountQuote',
    label: 'discountQuote(quotes)',
    tab: 'orders',
    scope: 'read:discounts',
    blurb:
      "The platform computes the amount against the SELECTED order's real `totalMinor`. Server-authoritative by construction: an app must never recompute a discount from the `Discount` fields, because the two would drift and the customer would find out first.",
    input: 'codes-with-total',
    inputLabel: 'Coupon codes to quote',
    prefillFrom: null,
    placeholder: 'WELCOME10, SUMMER',
    query: `query ShowcaseDiscountQuote($quotes: [DiscountQuoteInput!]!) {
  discountQuote(quotes: $quotes) {
    code discountMinor
  }
}`,
    variables: (input) => ({
      quotes: splitList(input.value).map((code) => ({
        code,
        orderTotalMinor: Math.max(0, Math.trunc(input.totalMinor ?? 0)),
      })),
    }),
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'discountMinor', label: 'Discount (minor)' },
    ],
    emptyMeaning:
      'No quotes were requested. Note an unknown, expired or exhausted code quotes 0 rather than erroring — a zero row is an answer, not a failure.',
  },

  locationsOfKind: {
    id: 'locationsOfKind',
    field: 'locationsOfKind',
    label: 'locationsOfKind(kind, limit)',
    tab: 'outlets',
    scope: 'read:locations',
    blurb:
      'Service locations of one kind — `table` or `room`. A DIFFERENT resource from the outlet rows above: outlets are business units, locations are the seats inside them. The two are adjacent, never interchangeable.',
    input: 'term',
    inputLabel: 'Kind',
    prefillFrom: null,
    placeholder: 'table',
    query: `query ShowcaseLocationsOfKind($kind: String!, $limit: Int) {
  locationsOfKind(kind: $kind, limit: $limit) {
    id kind name code capacity isActive enablesOrders outletId isOccupied currentOrderNumber
  }
}`,
    variables: (input) => ({ kind: input.value.trim() || 'table', limit: input.limit ?? 200 }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'capacity', label: 'Capacity' },
      { key: 'outletId', label: 'Outlet' },
      { key: 'isOccupied', label: 'Occupied' },
    ],
    emptyMeaning:
      'This profile has no ACTIVE locations of that kind. Try the other kind — a retail profile legitimately has neither.',
  },

  ledgerPostings: {
    id: 'ledgerPostings',
    field: 'ledgerPostings',
    label: 'ledgerPostings(references)',
    tab: 'accounts',
    scope: 'read:ledger',
    blurb:
      "The read half of the ledger: postings this app previously made, looked up by the app's OWN references. Requires read:ledger, not write:ledger — reconciling is a strictly weaker grant than posting, and the platform draws that line for you.",
    input: 'list',
    inputLabel: 'App references',
    prefillFrom: null,
    placeholder: 'showcase-demo-1, showcase-demo-2',
    query: `query ShowcaseLedgerPostings($references: [String!]!) {
  ledgerPostings(references: $references) {
    reference transactionId transactionNumber typeSlug amountMinor postedAt wasAlreadyPosted
  }
}`,
    variables: (input) => ({ references: splitList(input.value) }),
    columns: [
      { key: 'reference', label: 'Reference' },
      { key: 'transactionNumber', label: 'Txn' },
      { key: 'typeSlug', label: 'Type' },
      { key: 'amountMinor', label: 'Amount (minor)' },
      { key: 'postedAt', label: 'Posted' },
    ],
    emptyMeaning:
      'No posting exists for those references. This app has not posted to the ledger — the Ledger playground is where a reference gets created — so an empty result here is the expected answer, not a fault.',
  },

  cmsEntryBody: {
    id: 'cmsEntryBody',
    field: 'cmsEntryBody',
    label: 'cmsEntryBody(id)',
    tab: 'cms',
    scope: 'read:content',
    blurb:
      'The long-form body of ONE entry. The list query returns body-free summaries on purpose so a walk over a thousand entries stays cheap; this is the second half of that split.',
    input: 'id',
    inputLabel: 'Entry id',
    prefillFrom: 'id',
    placeholder: '1',
    query: `query ShowcaseCmsEntryBody($id: ID!) {
  cmsEntryBody(id: $id) { id html plainText }
}`,
    variables: (input) => ({ id: input.value.trim() }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'plainText', label: 'Plain text' },
    ],
    emptyMeaning:
      'An unknown, other-profile or UNPUBLISHED id yields an empty body rather than an error — so an empty body on a draft entry is the documented behaviour, not a missing record.',
  },

  employeesByIds: {
    id: 'employeesByIds',
    field: 'employeesByIds',
    label: 'employeesByIds(ids)',
    tab: 'employees',
    scope: 'read:employees',
    blurb:
      'The by-id read the webhook fast path uses. This sandbox profile has zero employees, so there is no row to click — the query is run from here against ids you name, and an empty answer is a real answer from a real query.',
    input: 'list',
    inputLabel: 'Employee ids',
    prefillFrom: 'id',
    placeholder: '1, 2, 3',
    query: `query ShowcaseEmployeesByIds($ids: [ID!]!) {
  employeesByIds(ids: $ids) {
    id name employeeCode department position status updatedAt
  }
}`,
    variables: (input) => ({ ids: splitList(input.value) }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'name', label: 'Name' },
      { key: 'employeeCode', label: 'Code' },
      { key: 'department', label: 'Department' },
      { key: 'status', label: 'Status' },
    ],
    emptyMeaning:
      'No employee with those ids exists on this profile. The scope IS granted and the query DID run — this profile has none.',
  },

  mediaItems: {
    id: 'mediaItems',
    field: 'mediaItems',
    label: 'mediaItems(ids)',
    tab: 'media',
    scope: 'read:media',
    blurb:
      'The by-id media read. Prefilled from the selected asset, so the detail pane is the hydration query rather than a re-render of the row already in memory.',
    input: 'list',
    inputLabel: 'Media ids',
    prefillFrom: 'id',
    placeholder: '1, 2',
    query: `query ShowcaseMediaItems($ids: [ID!]!) {
  mediaItems(ids: $ids) {
    id url collection filename mimeType size width height alt updatedAt
  }
}`,
    variables: (input) => ({ ids: splitList(input.value) }),
    columns: [
      { key: 'id', label: 'Id' },
      { key: 'filename', label: 'File' },
      { key: 'collection', label: 'Collection' },
      { key: 'mimeType', label: 'Type' },
      { key: 'size', label: 'Bytes' },
    ],
    emptyMeaning: 'No asset with those ids exists on this profile.',
  },
};

export const HYDRATION_IDS = Object.keys(HYDRATIONS) as HydrationId[];

/** Every hydration query a tab can reach. Drives the detail pane's sub-tabs. */
export function hydrationsForTab(tab: DataTabSlug): HydrationSpec[] {
  return HYDRATION_IDS.map((id) => HYDRATIONS[id]).filter((spec) => spec.tab === tab);
}

export interface HydrationResult {
  /** Always a list, even for `cmsEntryBody` — one row for a single object. */
  rows: Record<string, unknown>[];
  meta: CallMeta;
  error: SyncError | null;
  /** True when the query ran and the platform returned nothing. */
  empty: boolean;
}

/**
 * Run one hydration query.
 *
 * There is no proxy plan for any of these: none of the nine has an allow-listed
 * REST path (`parties` and `catalog/items` are SEARCHES with different shapes,
 * and substituting one for `employeesByIds` would answer a different question).
 * So on a host without `directApi` these report `unavailable` with the reason
 * rather than degrading into something that looks like data.
 */
export async function runHydration(
  bridge: TransportBridge,
  spec: HydrationSpec,
  input: HydrationRunInput,
): Promise<HydrationResult> {
  const { result, meta } = await callGraphQL<Record<string, unknown>>(
    bridge,
    { query: spec.query, variables: spec.variables(input) },
    { label: spec.label, proxy: null },
  );

  if (meta.kind === 'unavailable') {
    return { rows: [], meta, error: null, empty: false };
  }

  const error = classifyGraphQLErrors(result.errors);
  if (error) {
    return { rows: [], meta, error, empty: false };
  }

  const payload = result.data?.[spec.field];
  const rows = Array.isArray(payload)
    ? (payload as Record<string, unknown>[])
    : payload && typeof payload === 'object'
      ? [payload as Record<string, unknown>]
      : [];

  return { rows, meta, error: null, empty: rows.length === 0 };
}
