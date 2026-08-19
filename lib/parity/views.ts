/**
 * The Items and Categories screens as DATA — filter schema, column set, view
 * menu, and the pure functions that apply them.
 *
 * Same split as `lib/data/views.ts`: the React components below `components/
 * parity/` are composition and decide nothing, so every rule worth asserting
 * (which field seeds the quick filters, which value counts as an active
 * filter, how a price range bounds `priceMinor`) is testable without a DOM.
 *
 * The filter schemas mirror `Items\Index::filterState()` and
 * `Categories\Index::filterState()` field-for-field wherever the platform
 * schema can supply the value, and omit — loudly, via `SCHEMA_GAPS` — where it
 * cannot. The kit's `FilterField` shape was built to take the host's schema
 * verbatim (`chip`, `preset`, `defaultValue`, `operatorKey` all mean exactly
 * what they mean in `filter-bar.blade.php`), so this is a transcription, not a
 * translation.
 */

import type { FilterField, FilterValue } from '@flashmandu/app-bridge-ui/react';
import type { CatalogItem, DerivedCategory } from './catalog';

/**
 * The "no filter" sentinel on every select.
 *
 * The host uses `''` for the same idea and declares it as the field's
 * `default`. An explicit token reads better in a chip-suppression test than an
 * empty string does, and the RULE — a value equal to the declared default is
 * not an active filter — is identical either way.
 */
export const ANY = 'any';

/** `filters.{scope}.{profileId}` — must match the host's scope names exactly. */
export const ITEMS_SCOPE = 'items';
export const CATEGORIES_SCOPE = 'categories';

export const ITEMS_SEARCH_PLACEHOLDER = 'Search items...';
export const CATEGORIES_SEARCH_PLACEHOLDER = 'Search categories...';

/**
 * Items filter fields, in the host's own declaration order.
 *
 * `type` and `stock` are absent because `CatalogItem` carries neither. That
 * absence moves the quick-filter derivation from Type (host) to Status
 * (Showcase) — see the `filterbar.quickfilters` anatomy row, which records it
 * as a schema difference rather than a styling one.
 */
export const ITEMS_FILTER_FIELDS: FilterField[] = [
  {
    key: 'categoryId',
    label: 'Category',
    type: 'select',
    defaultValue: ANY,
    // Options are filled in at render time from the walked page — the schema
    // has no `categories` query to enumerate them from.
    options: [{ label: 'All Categories', value: ANY }],
  },
  {
    key: 'price',
    label: 'Price',
    type: 'numberrange',
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    defaultValue: ANY,
    options: [
      { label: 'All Items', value: ANY },
      { label: 'Active Only', value: 'active' },
      { label: 'Inactive Only', value: 'inactive' },
    ],
  },
  {
    key: 'perPage',
    label: 'Per page',
    type: 'select',
    // A DISPLAY PREFERENCE, not a filter: no chip, no entry in the filter
    // menu, never written to the pinned default. Same as the host's
    // `'chip' => false` on the identical field.
    chip: false,
    defaultValue: '10',
    options: [
      { label: '10 per page', value: '10' },
      { label: '25 per page', value: '25' },
      { label: '50 per page', value: '50' },
    ],
  },
];

/** Categories filter fields, mirroring `Categories\Index::filterState()`. */
export const CATEGORIES_FILTER_FIELDS: FilterField[] = [
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    defaultValue: ANY,
    options: [
      { label: 'All Categories', value: ANY },
      { label: 'Has active items', value: 'active' },
      { label: 'No active items', value: 'inactive' },
    ],
  },
  {
    key: 'perPage',
    label: 'Per page',
    type: 'select',
    chip: false,
    defaultValue: '10',
    options: [
      { label: '10 per page', value: '10' },
      { label: '25 per page', value: '25' },
      { label: '50 per page', value: '50' },
    ],
  },
];

/**
 * The Items view menu's "Sort by" list, matching the host's four entries.
 *
 * `createdAt` is present and DISABLED rather than omitted, because the reason
 * it cannot work is worth showing: the connection returns no timestamp field,
 * so a "Date Created" sort is not expressible over the app API at all. Hiding
 * the entry would make the two menus look different for no visible reason.
 */
export interface SortOption {
  key: string;
  label: string;
  /** Set when the option cannot be served; rendered disabled with this text. */
  unavailable?: string;
}

export const ITEMS_SORT_OPTIONS: SortOption[] = [
  { key: 'name', label: 'Name' },
  { key: 'sku', label: 'SKU' },
  { key: 'priceMinor', label: 'Price' },
  {
    key: 'createdAt',
    label: 'Date Created',
    unavailable:
      'CatalogItem returns no createdAt/updatedAt field, so this sort cannot be performed over the app API.',
  },
];

/** Column keys the Items view menu can toggle, in render order. */
export const ITEMS_COLUMN_KEYS = ['image', 'sku', 'category', 'price', 'status'] as const;
export type ItemsColumnKey = (typeof ITEMS_COLUMN_KEYS)[number];

