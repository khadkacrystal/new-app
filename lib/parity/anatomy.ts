/**
 * The Items / Categories parity model, as data.
 *
 * ## Why this file exists
 *
 * The complaint that started this work was visual — "the filters search box is
 * not correct and the position of the buttons is not correct" — and a visual
 * complaint answered visually stays an opinion. So the answer is written down
 * as a table instead: one row per anatomical element of the admin's own Items
 * and Categories index pages, each carrying the ADMIN's value, the SHOWCASE
 * value, and a verdict.
 *
 * Three consumers read it, which is the whole point:
 *
 * 1. `docs/parity-items-categories.md` is GENERATED from this array
 *    (`lib/parity/anatomy-doc.ts`), so the written table cannot drift from the
 *    model the screens are built against.
 * 2. `tests/parity/anatomy.test.ts` asserts the doc on disk still equals the
 *    render, and that every `differs` row states a cause.
 * 3. `tests/dom/*.test.tsx` renders the real Showcase components and asserts
 *    the `contract` classes named here are actually in the emitted markup —
 *    so a row claiming MATCH is checked against the DOM, not against prose.
 *
 * ## The admin values are quoted, never remembered
 *
 * Every `source` is a path in the chiya-shots host, read at the time this file
 * was written. They are quoted verbatim in `admin` so a reviewer can diff the
 * claim against the file rather than trusting this summary.
 */

export type Verdict = 'match' | 'differs';

/** Which part of the page the row describes. Also the doc's section order. */
export type AnatomySection = 'page' | 'filterbar' | 'table' | 'footer' | 'empty';

/**
 * A difference the kit itself has to close, stated precisely enough to act on.
 *
 * This task was explicitly told not to edit `@flashmandu/app-bridge-ui`
 * (another agent is mid-edit there), so a gap found here is REPORTED with the
 * exact selector and declaration rather than patched. `KIT_GAPS` collects them
 * and the generated doc gives them their own heading.
 */
export interface KitGap {
  /** The selector in the kit's `components.css` that needs the declaration. */
  selector: string;
  /** The exact declaration (or component change) needed. */
  declaration: string;
}

export interface AnatomyRow {
  /** Stable id. Also the doc's anchor and the DOM test's lookup key. */
  id: string;
  section: AnatomySection;
  /** Which screen the row is about. `both` when the chrome is shared. */
  screen: 'items' | 'categories' | 'both';
  element: string;
  /** What the host admin does, quoted from `source`. */
  admin: string;
  /** What Showcase does. */
  showcase: string;
  verdict: Verdict;
  /** REQUIRED on `differs`. Asserted by the test — a bare DIFFERS is useless. */
  why?: string;
  kitGap?: KitGap;
  /** Host file the `admin` value was read from. */
  source: string;
  /**
   * Contract classes this row's element must emit. The DOM test asserts every
   * one of them appears in the rendered Showcase markup. Empty for rows about
   * something that is deliberately NOT rendered (the desktop page heading).
   */
  contract: string[];
}

const FILTER_BAR = 'packages/flashmandu/ui-components/resources/views/components/filter-bar.blade.php';
const INDEX_SHELL = 'resources/views/components/ui/index-shell.blade.php';
const ITEMS_INDEX = 'resources/views/livewire/items/index.blade.php';
const ITEMS_COMPONENT = 'app/Livewire/Items/Index.php';
const CATEGORIES_INDEX = 'resources/views/livewire/categories/index.blade.php';
const CATEGORIES_COMPONENT = 'app/Livewire/Categories/Index.php';

