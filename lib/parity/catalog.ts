/**
 * The read layer behind the Items and Categories parity screens.
 *
 * ## GraphQL only, over the direct-API path
 *
 * REST is being retired, so both screens go through `bridge.graphql()` —
 * `lib/data/transport.ts` owns that call and the transport badge it produces.
 * Token handling is NOT re-implemented here, and that is load-bearing rather
 * than tidy: the embed URL's `session_token` is not a direct-API credential,
 * and an app that grabs it off `location.search` and posts it to
 * `/api/apps/graphql` gets a 401 forever with nothing in the response to
 * explain why. The bridge tracks token PROVENANCE (`"embed-url"` vs `"host"`)
 * and its internal `getDirectApiToken()` force-refreshes before the first
 * direct call for exactly that reason. Calling `bridge.graphql()` is how an app
 * inherits that; hand-rolling the header is how it loses it.
 *
 * ## Why a query here rather than reusing `lib/sync/domains.ts`
 *
 * The sync engine's `ITEMS_PAGE` selects `first/after/updatedAtMin` because a
 * sync walk never searches. The admin's Items list DOES: its search box is a
 * server-side filter, so the parity screen has to send `items(query:)` — the
 * fourth argument the connection accepts (`types/items.graphql`) and the one
 * that makes the search box on this screen mean the same thing as the search
 * box on the admin's. Same connection, same scope, one more argument.
 */

import { classifyGraphQLErrors, type SyncError } from '@/lib/sync/errors';
import { callGraphQL, type CallMeta, type TransportBridge } from '@/lib/data/transport';

/**
 * Exactly the fields `CatalogItem` exposes. Selecting anything else takes the
 * whole query down, so this list is also the ceiling on what either screen can
 * render — see `SCHEMA_GAPS` in `anatomy.ts` for what that costs.
 */
export const CATALOG_ITEM_FIELDS = 'id name sku priceMinor isActive categoryId imageUrl';

export const ITEMS_PAGE_QUERY = `query ParityItems($first: Int!, $after: String, $query: String) {
  items(first: $first, after: $after, query: $query) {
    nodes { ${CATALOG_ITEM_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** One catalog item, typed to the schema rather than to `Record<string, unknown>`. */
export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: number;
  isActive: boolean;
  categoryId: number | null;
  imageUrl: string | null;
}

export interface CatalogPage {
  items: CatalogItem[];
  hasNextPage: boolean;
  endCursor: string | null;
  meta: CallMeta;
  /** Classified failure — SCOPE_DENIED, a bad cursor, a transport error. */
  error: SyncError | null;
}

interface ItemsData {
  items: {
    nodes: CatalogItem[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } | null;
}

/**
 * Read one keyset page.
 *
 * `first` is clamped to the server's own ceiling (`CatalogPort::MAX_PAGE_SIZE`
 * = 100) here rather than being left to the server, so the number the screen
 * PRINTS as "requested" is the number that was actually honoured.
 */
export async function fetchItemsPage(
  bridge: TransportBridge,
  request: { first: number; after?: string | null; query?: string | null },
): Promise<CatalogPage> {
  const first = Math.max(1, Math.min(request.first, 100));
  const term = (request.query ?? '').trim();

  const { result, meta } = await callGraphQL<ItemsData>(
    bridge,
    {
      query: ITEMS_PAGE_QUERY,
      variables: { first, after: request.after ?? null, query: term === '' ? null : term },
    },
    {
      label: `items(first: ${first}${request.after ? ', after' : ''}${term === '' ? '' : ', query'})`,
      // No proxy plan: `/api/apps/proxy` has no GraphQL path, and the REST
      // allow-list's `catalog/items` cannot express `query`. Reporting
      // `unavailable` is the honest outcome; a silent shape-shift to a
      // different read would make the transport badge lie.
      proxy: null,
    },
  );

  if (meta.kind === 'unavailable') {
    return { items: [], hasNextPage: false, endCursor: null, meta, error: null };
  }

  const error = classifyGraphQLErrors(result.errors, request.after ?? null);
  if (error !== null) {
    return { items: [], hasNextPage: false, endCursor: null, meta, error };
  }

  const connection = result.data?.items ?? null;
  return {
    items: connection?.nodes ?? [],
    hasNextPage: connection?.pageInfo.hasNextPage ?? false,
    endCursor: connection?.pageInfo.endCursor ?? null,
    meta,
    error: null,
  };
}

/** One row of the Categories screen, derived — see `deriveCategories`. */
export interface DerivedCategory {
  /** `categoryId` as a string, or `uncategorised`. */
  id: string;
  /** Display name. Always synthetic — the schema returns no category name. */
  name: string;
  categoryId: number | null;
  itemCount: number;
  /** Items in this category that are active. Stands in for the admin's status. */
  activeCount: number;
}

/**
 * Group walked items by `categoryId`.
 *
 * This is the whole Categories data path, and it is a compromise stated on
 * screen rather than hidden: the platform's app-facing schema has NO
 * `categories` root field, so an app cannot read a category's name, its parent,
 * its sort order, its active flag or its image. `CatalogItem.categoryId` is the
 * only category-shaped fact an app is given, so the screen renders exactly what
 * that supports — an id, and how many walked items carry it — and names the gap
 * beside it. Inventing names would be the mock data the spec forbids.
 *
 * Deterministic order: by descending item count, then by id, so the same walk
 * always produces the same table.
 */
export function deriveCategories(items: CatalogItem[]): DerivedCategory[] {
  const buckets = new Map<string, DerivedCategory>();

  for (const item of items) {
    const id = item.categoryId === null ? 'uncategorised' : String(item.categoryId);
    const existing = buckets.get(id);
    if (existing === undefined) {
      buckets.set(id, {
        id,
        name: item.categoryId === null ? 'Uncategorised' : `Category #${item.categoryId}`,
        categoryId: item.categoryId,
        itemCount: 1,
        activeCount: item.isActive ? 1 : 0,
      });
      continue;
    }
    existing.itemCount += 1;
    if (item.isActive) {
      existing.activeCount += 1;
    }
  }

  return [...buckets.values()].sort(
    (a, b) => b.itemCount - a.itemCount || a.id.localeCompare(b.id),
  );
}
