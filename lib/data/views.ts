/**
 * One view descriptor per Data Browser tab.
 *
 * This file is the tab's whole definition as DATA: its columns, which column
 * is pinned, what is sortable, its filter fields, its empty state, and which
 * hydration query its detail pane runs. The React component reads this and
 * renders it; it decides nothing on its own. That split is what lets the
 * vitest suite assert "every tab pins exactly one column, and it is the
 * first" without a DOM.
 *
 * ## The honesty rules encoded here
 *
 * 1. **Columns only name fields the walk actually selects.** Each `columns`
 *    entry is checked against the `DOMAIN_DESCRIPTORS[domain].pageQuery`
 *    selection set by `tests/data/views.test.ts`. A column for a field the
 *    query does not ask for would render an em-dash forever and look like
 *    missing platform data rather than an app bug.
 *
 *    That is also why `accounts` and `outlets` have no `updatedAt` column:
 *    `lib/sync/domains.ts` omits the field because selecting it takes the
 *    WHOLE query down on the current host (`Carbon::toIso8601String()` vs the
 *    bound `DateTime` scalar). The omission is load-bearing, not cosmetic.
 *
 * 2. **`sortable` means sortable ON THE LOADED PAGE.** The host list queries
 *    take `first`, `after` and (for six of the eight) `updatedAtMin` — there
 *    is no `orderBy` argument on this surface, and the walk order is fixed at
 *    `(updatedAt, id)`. A sort header therefore reorders what has been walked,
 *    which is exactly what `serverNote` tells the merchant on screen.
 *
 * 3. **Filter fields are local for the same reason** — with one deliberate
 *    exception: when `dateField` is `updatedAt` and the domain supports
 *    `updatedAtMin`, the range's lower bound is ALSO sent as `updatedAtMin`,
 *    so the same control demonstrates the incremental read. `dateIsIncremental`
 *    records which tabs that is true for, and the screen says so per tab.
 */

import { DOMAIN_DESCRIPTORS, type SyncDomain } from '@/lib/sync/domains';
import type { FilterField } from '@flashmandu/app-bridge-ui/react';
import { bool, bytes, integer, minor, text, timestamp, type CellFormatter } from './format';
import type { HydrationId } from './hydrate';

/** Tab slug, as it appears in `/data?tab=<slug>`. Mirrors `DATA_DOMAINS`. */
export type DataTabSlug =
  | 'customers'
  | 'orders'
  | 'items'
  | 'cms'
  | 'employees'
  | 'media'
  | 'accounts'
  | 'outlets';

export interface DataColumn {
  /** Node field this column reads. */
  key: string;
  label: string;
  format: CellFormatter;
  align?: 'left' | 'center' | 'right';
  /** Sorts the rows already walked — see the module docblock. */
  sortable?: boolean;
  /** Exactly one per view, and it must be the first column. */
  pinned?: boolean;
  width?: string;
}

export interface DataView {
  slug: DataTabSlug;
  domain: SyncDomain;
  label: string;
  /** One line under the tab, shown above the table. */
  blurb: string;
  columns: DataColumn[];
  /** Column key the table sorts by before the merchant touches a header. */
  defaultSortKey: string;
  /** Fields the FilterBar search box matches against, case-insensitively. */
  searchFields: string[];
  searchPlaceholder: string;
  /** Local filter fields rendered in the FilterBar. */
  filters: FilterField[];
  /** The timestamp field a `daterange` filter applies to, when there is one. */
  dateField: string | null;
  /** True when the date filter's lower bound is also sent as `updatedAtMin`. */
  dateIsIncremental: boolean;
  /** What the tab shows when the platform genuinely returned nothing. */
  emptyTitle: string;
  emptyDescription: string;
  /** The hydration queries a row (or the empty state) can reach. */
  hydrations: HydrationId[];
  /** Printed on screen: what the host filters vs what this screen filters. */
  serverNote: string;
}

