/**
 * The eight list domains, described as data.
 *
 * Every field here is read off the real schema
 * (`packages/flashmandu/apps/graphql/types/*.graphql`), not guessed:
 *
 * - Each list query takes `first: Int!` (clamped to 100 server-side) and an
 *   opaque `after: String`, and returns `{ nodes, pageInfo { hasNextPage
 *   endCursor } }`. `PageInfo` is declared once in `pagination.graphql`.
 * - **`accounts` and `outlets` do NOT accept `updatedAtMin`.** Their schema
 *   files declare `(first, after)` and nothing else. That is not an oversight
 *   to route around: a reconcile of those two domains is a full re-walk, and
 *   the engine says so rather than sending an argument the schema would reject.
 * - Node ids are `ID!` and serialise as strings.
 *
 * `hydrate` is the webhook fast path's read. Four domains have a genuine
 * by-ids hydration query; `orders` and `cmsEntries` have none (the schema
 * offers `ordersByLocations` and `cmsEntryBody`, neither of which resolves an
 * arbitrary order/entry id), so those two hydrate by re-running the list query
 * narrowed with `updatedAtMin` around the event's `occurred_at` and picking the
 * id out. That is a real read of the real surface, not a stand-in.
 */

import { classifyGraphQLErrors, type GraphQLResult } from './errors';
import type { GraphQLTransport } from './transport';
import type { SyncNode } from './sink';

export const SYNC_DOMAINS = [
  'customers',
  'orders',
  'items',
  'cmsEntries',
  'employees',
  'media',
  'accounts',
  'outlets',
] as const;

export type SyncDomain = (typeof SYNC_DOMAINS)[number];

export function isSyncDomain(value: string): value is SyncDomain {
  return (SYNC_DOMAINS as readonly string[]).includes(value);
}

/** The wire shape of every `XConnection` on this schema. */
export interface DomainConnection {
  nodes: SyncNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** One page as the engine consumes it, flattened out of the connection type. */
export interface DomainPage {
  nodes: SyncNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface DomainDescriptor {
  domain: SyncDomain;
  /** GraphQL root field, which is also the key in `data`. */
  field: string;
  /**
   * The scope the platform checks. Reported verbatim on the Sync screen when
   * a walk comes back SCOPE_DENIED, so a merchant sees WHICH grant is missing.
   */
  scope: string;
  /** False for `accounts` / `outlets` — their schema has no such argument. */
  supportsUpdatedAtMin: boolean;
  /** The page query. Variables: `$first`, `$after`, and `$updatedAtMin` when supported. */
  pageQuery: string;
  /**
   * Fetch one record for the webhook fast path. Returns `[]` when the id is
   * gone (deleted between emit and hydrate) — never throws for "not found".
   */
  hydrate: (
    transport: GraphQLTransport,
    id: string,
    occurredAt: Date | null,
  ) => Promise<SyncNode[]>;
}

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

/** Build a `$first/$after(/$updatedAtMin)` page query for one root field. */
function pageQuery(field: string, selection: string, incremental: boolean): string {
  const varDecl = incremental
    ? '($first: Int!, $after: String, $updatedAtMin: DateTime)'
    : '($first: Int!, $after: String)';
  const args = incremental
    ? 'first: $first, after: $after, updatedAtMin: $updatedAtMin'
    : 'first: $first, after: $after';

  return `query Sync${field[0].toUpperCase()}${field.slice(1)}${varDecl} {
  ${field}(${args}) {
    nodes { ${selection} }
    ${PAGE_INFO}
  }
}`;
}

/** Run a by-ids hydration query returning a bare list. */
async function hydrateByIds(
  transport: GraphQLTransport,
  query: string,
  field: string,
  id: string,
): Promise<SyncNode[]> {
  const result = await transport<Record<string, SyncNode[] | null>>({
    query,
    variables: { ids: [id] },
  });
  // A hydration read is gated on the same scope as the walk, so it can come
  // back SCOPE_DENIED too. Classifying here — rather than reading `data` and
  // shrugging at an empty list — is what keeps "you lack read:orders" from
  // being reported to the Event Inspector as "that record does not exist".
  const error = classifyGraphQLErrors(result.errors);
  if (error) {
    throw error;
  }
  return result.data?.[field] ?? [];
}

/**
 * Hydrate a domain that has no by-id read by narrowing its own list query.
 *
 * `updatedAtMin` is set a minute BEFORE the event's `occurred_at`: the host
 * orders by `(updated_at, id)` and the event fires after the write, so a
 * window that starts exactly at `occurred_at` can miss the row by fractions of
 * a second. Walks at most `maxPages` pages before giving up, so a burst of
 * unrelated writes cannot turn one webhook into an unbounded read.
 */
async function hydrateByNarrowWalk(
  transport: GraphQLTransport,
  descriptor: Pick<DomainDescriptor, 'field' | 'pageQuery'>,
  id: string,
  occurredAt: Date | null,
  maxPages = 5,
): Promise<SyncNode[]> {
  const since = new Date((occurredAt?.getTime() ?? Date.now()) - 60_000).toISOString();
  let after: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const result: GraphQLResult<Record<string, DomainConnection | null>> = await transport<
      Record<string, DomainConnection | null>
    >({
      query: descriptor.pageQuery,
      variables: { first: 100, after, updatedAtMin: since },
    });
    const error = classifyGraphQLErrors(result.errors, after);
    if (error) {
      throw error;
    }
    const connection: DomainConnection | null | undefined = result.data?.[descriptor.field];
    if (!connection) {
      return [];
    }
    const hit = connection.nodes.find((node) => String(node.id) === id);
    if (hit) {
      return [hit];
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      return [];
    }
    after = connection.pageInfo.endCursor;
  }