export const ANATOMY: AnatomyRow[] = [
  /* ─────────────────────────────── page ─────────────────────────────── */
  {
    id: 'page.gutter',
    section: 'page',
    screen: 'both',
    element: 'Page gutter',
    admin: 'The admin layout owns the gutter; the index view starts straight at its heading row with no container of its own.',
    showcase: '`<Container>` → `.fm-container`, because the host embed shell is full-bleed (`p-0!`) and the app owns the gutter inside the iframe.',
    verdict: 'differs',
    why: 'Structural, and the fix for the original bug rather than a regression: an embedded app that renders no container inherits the full-bleed shell and looks like a raw Next.js page. Parity spec §0 lists "wrong gutters" as exactly this. The measured inset is the same token either way.',
    source: ITEMS_INDEX,
    contract: ['fm-container'],
  },
  {
    id: 'page.heading',
    section: 'page',
    screen: 'both',
    element: 'Page heading + subtitle',
    admin: '`<flux:heading size="xl">Items</flux:heading>` with `<flux:text variant="subtitle">`, inside `mb-6 flex flex-col gap-4 lg:flex-row lg:items-center`.',
    showcase: 'Nothing on desktop. The title and trail are published to the HOST command bar via `usePageChrome`; below `lg` the same strings render through `MobilePageHeader` (`.fm-mobile-page-header`, `lg:hidden` by construction).',
    verdict: 'differs',
    why: 'Deliberate, by the design-system doctrine the parity spec sets out (§5): the host owns page chrome, and an in-page desktop title bar is precisely what makes an embed look bolted on. The admin renders its own heading because it IS the host.',
    source: ITEMS_INDEX,
    contract: ['fm-mobile-page-header', 'fm-mobile-page-header__title'],
  },
  {
    id: 'page.action-order',
    section: 'page',
    screen: 'items',
    element: 'Primary/secondary action ORDER',
    admin: 'Import (outline, sm, `arrow-up-tray`) → Export (outline, sm, `arrow-down-tray`) → New Item (**primary**, sm, `plus`). Secondaries first, primary LAST, the whole group pushed right with `lg:ml-auto`.',
    showcase: 'The same three, in the same order, as the `actions` array on `usePageChrome`: `import` (subtle) → `export` (subtle) → `create` (primary). The host renders them right-aligned in its command bar, primary last.',
    verdict: 'match',
    source: ITEMS_INDEX,
    contract: ['fm-mobile-page-header__actions', 'fm-btn--primary', 'fm-btn--subtle'],
  },
  {
    id: 'page.action-icons',
    section: 'page',
    screen: 'items',
    element: 'Action icons',
    admin: 'Heroicons `arrow-up-tray` (Import), `arrow-down-tray` (Export), `plus` (New Item), rendered by Flux with no allow-list in the way.',
    showcase: '`arrow-down-tray` and `plus` render; **Import renders with no icon**.',
    verdict: 'differs',
    why: 'The host\'s page-action icon allow-list is exactly six names — `check, plus, trash, arrow-path, pencil-square, arrow-down-tray` — and `arrow-up-tray` is not among them. An unknown name is an OMISSION rather than a rejection (the button still renders, the SDK warns once), so the payload is accepted and the Import button simply has no glyph. No embedded app can currently reproduce an upload-shaped action icon.',
    source: 'lib/playgrounds/chrome-specs.ts (mirroring the host\'s PAGE_ACTION_ICONS)',
    contract: [],
  },
  {
    id: 'page.view-toggle',
    section: 'page',
    screen: 'categories',
    element: 'View toggle placement',
    admin: 'A hand-rolled segmented control (`bg-gray-100 rounded-lg p-1`, active segment `bg-white shadow-sm`) sits in the heading row, BEFORE the primary "New Category" button.',
    showcase: '`<SegmentedControl>` → `.fm-tabs` / `.fm-tab`, in the FilterBar\'s `viewMode` slot.',
    verdict: 'differs',
    why: 'Two causes, and only one is Showcase\'s. (a) The admin builds the control out of raw Tailwind instead of the kit — that is a host gap, and it is why the two do not measure the same today. (b) The kit puts a view switcher in the FilterBar\'s dedicated `viewMode` slot rather than in the heading row, which is where the host is heading; the heading row is command-bar territory in an embed and cannot hold it.',
    source: CATEGORIES_INDEX,
    contract: ['fm-tabs', 'fm-tab'],
  },
  {
    id: 'page.tabs',
    section: 'page',
    screen: 'both',
    element: 'Tab row',
    admin: 'Neither Items nor Categories has one. The Items page has no tab strip at all; Categories\' "Sortable / Table" pair is a view toggle, not tabs.',
    showcase: 'None. The Showcase screens render no tab row either.',
    verdict: 'match',
    source: ITEMS_INDEX,
    contract: [],
  },

  /* ───────────────────────────── filter bar ─────────────────────────── */
  {
    id: 'filterbar.root',
    section: 'filterbar',
    screen: 'both',
    element: 'Filter bar root',
    admin: '`<div class="fm-filter-bar" role="search">` — the blade owns no geometry, every measure comes from the kit stylesheet.',
    showcase: '`<FilterBar>` → the identical `.fm-filter-bar` + `role="search"`.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar'],
  },
  {
    id: 'filterbar.row',
    section: 'filterbar',
    screen: 'both',
    element: 'Control row',
    admin: '`.fm-filter-bar__row` — the only `position: relative` in the bar, so the panel and every popover hang under the WELL rather than under the chip row.',
    showcase: '`.fm-filter-bar__row`, same role.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__row'],
  },
  {
    id: 'filterbar.group',
    section: 'filterbar',
    screen: 'both',
    element: 'The search WELL',
    admin: 'ONE bordered group, `.fm-filter-bar__group`, holding `[Filter ▾][search input][×][pin]`. The focus ring is on the WELL via `.fm-filter-bar__group:focus-within`, never on the input.',
    showcase: 'The same single `.fm-filter-bar__group` with the same four children in the same order.',
    verdict: 'match',
    why: undefined,
    source: FILTER_BAR,
    contract: ['fm-filter-bar__group'],
  },
  {
    id: 'filterbar.filter-trigger',
    section: 'filterbar',
    screen: 'both',
    element: 'Attached "Filter ▾" button',
    admin: '`.fm-filter-bar__filter` — sliders icon, the word "Filter", the active-count badge, a chevron. Attached to the left edge INSIDE the well.',
    showcase: 'Identical `.fm-filter-bar__filter` from the kit, same four children.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__filter'],
  },
  {
    id: 'filterbar.filter-count',
    section: 'filterbar',
    screen: 'both',
    element: 'Active-filter count badge',
    admin: '`.fm-filter-bar__filter-count`, rendered only when `$activeCount > 0`. A select sitting at its declared `default` does NOT count.',
    showcase: '`.fm-filter-bar__filter-count`, populated from the kit\'s exported `buildFilterChips`, which applies the same default-is-not-a-filter rule.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__filter-count'],
  },
  {
    id: 'filterbar.search-input',
    section: 'filterbar',
    screen: 'both',
    element: 'Search box',
    admin: '`<input type="text" class="fm-filter-bar__search-input">`, `wire:model.live.debounce.300ms`, placeholder from the schema\'s `label` — "Search items..." / "Search categories...". Focus opens the panel; typing closes it.',
    showcase: '`<input type="search" class="fm-filter-bar__search-input">` with the same placeholders and the same focus-opens / typing-closes behaviour. Showcase debounces at 300 ms before re-issuing `items(query:)`.',
    verdict: 'differs',
    why: 'Only the input `type` differs: the kit uses `type="search"` (which the host blade does not), and Safari/Chrome then paint a native clear affordance next to the kit\'s own `.fm-filter-bar__clear-search`. Geometry, placeholder, debounce and panel behaviour are identical. Listed as a kit gap because the duplicate control is a real visual defect at the exact spot the original complaint pointed at.',
    kitGap: {
      selector: 'FilterBar search `<input>` (dist/react.js) — or `.fm-filter-bar__search-input`',
      declaration:
        'Either change the element to `type="text"` to match filter-bar.blade.php, or keep `type="search"` and add `.fm-filter-bar__search-input::-webkit-search-cancel-button { display: none; -webkit-appearance: none; }` so the browser\'s clear button does not sit beside `.fm-filter-bar__clear-search`.',
    },
    source: FILTER_BAR,
    contract: ['fm-filter-bar__search-input'],
  },
  {
    id: 'filterbar.clear-search',
    section: 'filterbar',
    screen: 'both',
    element: 'Search × (clear)',
    admin: '`.fm-filter-bar__clear-search`, shown whenever the search box has a value, right of the input, inside the well.',
    showcase: 'Same class, same conditional, same position.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__clear-search'],
  },
  {
    id: 'filterbar.pin',
    section: 'filterbar',
    screen: 'both',
    element: 'Pin (save filter as default)',
    admin: '`.fm-filter-bar__pin`, `--set` when the current filters match the saved default. Rendered only while a filter is active. Key: `filters.{scope}.{profileId}` in `localStorage`.',
    showcase: 'Same classes, same conditional, and the kit\'s `filterDefaultsStorageKey()` produces the identical `filters.{scope}.{profileId}` key — Showcase passes `scope: "items"` / `"categories"` so it cannot collide with the host\'s.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__pin'],
  },
  {
    id: 'filterbar.trailing',
    section: 'filterbar',
    screen: 'items',
    element: 'Actions slot (right of the well)',
    admin: '`.fm-filter-bar__trailing hidden sm:flex`. Items puts its sort/columns "view options" icon button here.',
    showcase: '`.fm-filter-bar__trailing` via the kit\'s `actions` prop, holding the same view-options control.',
    verdict: 'match',
    source: ITEMS_INDEX,
    contract: ['fm-filter-bar__trailing'],
  },
  {
    id: 'filterbar.view-options',
    section: 'filterbar',
    screen: 'items',
    element: 'Sort / Columns menu',
    admin: 'A bespoke Alpine dropdown: `h-10 rounded-lg border border-zinc-200 bg-white px-2.5`, panel `w-60 rounded-lg border p-1 shadow-xl`, rows `rounded px-3 py-1.5 text-sm hover:bg-zinc-100`, and a `text-violet-600` checkbox. None of it goes through the kit.',
    showcase: '`<IconButton>` + `<Dropdown>` → `.fm-btn--icon` / `.fm-dropdown__menu` / `.fm-dropdown__item`. Zero bespoke geometry.',
    verdict: 'differs',
    why: 'The admin side is the one out of contract here, not Showcase: it hand-rolls a control the kit already ships, which is why its height, radius and hover surface do not match anything else on the row. It also uses `text-violet-600`, which the house rule forbids (no purple; green or black). Showcase renders the kit control, so this row is a HOST bug the parity build surfaced.',
    source: ITEMS_INDEX,
    contract: ['fm-dropdown__menu', 'fm-dropdown__item'],
  },
  {
    id: 'filterbar.panel',
    section: 'filterbar',
    screen: 'both',
    element: '"Filter by" panel',
    admin: '`.fm-filter-bar__panel`, `role="menu"`, opened by the Filter button OR by focusing the search box. "Quick filters" group, `.fm-filter-bar__panel-divider`, then "Filter by" with one `.fm-filter-bar__panel-item` per field.',
    showcase: 'Same classes, same two groups, same divider, same open triggers.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-bar__panel', 'fm-filter-bar__panel-item', 'fm-filter__group-label'],
  },
  {
    id: 'filterbar.quickfilters',
    section: 'filterbar',
    screen: 'items',
    element: 'Quick-filter derivation',
    admin: 'Scan filterable select/multiselect fields in declaration order; the first is the candidate, but a later key matching `/status|state|type|kind/i` wins and ends the scan. On Items that is **Type** (menu / inventory / expense), because `type` is declared before `status`.',
    showcase: 'The kit\'s `deriveQuickFilters()` implements the identical rule — but Showcase has no `type` field to offer, so the derivation lands on **Status** instead.',
    verdict: 'differs',
    why: 'The RULE matches exactly (same regex, same first-wins-unless-status/type scan; the kit exports it as a pure function precisely so it can be diffed). The RESULT differs because `CatalogItem` on the platform schema has no item-type field — see the schema gaps section. Not a styling difference.',
    source: ITEMS_COMPONENT,
    contract: [],
  },
  {
    id: 'filterbar.popover',
    section: 'filterbar',
    screen: 'both',
    element: 'Per-field popover',
    admin: '`.fm-filter__popover` with `.fm-filter__popover-head` / `-title` / `-close`; one open at a time; anchored under the bar. `select` renders a scrollable `.fm-filter__option` list (searchable past 8 options), `numberrange` a `.fm-filter__range`, `multiselect` an `.fm-filter__operator` is/is-not toggle.',
    showcase: 'Same classes and the same one-at-a-time rule, for each field type Showcase can actually offer.',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter__popover', 'fm-filter__popover-head', 'fm-filter__option'],
  },
  {
    id: 'filterbar.chips',
    section: 'filterbar',
    screen: 'both',
    element: 'Active-filter chips',
    admin: '`.fm-filter-chips` under the row. Each chip: `.fm-filter-chip__label` (clicking REOPENS that field\'s popover) + `.fm-filter-chip__remove`. One trailing `.fm-filter-clear` "Clear all".',
    showcase: 'Same classes, same label-reopens-popover behaviour, same single "Clear all".',
    verdict: 'match',
    source: FILTER_BAR,
    contract: ['fm-filter-chips', 'fm-filter-chip', 'fm-filter-chip__label', 'fm-filter-chip__remove', 'fm-filter-clear'],
  },
  {
    id: 'filterbar.perpage',
    section: 'filterbar',
    screen: 'categories',
    element: 'Per-page selector',
    admin: 'Declared with `chip => false`: it is a DISPLAY PREFERENCE, so it gets no chip, no entry in the Filter menu, and is never written to the pinned default.',
    showcase: 'The same field with the kit\'s `chip: false`, which the kit\'s `filterableFields()` honours identically.',
    verdict: 'match',
    source: CATEGORIES_COMPONENT,
    contract: [],
  },

  /* ─────────────────────────────── table ────────────────────────────── */
  {
    id: 'table.shell',
    section: 'table',
    screen: 'both',
    element: 'Index shell',
    admin: '`<x-ui.index-shell>` — now emitting `.fm-index-shell` / `.fm-index-viewport` / `.fm-index-rail` / `.fm-index-xbar` / `.fm-index-footer` with no geometry of its own (it carried `md:rounded-lg md:border md:bg-white` + `overflow-x-clip` Tailwind until the shell was moved onto the contract mid-session).',
    showcase: '`<IndexShell>` → the identical five classes. Same `overflow-x: clip` trick, same translateX strip, same reason.',
    verdict: 'match',
    why: undefined,
    source: INDEX_SHELL,
    contract: ['fm-index-shell', 'fm-index-viewport', 'fm-index-rail'],
  },
  {
    id: 'table.sticky-head',
    section: 'table',
    screen: 'both',
    element: 'Sticky column header offset',
    admin: '`<thead class="sticky top-0 lg:top-14 z-10">` — 56 px at `lg`, the height of the host command bar the header must park under.',
    showcase: 'The kit pins to `top: 0`, unconditionally.',
    verdict: 'differs',
    why: 'Correct in both places. Inside the embed iframe there is no `h-14` command bar above the table — the bar is OUTSIDE the iframe — so a 56 px offset would leave a 56 px dead band at the top of every scrolled table. The kit documents this as the one deliberate divergence from the host shell.',
    source: INDEX_SHELL,
    contract: [],
  },
  {
    id: 'table.pinned-col',
    section: 'table',
    screen: 'both',
    element: 'Pinned first column',
    admin: '`data-pinned-col` on the Item / Category `<th>` and `<td>`; the shell counter-translates it by the scroll OVERSHOOT so it slides with the row and only holds at the left edge.',
    showcase: '`pinned: true` on the first `IndexTableColumn`, which emits the same `data-pinned-col` and runs the same overshoot maths.',
    verdict: 'match',
    source: INDEX_SHELL,
    contract: ['fm-index-table'],
  },
  {
    id: 'table.select-col',
    section: 'table',
    screen: 'items',
    element: 'Selection column',
    admin: 'A leading `w-10 px-2 py-3 text-center` `<th>` with a tri-state checkbox, rendered only when the merchant can print labels, delete or manage. Selecting rows SWAPS the whole header row for a bulk-action row.',
    showcase: '`selectable` on `IndexTable` → `.fm-index-table__select` with the same tri-state checkbox; selection raises the kit\'s floating `.fm-bulk-bar` instead of swapping the header row.',
    verdict: 'differs',
    why: 'Behavioural, and the kit\'s is the newer pattern the parity spec adopts: a floating bulk bar keeps the column headers on screen while a selection exists, where the admin\'s header swap hides them. Same capability, and the admin is expected to move onto `.fm-bulk-bar` — not a Showcase-side deviation.',
    source: ITEMS_INDEX,
    contract: ['fm-index-table__select', 'fm-bulk-bar'],
  },
  {
    id: 'table.columns-items',
    section: 'table',
    screen: 'items',
    element: 'Column set',
    admin: 'Image · **Item** (pinned) · SKU · Scan · {Identifier} · Type · Category · Price · Tax · Stock · Related · Outlet · Actions, each toggleable from the view menu and persisted to `localStorage` under `items.cols`.',
    showcase: 'Image · **Item** (pinned) · SKU · Category · Price · Status · Actions, toggleable from the same view menu and persisted under the same `items.cols` key shape.',
    verdict: 'differs',
    why: 'A schema gap, not a design one. `CatalogItem` exposes exactly `id, name, sku, priceMinor, isActive, categoryId, imageUrl` — there is no item type, no tax, no stock level, no related-items edge, no outlet and no scan/identifier field on the app-facing GraphQL surface. Showcase renders the columns it can fill with real platform data and names the rest as gaps rather than rendering perpetual em-dashes.',
    source: ITEMS_INDEX,
    contract: [],
  },
  {
    id: 'table.row-actions',
    section: 'table',
    screen: 'both',
    element: 'Row actions',
    admin: 'Tinted outline icon buttons forced with `!important` Tailwind: `!border-blue-500 !bg-blue-50 hover:!bg-blue-100` for edit, `!border-red-500 !bg-red-50` for delete, each wrapped in a `flux:tooltip`.',
    showcase: '`<IconButton variant="edit">` / `variant="delete"` → `.fm-btn .fm-btn--icon .fm-btn--edit` / `--delete`, inside `.fm-row-actions`. No `!important`, no colour literals.',
    verdict: 'differs',
    why: 'Same intent, same tint, but the admin reaches it by overriding Flux with `!important` utilities instead of using the kit variants that exist for it. Another host-side contract break the parity build surfaced; the rendered result is close, the maintenance story is not.',
    source: CATEGORIES_INDEX,
    contract: ['fm-row-actions', 'fm-btn--edit', 'fm-btn--delete'],
  },
  {
    id: 'table.mobile',
    section: 'table',
    screen: 'both',
    element: 'Below-`md` layout',
    admin: 'The table is `hidden md:block` and a SECOND markup path renders one bordered card per row (`md:hidden py-2 space-y-2`), with label/value pairs and the action row at the bottom.',
    showcase: 'One `IndexTable` at every width; narrow viewports scroll it sideways through the shell\'s strip.',
    verdict: 'differs',
    why: 'A genuine kit gap. `IndexTable` has no card-per-row mode, so an embedded app cannot reach the admin\'s mobile layout out of the kit at all — and hand-rolling one in Showcase is exactly the bespoke geometry this exercise forbids. Stated below with the shape it needs.',
    kitGap: {
      selector: '`IndexTable` (dist/react.js) + `.fm-index-table--cards`',
      declaration:
        'Add a `mobile?: "scroll" | "cards"` prop (default `"scroll"`, so nothing changes for existing callers). Under `"cards"` render a second `<ul class="fm-index-cards">` sibling and gate the pair on the breakpoint in CSS, mirroring the host: `.fm-index-table { display: none } .fm-index-cards { display: grid; gap: var(--fm-space-2) } @media (min-width: 48rem) { .fm-index-table { display: table } .fm-index-cards { display: none } }`. Each card carries the pinned column as its heading, the remaining columns as label/value rows, and `rowActions` in a bottom strip.',
    },
    source: ITEMS_INDEX,
    contract: [],
  },
  {
    id: 'table.sort',
    section: 'table',
    screen: 'items',
    element: 'Sort control',
    admin: 'Sorting is NOT on the column headers: it lives in the view menu ("Sort by": Name / SKU / Price / Date Created), calls `setSort()` on the server, and shows an up/down arrow next to the active field.',
    showcase: 'Both. The same four entries in the view menu, plus sortable column headers (`.fm-index-sort`) — but the sort is applied to the page already walked, and the screen says so.',
    verdict: 'differs',
    why: 'The platform list query takes `first`, `after`, `updatedAtMin` and `query` and nothing else — there is no `orderBy` argument on `items`, and walk order is fixed at `(updated_at, id)`. A server-side "Date Created" sort is therefore not expressible over the app API at all. Showcase sorts what it has walked and labels it, instead of implying a server sort it cannot perform.',
    source: ITEMS_INDEX,
    contract: ['fm-index-sort'],
  },

  /* ─────────────────────────────── footer ───────────────────────────── */
  {
    id: 'footer.pagination',
    section: 'footer',
    screen: 'both',
    element: 'Pagination footer',
    admin: '`<x-slot:footer>` holding `{{ $this->items->links() }}`, wrapped by the shell in `.fm-index-footer` / `.fm-index-footer__inner--flush` (the page still supplies its own `px-4 md:px-6 py-4`, which is why the shell variant is the flush one), and DROPPED entirely when the paginator renders nothing so no blank bordered strip is left.',
    showcase: '`<Pagination>` in the shell\'s `footer` slot → `.fm-index-footer` / `.fm-pagination`; the kit\'s `Pagination` returns `null` on a single page, which reproduces the same drop with no guard in app code.',
    verdict: 'match',
    source: INDEX_SHELL,
    contract: ['fm-index-footer', 'fm-pagination'],
  },
  {
    id: 'footer.paging-model',
    section: 'footer',
    screen: 'both',
    element: 'Paging model',
    admin: 'Laravel offset pagination — numbered pages, a total count, jump to any page.',
    showcase: 'Keyset. The platform exposes `pageInfo { hasNextPage endCursor }` and no total; Showcase walks pages and paginates the walked set locally, so the numbers are honest about what has been fetched.',
    verdict: 'differs',
    why: 'Forced by the API surface, and deliberately so: `CatalogPort::list` is keyset-only, capped at 100 per page, ordered `(updated_at, id)` so a walk stays consistent under concurrent writes. There is no total-count field to render, and inventing one would be the mock-data green the spec forbids.',
    source: ITEMS_COMPONENT,
    contract: [],
  },

  /* ─────────────────────────────── empty ────────────────────────────── */
  {
    id: 'empty.state',
    section: 'empty',
    screen: 'both',
    element: 'Empty state',
    admin: '`py-12 text-center`: a 48 px `text-gray-400` glyph, `flux:heading size="md" text-gray-500`, `flux:text text-gray-400`, then the primary CTA ("Create Item" / "Create Category").',
    showcase: '`<EmptyState icon title description action>` → `.fm-empty` / `__icon` / `__title` / `__description` / `__action`, with the same CTA.',
    verdict: 'match',
    source: ITEMS_INDEX,
    contract: ['fm-empty', 'fm-empty__title', 'fm-empty__description'],
  },
  {
    id: 'empty.vs-denied',
    section: 'empty',
    screen: 'both',
    element: 'Empty vs denied',
    admin: 'No distinction — an unauthorised merchant never reaches the route, so the index only ever renders "no rows".',
    showcase: 'Two states. A genuinely empty result renders `.fm-empty`; a `SCOPE_DENIED` GraphQL extension renders a `.fm-callout--danger` naming the missing scope.',
    verdict: 'differs',
    why: 'An app CAN be installed without `read:catalog` while the merchant themselves has full access, so "zero rows" and "you were refused" are different facts inside an embed and must not share a rendering. The host has no equivalent case.',
    source: ITEMS_INDEX,
    contract: ['fm-callout'],
  },
];

