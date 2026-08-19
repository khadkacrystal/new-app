/**
 * Screen-side filtering, sorting and paging over the rows a walk produced.
 *
 * Every function here is pure and takes the view descriptor, so the suite can
 * assert the FilterBar's semantics without a DOM — including the one that is
 * easy to get subtly wrong: a `select` sitting at its `defaultValue` is NOT an
 * active filter, which is the same rule `buildFilterChips` uses to decide
 * whether to draw a chip. If the two disagreed, the merchant would see rows
 * disappear with no chip explaining why.
 *
 * Why this is screen-side at all is explained per-tab in `views.ts`
 * (`serverNote`) and printed under every table: the host list queries take
 * `first`, `after` and `updatedAtMin`, full stop. There is no `orderBy` and no
 * `where`. Pretending otherwise by hiding the local filtering would teach an
 * app author that the platform does something it does not.
 */

import type { SyncNode } from '@/lib/sync/sink';
import type { DateRangeValue, FilterValue, NumberRangeValue } from '@flashmandu/app-bridge-ui/react';
import type { DataView } from './views';

export type SortDir = 'asc' | 'desc';

export type FilterValues = Record<string, FilterValue>;

const isBlank = (value: unknown): boolean => value === null || value === undefined || value === '';

/** Case-insensitive contains, across the view's declared search fields. */
export function matchesSearch(node: SyncNode, fields: string[], term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return fields.some((field) => {
    const value = (node as Record<string, unknown>)[field];
    return value !== null && value !== undefined && String(value).toLowerCase().includes(needle);
  });
}

function matchesSelect(node: SyncNode, key: string, wanted: string): boolean {
  const value = (node as Record<string, unknown>)[key];
  if (typeof value === 'boolean') {
    return String(value) === wanted;
  }
  return String(value ?? '').toLowerCase() === wanted.toLowerCase();
}

function matchesNumberRange(node: SyncNode, key: string, range: NumberRangeValue): boolean {
  const value = (node as Record<string, unknown>)[key];
  // A row with no value for the field is excluded by an active range: it is
  // not "0", and treating it as such would move it into the wrong bucket.
  // `Number(null)` is 0, so the blank check has to come FIRST.
  if (isBlank(value)) {
    return false;
  }
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return false;
  }
  if (!isBlank(range.min) && raw < Number(range.min)) {
    return false;
  }
  if (!isBlank(range.max) && raw > Number(range.max)) {
    return false;
  }
  return true;
}

function matchesDateRange(node: SyncNode, key: string, range: DateRangeValue): boolean {
  const raw = (node as Record<string, unknown>)[key];
  if (isBlank(raw)) {
    return false;
  }
  // The presets resolve to `YYYY-MM-DD`, and the platform returns ISO-8601, so
  // comparing the first ten characters keeps the comparison in one calendar
  // vocabulary. Comparing Date objects would drag the browser's timezone into
  // a filter over a UTC field and shift rows across midnight.
  const day = String(raw).slice(0, 10);
  if (!isBlank(range.from) && day < String(range.from)) {
    return false;
  }
  if (!isBlank(range.to) && day > String(range.to)) {
    return false;
  }
  return true;
}

/** True when this field's current value should filter anything at all. */
export function isActiveFilter(
  field: DataView['filters'][number],
  value: FilterValue,
): boolean {
  if (field.type === 'select') {
    return !isBlank(value) && value !== field.defaultValue;
  }
  if (field.type === 'multiselect') {
    return Array.isArray(value) && value.filter((entry) => entry !== '').length > 0;
  }
  if (field.type === 'daterange') {
    const range = (value ?? {}) as DateRangeValue;
    return !isBlank(range.from) || !isBlank(range.to);
  }
  const range = (value ?? {}) as NumberRangeValue;
  return !isBlank(range.min) || !isBlank(range.max);
}

export function applyFilters(nodes: SyncNode[], view: DataView, values: FilterValues): SyncNode[] {
  const active = view.filters.filter((field) => isActiveFilter(field, values[field.key]));
  if (active.length === 0) {
    return nodes;
  }

  return nodes.filter((node) =>
    active.every((field) => {
      const value = values[field.key];
      switch (field.type) {
        case 'select':
          return matchesSelect(node, field.key, String(value));
        case 'multiselect':
          return (value as string[]).some((entry) => matchesSelect(node, field.key, entry));
        case 'daterange':
          return matchesDateRange(node, field.key, (value ?? {}) as DateRangeValue);
        default:
          return matchesNumberRange(node, field.key, (value ?? {}) as NumberRangeValue);
      }
    }),
  );
}

/**
 * Sort by one field.
 *
 * Numbers compare numerically, everything else compares as a lower-cased
 * string, and a blank always sinks to the bottom regardless of direction —
 * a column of em-dashes at the top is never what the merchant asked for.
 */
export function sortRows(nodes: SyncNode[], key: string, direction: SortDir): SyncNode[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...nodes].sort((a, b) => {
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];

    const leftBlank = isBlank(left);
    const rightBlank = isBlank(right);
    if (leftBlank && rightBlank) {
      return 0;
    }
    if (leftBlank) {
      return 1;
    }
    if (rightBlank) {
      return -1;
    }

    if (typeof left === 'boolean' || typeof right === 'boolean') {
      return (Number(left) - Number(right)) * sign;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return (leftNumber - rightNumber) * sign;
    }

    return String(left).toLowerCase().localeCompare(String(right).toLowerCase()) * sign;
  });
}

export interface PageSlice {
  rows: SyncNode[];
  /** 1-based, clamped into range. */
  page: number;
  totalPages: number;
  total: number;
}

export function paginate(nodes: SyncNode[], page: number, perPage: number): PageSlice {
  const total = nodes.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * perPage;
  return { rows: nodes.slice(start, start + perPage), page: current, totalPages, total };
}

/**
 * The `updatedAtMin` this tab's date filter implies, or null.
 *
 * Only for tabs whose `dateField` IS `updatedAt` and whose domain accepts the
 * argument — see `views.ts`. Everywhere else the range stays local, because
 * `openedAt` and `updatedAt` are different clocks and swapping one for the
 * other silently changes what the merchant asked for.
 */
export function deriveUpdatedAtMin(view: DataView, values: FilterValues): string | null {
  if (!view.dateIsIncremental || view.dateField === null) {
    return null;
  }
  const range = (values[view.dateField] ?? {}) as DateRangeValue;
  if (isBlank(range.from)) {
    return null;
  }
  return `${String(range.from)}T00:00:00.000Z`;
}

/** Search → filter → sort, in the order the screen applies them. */
export function projectRows(
  nodes: SyncNode[],
  view: DataView,
  options: { search: string; filters: FilterValues; sortKey: string; sortDir: SortDir },
): SyncNode[] {
  const searched = nodes.filter((node) => matchesSearch(node, view.searchFields, options.search));
  const filtered = applyFilters(searched, view, options.filters);
  return sortRows(filtered, options.sortKey, options.sortDir);
}