  return [];
}

const CUSTOMERS_PAGE = pageQuery(
  'customers',
  'id name phone email isActive storefrontCustomerId balanceMinorUnits',
  true,
);
const ORDERS_PAGE = pageQuery(
  'orders',
  'id reference status paymentStatus openedAt itemsCount totalMinor paidMinor balanceMinor locationRef partyRef',
  true,
);
const ITEMS_PAGE = pageQuery('items', 'id name sku priceMinor isActive categoryId imageUrl', true);
const CMS_PAGE = pageQuery(
  'cmsEntries',
  'id module title slug status accessLevel isPublic publishedAt updatedAt permalink',
  true,
);
const EMPLOYEES_PAGE = pageQuery(
  'employees',
  'id name employeeCode department position status updatedAt',
  true,
);
const MEDIA_PAGE = pageQuery(
  'media',
  'id url collection filename mimeType size width height alt updatedAt',
  true,
);
/**
 * ⚠ `Account.updatedAt` and `Outlet.updatedAt` are NOT selected, and that is a
 * live host bug, not a preference.
 *
 * Both are declared `DateTime!` in `accounts-outlets.graphql`, and both
 * `AccountData::toArray()` / `OutletData::toArray()` serialise with
 * `Carbon::toIso8601String()` — `2026-07-27T06:07:24+00:00`. Lighthouse's
 * `DateTime` scalar parses `Y-m-d H:i:s` and rejects the offset ("Unexpected
 * data found. Trailing data"), so selecting the field turns the WHOLE query
 * into a 200 + "Internal server error" and the domain never syncs. (The other
 * six domains declare `updatedAt: String` and are unaffected. `DateTimeTz`
 * would be the correct scalar.)
 *
 * Nothing here needs the field: neither domain accepts `updatedAtMin`, so the
 * reconcile is a full re-walk and the cursor is opaque anyway. Reinstate it
 * the moment the host serialises a value its own scalar accepts.
 */
const ACCOUNTS_PAGE = pageQuery(
  'accounts',
  'id name accountTypeSlug accountTypeName isActive outletId balanceMinor',
  false,
);
const OUTLETS_PAGE = pageQuery(
  'outlets',
  'id name code isActive sortOrder defaultAccountId',
  false,
);

export const DOMAIN_DESCRIPTORS: Record<SyncDomain, DomainDescriptor> = {
  customers: {
    domain: 'customers',
    field: 'customers',
    scope: 'read:customers',
    supportsUpdatedAtMin: true,
    pageQuery: CUSTOMERS_PAGE,
    hydrate: (transport, id) =>
      hydrateByIds(
        transport,
        `query HydrateParties($ids: [ID!]!) { parties(ids: $ids) { id name phone email isActive storefrontCustomerId balanceMinorUnits } }`,
        'parties',
        id,
      ),
  },
  orders: {
    domain: 'orders',
    field: 'orders',
    scope: 'read:orders',
    supportsUpdatedAtMin: true,
    pageQuery: ORDERS_PAGE,
    hydrate: (transport, id, occurredAt) =>
      hydrateByNarrowWalk(transport, { field: 'orders', pageQuery: ORDERS_PAGE }, id, occurredAt),
  },
  items: {
    domain: 'items',
    field: 'items',
    scope: 'read:catalog',
    supportsUpdatedAtMin: true,
    pageQuery: ITEMS_PAGE,
    hydrate: (transport, id) =>
      hydrateByIds(
        transport,
        `query HydrateItems($ids: [ID!]!) { catalogItems(ids: $ids) { id name sku priceMinor isActive categoryId imageUrl } }`,
        'catalogItems',
        id,
      ),
  },
  cmsEntries: {
    domain: 'cmsEntries',
    field: 'cmsEntries',
    scope: 'read:content',
    supportsUpdatedAtMin: true,
    pageQuery: CMS_PAGE,
    hydrate: (transport, id, occurredAt) =>
      hydrateByNarrowWalk(
        transport,
        { field: 'cmsEntries', pageQuery: CMS_PAGE },
        id,
        occurredAt,
      ),
  },
  employees: {
    domain: 'employees',
    field: 'employees',
    scope: 'read:employees',
    supportsUpdatedAtMin: true,
    pageQuery: EMPLOYEES_PAGE,
    hydrate: (transport, id) =>
      hydrateByIds(
        transport,
        `query HydrateEmployees($ids: [ID!]!) { employeesByIds(ids: $ids) { id name employeeCode department position status updatedAt } }`,
        'employeesByIds',
        id,
      ),
  },
  media: {
    domain: 'media',
    field: 'media',
    scope: 'read:media',
    supportsUpdatedAtMin: true,
    pageQuery: MEDIA_PAGE,
    hydrate: (transport, id) =>
      hydrateByIds(
        transport,
        `query HydrateMedia($ids: [ID!]!) { mediaItems(ids: $ids) { id url collection filename mimeType size width height alt updatedAt } }`,
        'mediaItems',
        id,
      ),
  },
  accounts: {
    domain: 'accounts',
    field: 'accounts',
    scope: 'read:ledger',
    supportsUpdatedAtMin: false,
    pageQuery: ACCOUNTS_PAGE,
    // No account event exists, and no by-id account read is exposed. The
    // reconcile's full re-walk is the only path, which is why nothing here
    // pretends otherwise.
    hydrate: async () => [],
  },
  outlets: {
    domain: 'outlets',
    field: 'outlets',
    scope: 'read:settings',
    supportsUpdatedAtMin: false,
    pageQuery: OUTLETS_PAGE,
    hydrate: async () => [],
  },
};

/**
 * Webhook event name → the domain it changes, and whether it removes the row.
 *
 * Drawn from `HookName.php`'s 18 subscribable events. `price.changed` and
 * `inventory.level.changed` name an ITEM id, so they re-hydrate the catalog
 * row like any other item update. Lifecycle events (`app.uninstalled`,
 * `profile.data.erased`, `app.scopes.updated`) and `schedule.tick` are NOT
 * here on purpose — they are not record changes, and the engine exposes
 * `purge()` / `handleScheduleTick()` for them instead.
 */
export const EVENT_DOMAIN_MAP: Record<string, { domain: SyncDomain; removes: boolean }> = {
  'customer.created': { domain: 'customers', removes: false },
  'customer.updated': { domain: 'customers', removes: false },
  'customer.deleted': { domain: 'customers', removes: true },

  'order.created': { domain: 'orders', removes: false },
  'order.updated': { domain: 'orders', removes: false },

  'item.created': { domain: 'items', removes: false },
  'item.updated': { domain: 'items', removes: false },
  'item.deleted': { domain: 'items', removes: true },
  'price.changed': { domain: 'items', removes: false },
  'inventory.level.changed': { domain: 'items', removes: false },

  'cms.entry.published': { domain: 'cmsEntries', removes: false },
  'cms.entry.updated': { domain: 'cmsEntries', removes: false },
  'cms.entry.unpublished': { domain: 'cmsEntries', removes: false },
  'cms.entry.deleted': { domain: 'cmsEntries', removes: true },

  'media.uploaded': { domain: 'media', removes: false },

  'employee.created': { domain: 'employees', removes: false },
  'employee.updated': { domain: 'employees', removes: false },
  'employee.archived': { domain: 'employees', removes: true },
};
