/**
 * Cell formatters for the Data Browser.
 *
 * These live in `lib/` rather than inside the table component for one reason:
 * the column set is DATA (see `views.ts`), so the thing that turns a raw field
 * into the string a merchant reads has to be data-shaped too — a plain
 * `(value) => string` the vitest suite can call without rendering React.
 *
 * Every formatter is total: it takes `unknown` and always returns a string,
 * because a list read is a wire read and the schema's nullability is not a
 * promise about a host mid-deploy. A field that is missing renders as the
 * em-dash placeholder, never as `undefined` and never as a thrown render.
 */

/** What an absent value looks like in a cell. One character, one meaning. */
export const BLANK = '—';

export type CellFormatter = (value: unknown) => string;

export const text: CellFormatter = (value) =>
  value === null || value === undefined || value === '' ? BLANK : String(value);

export const bool: CellFormatter = (value) => {
  if (value === null || value === undefined) {
    return BLANK;
  }
  return value ? 'Yes' : 'No';
};

export const integer: CellFormatter = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : BLANK;
};

/**
 * Minor units → a decimal string.
 *
 * The whole platform surface is minor units (paisa/cents) — `totalMinor`,
 * `balanceMinorUnits`, `discountMinor`, `amountMinor`. No currency symbol is
 * printed: the app is not told the merchant's currency on this surface, and
 * inventing a `$` would be a lie about the number's denomination.
 */
export const minor: CellFormatter = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return BLANK;
  }
  return (n / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** Bytes with a binary suffix. Media `size` is bytes per the schema. */
export const bytes: CellFormatter = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return BLANK;
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let scaled = n;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? scaled : scaled.toFixed(1)} ${units[unit]}`;
};

/**
 * An ISO-ish timestamp → `YYYY-MM-DD HH:MM` in UTC.
 *
 * Deliberately UTC and deliberately not localised: this screen exists to show
 * what the platform returned, and a browser-local reformat makes a keyset
 * walk's `updatedAt` ordering look wrong to anyone comparing it against the
 * cursor. An unparseable value is echoed verbatim rather than blanked — seeing
 * the raw string is how the `Account.updatedAt` scalar bug got diagnosed.
 */
export const timestamp: CellFormatter = (value) => {
  if (value === null || value === undefined || value === '') {
    return BLANK;
  }
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) {
    return String(value);
  }
  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)}`;
};

/** Trim a long string for a table cell, keeping the head. */
export function truncate(value: unknown, max = 48): string {
  const raw = text(value);
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}