const STATUS_ANY = 'any';

/** `select` field with an explicit "no filter" default, so it makes no chip. */
function selectField(key: string, label: string, options: [string, string][]): FilterField {
  return {
    key,
    label,
    type: 'select',
    defaultValue: STATUS_ANY,
    options: [{ label: 'Any', value: STATUS_ANY }, ...options.map(([value, l]) => ({ value, label: l }))],
  };
}

const ACTIVE_FIELD = selectField('isActive', 'Active', [
  ['true', 'Active'],
  ['false', 'Inactive'],
]);

/** The shared tail of every `serverNote`, so the caveat is worded once. */
const LOCAL_SUFFIX =
  'Everything else on this bar — the search box, the selects, the sort headers — filters the rows already walked. The host list queries take first/after/updatedAtMin and nothing else, so a screen-side filter is the honest place for the rest.';

export const DATA_VIEWS: Record<DataTabSlug, DataView> = {
  customers: {
    slug: 'customers',
    domain: 'customers',
    label: 'Customers',
    blurb: 'Parties, walked with `customers(first, after, updatedAtMin)` and hydrated with `partySearch`.',
    columns: [
      { key: 'name', label: 'Name', format: text, pinned: true, sortable: true, width: '220px' },
      { key: 'phone', label: 'Phone', format: text },
      { key: 'email', label: 'Email', format: text },
      { key: 'isActive', label: 'Active', format: bool, align: 'center', sortable: true },
      { key: 'storefrontCustomerId', label: 'Storefront id', format: text, align: 'right' },
      {
        key: 'balanceMinorUnits',
        label: 'Balance',
        format: minor,
        align: 'right',
        sortable: true,
      },
    ],
    defaultSortKey: 'name',
    searchFields: ['name', 'phone', 'email'],
    searchPlaceholder: 'Name, phone or email',
    filters: [
      ACTIVE_FIELD,
      { key: 'balanceMinorUnits', label: 'Balance (minor)', type: 'numberrange' },
    ],
    dateField: null,
    dateIsIncremental: false,
    emptyTitle: 'No customers on this profile',
    emptyDescription:
      'The walk completed and the platform returned zero parties. Nothing is being hidden and nothing is being invented.',
    hydrations: ['partySearch'],
    serverNote: `The customers walk sends updatedAtMin when the Keyset lab asks for an incremental read. ${LOCAL_SUFFIX}`,
  },

  orders: {
    slug: 'orders',
    domain: 'orders',
    label: 'Orders',
    blurb: 'Order summaries, walked with `orders(first, after, updatedAtMin)`; the detail pane quotes discounts.',
    columns: [
      { key: 'reference', label: 'Reference', format: text, pinned: true, sortable: true, width: '180px' },
      { key: 'status', label: 'Status', format: text, sortable: true },
      { key: 'paymentStatus', label: 'Payment', format: text, sortable: true },
      { key: 'openedAt', label: 'Opened', format: timestamp, sortable: true },
      { key: 'itemsCount', label: 'Lines', format: integer, align: 'right' },
      { key: 'totalMinor', label: 'Total', format: minor, align: 'right', sortable: true },
      { key: 'paidMinor', label: 'Paid', format: minor, align: 'right' },
      { key: 'balanceMinor', label: 'Balance', format: minor, align: 'right', sortable: true },
    ],
    defaultSortKey: 'openedAt',
    searchFields: ['reference', 'status', 'paymentStatus'],
    searchPlaceholder: 'Order reference or status',
    filters: [
      selectField('status', 'Status', [
        ['completed', 'Completed'],
        ['pending', 'Pending'],
        ['cancelled', 'Cancelled'],
      ]),
      selectField('paymentStatus', 'Payment', [
        ['paid', 'Paid'],
        ['partial', 'Partial'],
        ['unpaid', 'Unpaid'],
      ]),
      { key: 'openedAt', label: 'Opened', type: 'daterange' },
      { key: 'totalMinor', label: 'Total (minor)', type: 'numberrange' },
    ],
    dateField: 'openedAt',
    // `openedAt` is when the order was TAKEN; `updatedAtMin` filters when it was
    // last WRITTEN. They are different clocks, so this range stays local.
    dateIsIncremental: false,
    emptyTitle: 'No orders matched',
    emptyDescription: 'The walk completed with zero rows for the current arguments.',
    hydrations: ['discountsByCodes', 'discountQuote'],
    serverNote: `Opened-at is the order's OWN clock, not its last-write clock, so that range is applied here rather than sent as updatedAtMin — the two would disagree. ${LOCAL_SUFFIX}`,
  },

  items: {
    slug: 'items',
    domain: 'items',
    label: 'Items',
    blurb: 'Catalog items, walked with `items(first, after, updatedAtMin)` and hydrated with `catalogSearch`.',
    columns: [
      { key: 'name', label: 'Item', format: text, pinned: true, sortable: true, width: '240px' },
      { key: 'sku', label: 'SKU', format: text, sortable: true },
      { key: 'priceMinor', label: 'Price', format: minor, align: 'right', sortable: true },
      { key: 'isActive', label: 'Active', format: bool, align: 'center', sortable: true },
      { key: 'categoryId', label: 'Category', format: text, align: 'right' },
      { key: 'imageUrl', label: 'Image', format: text },
    ],
    defaultSortKey: 'name',
    searchFields: ['name', 'sku'],
    searchPlaceholder: 'Item name or SKU',
    filters: [ACTIVE_FIELD, { key: 'priceMinor', label: 'Price (minor)', type: 'numberrange' }],
    dateField: null,
    dateIsIncremental: false,
    emptyTitle: 'No items on this profile',
    emptyDescription: 'The catalog walk completed with zero rows.',
    hydrations: ['catalogSearch'],
    serverNote:
      'The items query also accepts a server-side "query" argument. This screen does not send it: the search box here is the LOCAL filter, and mixing the two into one control would make it impossible to tell which side answered. The catalogSearch hydration pane below is the server-side term search. ' +
      LOCAL_SUFFIX,
  },

  cms: {
    slug: 'cms',
    domain: 'cmsEntries',
    label: 'CMS',
    blurb: 'Entry summaries with their gating labels; `cmsEntryBody` fetches one body at a time.',
    columns: [
      { key: 'title', label: 'Title', format: text, pinned: true, sortable: true, width: '240px' },
      { key: 'module', label: 'Module', format: text, sortable: true },
      { key: 'status', label: 'Status', format: text, sortable: true },
      { key: 'accessLevel', label: 'Access', format: text, sortable: true },
      { key: 'isPublic', label: 'Public', format: bool, align: 'center', sortable: true },
      { key: 'publishedAt', label: 'Published', format: timestamp },
      { key: 'updatedAt', label: 'Updated', format: timestamp, sortable: true },
      { key: 'permalink', label: 'Permalink', format: text },
    ],
    defaultSortKey: 'updatedAt',
    searchFields: ['title', 'slug', 'module'],
    searchPlaceholder: 'Title, slug or module',
    filters: [
      selectField('accessLevel', 'Access level', [
        ['public', 'Public'],
        ['authenticated', 'Authenticated'],
        ['role_restricted', 'Role restricted'],
      ]),
      selectField('status', 'Status', [
        ['published', 'Published'],
        ['draft', 'Draft'],
      ]),
      { key: 'updatedAt', label: 'Updated', type: 'daterange' },
    ],
    dateField: 'updatedAt',
    dateIsIncremental: true,
    emptyTitle: 'No CMS entries',
    emptyDescription:
      'The entries walk completed with zero rows. Note the host returns PUBLISHED entries unless asked otherwise, so a profile with only drafts reads as empty here.',
    hydrations: ['cmsEntryBody'],
    serverNote: `The Updated range's lower bound is sent as updatedAtMin, so this control drives the real incremental read; its upper bound is applied here because the query has no updatedAtMax. ${LOCAL_SUFFIX}`,
  },

  employees: {
    slug: 'employees',
    domain: 'employees',
    label: 'Employees',
    blurb: 'Employee records, walked with `employees(...)` and hydrated by id with `employeesByIds`.',
    columns: [
      { key: 'name', label: 'Name', format: text, pinned: true, sortable: true, width: '220px' },
      { key: 'employeeCode', label: 'Code', format: text, sortable: true },
      { key: 'department', label: 'Department', format: text, sortable: true },
      { key: 'position', label: 'Position', format: text },
      { key: 'status', label: 'Status', format: text, sortable: true },
      { key: 'updatedAt', label: 'Updated', format: timestamp, sortable: true },
    ],
    defaultSortKey: 'name',
    searchFields: ['name', 'employeeCode', 'department', 'position'],
    searchPlaceholder: 'Name, code or department',
    filters: [
      selectField('status', 'Status', [
        ['active', 'Active'],
        ['inactive', 'Inactive'],
        ['terminated', 'Terminated'],
      ]),
      { key: 'updatedAt', label: 'Updated', type: 'daterange' },
    ],
    dateField: 'updatedAt',
    dateIsIncremental: true,
    /**
     * The sandbox profile genuinely has zero employees — the scope IS granted
     * and the walk DOES complete. This tab therefore has to distinguish
     * "empty" from "denied" from "still loading", which is the whole reason it
     * is in the coverage set.
     */
    emptyTitle: 'This profile has no employees',
    emptyDescription:
      'read:employees is granted and the walk completed — the platform returned zero rows. That is an empty domain, not a failure and not a pending request. The hydration pane below still runs `employeesByIds` against a real id so the query is exercised rather than assumed.',
    hydrations: ['employeesByIds'],
    serverNote: `The Updated range's lower bound is sent as updatedAtMin. ${LOCAL_SUFFIX}`,
  },

  media: {
    slug: 'media',
    domain: 'media',
    label: 'Media',
    blurb: 'Library assets, walked with `media(...)` and hydrated by id with `mediaItems`.',
    columns: [
      { key: 'filename', label: 'File', format: text, pinned: true, sortable: true, width: '240px' },
      { key: 'collection', label: 'Collection', format: text, sortable: true },
      { key: 'mimeType', label: 'Type', format: text, sortable: true },
      { key: 'size', label: 'Size', format: bytes, align: 'right', sortable: true },
      { key: 'width', label: 'W', format: integer, align: 'right' },
      { key: 'height', label: 'H', format: integer, align: 'right' },
      { key: 'alt', label: 'Alt', format: text },
      { key: 'updatedAt', label: 'Updated', format: timestamp, sortable: true },
    ],
    defaultSortKey: 'updatedAt',
    searchFields: ['filename', 'collection', 'mimeType', 'alt'],
    searchPlaceholder: 'Filename, collection or type',
    filters: [
      selectField('collection', 'Collection', [['default', 'default']]),
      { key: 'updatedAt', label: 'Updated', type: 'daterange' },
      { key: 'size', label: 'Size (bytes)', type: 'numberrange' },
    ],
    dateField: 'updatedAt',
    dateIsIncremental: true,
    emptyTitle: 'No media assets',
    emptyDescription: 'The media walk completed with zero rows.',
    hydrations: ['mediaItems'],
    serverNote: `The Updated range's lower bound is sent as updatedAtMin. ${LOCAL_SUFFIX}`,
  },

  accounts: {
    slug: 'accounts',
    domain: 'accounts',
    label: 'Accounts',
    blurb: 'Ledger accounts. No `updatedAtMin`, no `updatedAt` column — see the note below the table.',
    columns: [
      { key: 'name', label: 'Account', format: text, pinned: true, sortable: true, width: '220px' },
      { key: 'accountTypeSlug', label: 'Type', format: text, sortable: true },
      { key: 'accountTypeName', label: 'Type name', format: text },
      { key: 'isActive', label: 'Active', format: bool, align: 'center', sortable: true },
      { key: 'outletId', label: 'Outlet', format: text, align: 'right' },
      { key: 'balanceMinor', label: 'Balance', format: minor, align: 'right', sortable: true },
    ],
    defaultSortKey: 'name',
    searchFields: ['name', 'accountTypeSlug', 'accountTypeName'],
    searchPlaceholder: 'Account name or type',
    filters: [
      ACTIVE_FIELD,
      selectField('accountTypeSlug', 'Type', [
        ['cash', 'Cash'],
        ['bank', 'Bank'],
        ['wallet', 'Wallet'],
      ]),
    ],
    dateField: null,
    dateIsIncremental: false,
    emptyTitle: 'No accounts',
    emptyDescription: 'The accounts walk completed with zero rows.',
    hydrations: ['ledgerPostings'],
    serverNote:
      'accounts takes (first, after) only — there is no updatedAtMin on its schema, so a reconcile is an honest full re-walk. The updatedAt column is absent because selecting Account.updatedAt currently takes the WHOLE query down on the host (a Carbon::toIso8601String() value against a DateTime scalar that parses `Y-m-d H:i:s`). lib/sync/domains.ts omits it for the same reason and this screen does not work around it. ' +
      LOCAL_SUFFIX,
  },

  outlets: {
    slug: 'outlets',
    domain: 'outlets',
    label: 'Outlets',
    blurb: 'Outlets. Also no `updatedAtMin`; the detail pane reaches `locationsOfKind`.',
    columns: [
      { key: 'name', label: 'Outlet', format: text, pinned: true, sortable: true, width: '220px' },
      { key: 'code', label: 'Code', format: text, sortable: true },
      { key: 'isActive', label: 'Active', format: bool, align: 'center', sortable: true },
      { key: 'sortOrder', label: 'Order', format: integer, align: 'right', sortable: true },
      { key: 'defaultAccountId', label: 'Default account', format: text, align: 'right' },
    ],
    defaultSortKey: 'sortOrder',
    searchFields: ['name', 'code'],
    searchPlaceholder: 'Outlet name or code',
    filters: [ACTIVE_FIELD],
    dateField: null,
    dateIsIncremental: false,
    emptyTitle: 'No outlets',
    emptyDescription: 'The outlets walk completed with zero rows.',
    hydrations: ['locationsOfKind'],
    serverNote:
      'outlets takes (first, after) only, and Outlet.updatedAt is omitted for the same live host bug documented on the Accounts tab. ' +
      LOCAL_SUFFIX,
  },
};

/** Tab order, left to right. Same order as the manifest's domain list. */
export const DATA_TABS: DataTabSlug[] = [
  'customers',
  'orders',
  'items',
  'cms',
  'employees',
  'media',
  'accounts',
  'outlets',
];

export function isDataTab(value: string | null | undefined): value is DataTabSlug {
  return typeof value === 'string' && (DATA_TABS as string[]).includes(value);
}

export function viewFor(slug: DataTabSlug): DataView {
  return DATA_VIEWS[slug];
}

/** The descriptor the view walks through. Sugar over the sync registry. */
export function descriptorFor(slug: DataTabSlug) {
  return DOMAIN_DESCRIPTORS[DATA_VIEWS[slug].domain];
}

/**
 * The field names one view's page query actually selects.
 *
 * Parsed out of the shared `pageQuery` string rather than declared twice —
 * a duplicated list is a list that drifts. Used by the suite to prove no
 * column reads a field the walk never asked for.
 */
export function selectedFields(slug: DataTabSlug): string[] {
  const query = descriptorFor(slug).pageQuery;
  const match = /nodes\s*\{([^}]*)\}/.exec(query);
  return match ? match[1].trim().split(/\s+/).filter(Boolean) : [];
}