export const ITEMS_COLUMN_LABELS: Record<ItemsColumnKey, string> = {
  image: 'Image',
  sku: 'SKU',
  category: 'Category',
  price: 'Price',
  status: 'Status',
};

/** `localStorage` key for the column toggles. Same shape as the host's. */
export const ITEMS_COLUMNS_STORAGE_KEY = 'items.cols';

/* ───────────────────────────── filtering ───────────────────────────── */

export type FilterValues = Record<string, FilterValue>;

function rangeBound(value: FilterValue, bound: 'min' | 'max'): number | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[bound];
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function selected(values: FilterValues, key: string): string | null {
  const raw = values[key];
  if (typeof raw !== 'string' || raw === '' || raw === ANY) {
    return null;
  }
  return raw;
}

/**
 * Apply the Items filters to a walked page.
 *
 * The SEARCH term is deliberately absent: it is sent to the platform as
 * `items(query:)`, so filtering by it again here would double-apply it and
 * make a server-side filter look local. The screen says which is which.
 *
 * The price range is in MINOR units on the wire and in MAJOR units in the
 * popover, because that is what the merchant types. The conversion happens
 * once, here, rather than in the component.
 */
export function filterItems(items: CatalogItem[], values: FilterValues): CatalogItem[] {
  const status = selected(values, 'status');
  const category = selected(values, 'categoryId');
  const min = rangeBound(values.price, 'min');
  const max = rangeBound(values.price, 'max');

  return items.filter((item) => {
    if (status === 'active' && !item.isActive) return false;
    if (status === 'inactive' && item.isActive) return false;

    if (category !== null) {
      const id = item.categoryId === null ? 'uncategorised' : String(item.categoryId);
      if (id !== category) return false;
    }

    if (min !== null && item.priceMinor < min * 100) return false;
    if (max !== null && item.priceMinor > max * 100) return false;

    return true;
  });
}

export function filterCategories(
  categories: DerivedCategory[],
  values: FilterValues,
  search: string,
): DerivedCategory[] {
  const status = selected(values, 'status');
  const term = search.trim().toLowerCase();

  return categories.filter((category) => {
    if (status === 'active' && category.activeCount === 0) return false;
    if (status === 'inactive' && category.activeCount > 0) return false;
    if (term !== '' && !category.name.toLowerCase().includes(term)) return false;
    return true;
  });
}

/* ───────────────────────────── sorting ─────────────────────────────── */

export type SortDir = 'asc' | 'desc';

/** Sort the WALKED page. There is no `orderBy` on the platform connection. */
export function sortItems(items: CatalogItem[], key: string, direction: SortDir): CatalogItem[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === 'priceMinor') {
      return (a.priceMinor - b.priceMinor) * sign;
    }
    if (key === 'sku') {
      return (a.sku ?? '').localeCompare(b.sku ?? '') * sign;
    }
    if (key === 'status') {
      return (Number(a.isActive) - Number(b.isActive)) * sign;
    }
    return a.name.localeCompare(b.name) * sign;
  });
}

export function sortCategories(
  categories: DerivedCategory[],
  key: string,
  direction: SortDir,
): DerivedCategory[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...categories].sort((a, b) => {
    if (key === 'itemCount') {
      return (a.itemCount - b.itemCount) * sign;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true }) * sign;
  });
}

/* ───────────────────────────── paging ──────────────────────────────── */

export interface PageSlice<T> {
  rows: T[];
  page: number;
  pageCount: number;
}

/** Clamps out-of-range pages instead of rendering an empty table. */
export function paginate<T>(rows: T[], page: number, perPage: number): PageSlice<T> {
  const size = Math.max(1, perPage);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pageCount };
}

/** `perPage` off the filter values, falling back to the declared default. */
export function perPageOf(values: FilterValues, fallback = 10): number {
  const raw = values.perPage;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Category options for the Items filter, derived from the walked page.
 *
 * The host builds the identical list from `$this->categories` — a real
 * `Category` query with real names. An app has neither, so the options carry
 * the synthetic `Category #12` label and the screen says where it came from.
 */
export function categoryOptionsFrom(categories: DerivedCategory[]): { label: string; value: string }[] {
  return [
    { label: 'All Categories', value: ANY },
    ...categories.map((category) => ({ label: category.name, value: category.id })),
  ];
}

/** Items fields with the category options filled in. Never mutates the schema. */
export function itemsFilterFields(categories: DerivedCategory[]): FilterField[] {
  return ITEMS_FILTER_FIELDS.map((field) =>
    field.key === 'categoryId' ? { ...field, options: categoryOptionsFrom(categories) } : field,
  );
}

/** The pristine filter values — every field at its declared default. */
export function initialValues(fields: FilterField[]): FilterValues {
  const values: FilterValues = {};
  for (const field of fields) {
    if (field.type === 'select' || field.type === 'multiselect') {
      values[field.key] = field.defaultValue ?? ANY;
    }
  }
  return values;
}