/** Every kit gap found, in table order. Named, never patched — see the docblock. */
export const KIT_GAPS: (KitGap & { rowId: string; element: string })[] = ANATOMY.filter(
  (row): row is AnatomyRow & { kitGap: KitGap } => row.kitGap !== undefined,
).map((row) => ({ rowId: row.id, element: row.element, ...row.kitGap }));

/**
 * Kit gaps that are not attached to one anatomical element — API shapes that
 * make it EASY to reintroduce the bespoke geometry this exercise removes.
 *
 * Same rule as `KIT_GAPS`: written down with the exact change needed, never
 * patched from here.
 */
export const KIT_API_GAPS: (KitGap & { element: string })[] = [
  {
    element: '⚠ TOOLING, not the kit — a stale `.next/cache` survives an in-place bridge upgrade',
    selector: 'Showcase / any app vendoring `@flashmandu/app-bridge` as a `file:` tarball',
    declaration:
      "Bumping the vendored bridge tarball and re-installing does NOT invalidate Next's persistent webpack cache. The client bundle keeps compiling the PREVIOUS bridge build, so anything added in the new version is simply absent from the browser — the /search screen died on hydration with `TypeError: (0, l.isPlatformOwnedSearchType) is not a function` and `x.bridge.setSearchProvider is not a function`, both naming exports that were sitting in `node_modules` the whole time. It only reproduces in a production build (`next dev` recompiles), and the SERVER render succeeds, so the page 200s and then blanks. `rm -rf .next && npm run build` fixes it completely. Worth a line in the app-developer docs and, better, a `postinstall` that clears `.next/cache` when a `file:` dependency's mtime moves. Recorded here because it cost this task an hour and would cost every app developer the same hour, with a stack trace that points at the SDK rather than at the cache.",
  },
  {
    element: '✅ CLOSED — `Flex` / `Stack` / `Grid` numeric `gap`',
    selector: '`Flex`, `Stack`, `Grid` (dist/react.js)',
    declaration:
      'WAS: a numeric `gap` was emitted as RAW PIXELS — `gap={3}` became `gap: 3px`, not three spacing steps — so the kit\'s own layout primitives were the shortest path back to hand-written geometry, silently and while looking correct. FIXED in the kit (v0.3.0, commit 36e58cf) by a route better than the one suggested here: `gap` is now the closed union `SpaceToken = tight | default | loose | section`, so a raw number or a `var()` string no longer typechecks at all, rather than being mapped onto the scale. Escaping the scale is now a compile error instead of a silent success, which is the stronger guarantee. Showcase\'s one raw-string call site (`TransportNote`, `gap="var(--fm-space-2)"`) became `gap="tight"` — the identical 8px, now named.',
  },
];

/**
 * Fields the admin's own index pages render that the app-facing GraphQL schema
 * does not expose, so no embedded app can reach parity on them today.
 *
 * Reported, not worked around: `packages/flashmandu/apps/graphql/` is host
 * schema and this task does not add to it.
 */
export const SCHEMA_GAPS: { field: string; neededBy: string; today: string }[] = [
  {
    field: '`CatalogItem.type`',
    neededBy: 'The Items filter bar\'s FIRST filter, and the source of its quick filters (menu / inventory / expense).',
    today: 'Absent. `CatalogItem` is `id, name, sku, priceMinor, isActive, categoryId, imageUrl` (types/remote-app.graphql:127).',
  },
  {
    field: '`CatalogItem.stockLevel` / `taxRate` / `outletId`',
    neededBy: 'The Stock filter and the Stock / Tax / Outlet columns.',
    today: 'Absent. The admin reads them off the Eloquent model directly.',
  },
  {
    field: '`CatalogItem.categoryName` (or a `categories` query)',
    neededBy: 'The Category column and the Category filter on Items, and the WHOLE Categories screen.',
    today: '`categoryId: Int` only. There is no `categories` root field on the schema at all, so an app can group by id but can never name, order, activate or count a category the way `resources/views/livewire/categories/index.blade.php` does.',
  },
  {
    field: '`CatalogItem.updatedAt` / `createdAt`',
    neededBy: 'The view menu\'s "Date Created" sort.',
    today: 'Absent from the selection set. The connection orders by `(updated_at, id)` internally but never returns the value.',
  },
  {
    field: 'A category tree / reorder mutation',
    neededBy: 'The Categories page\'s default "Sortable" view — a 3-level drag-and-drop tree writing back through `updateCategoryOrder`.',
    today: 'Nothing equivalent exists on the app API. Showcase renders the segmented control with the Sortable option present and disabled, and says why on screen.',
  },
];

export function anatomyRow(id: string): AnatomyRow {
  const found = ANATOMY.find((row) => row.id === id);
  if (found === undefined) {
    throw new Error(`No parity anatomy row "${id}"`);
  }
  return found;
}

export function rowsForScreen(screen: 'items' | 'categories'): AnatomyRow[] {
  return ANATOMY.filter((row) => row.screen === screen || row.screen === 'both');
}

/** MATCH / DIFFERS tally, as the doc and the Overview both quote it. */
export function anatomyTally(): { total: number; match: number; differs: number } {
  const match = ANATOMY.filter((row) => row.verdict === 'match').length;
  return { total: ANATOMY.length, match, differs: ANATOMY.length - match };
}
