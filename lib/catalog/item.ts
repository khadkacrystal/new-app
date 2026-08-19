/**
 * Server-side reads of the `items` domain.
 *
 * Uses the same bearer-token GraphQL transport as the sync engine
 * (`lib/sync/transport.ts`), so it needs `read:catalog` on the install's
 * token and runs only in Server Components, route handlers, or server
 * actions — never in the browser.
 */

import "server-only";

import {
  createHttpTransport,
  type GraphQLTransport,
} from "@/lib/sync/transport";
import { classifyGraphQLErrors } from "@/lib/sync/errors";

/** One row of `items`, as the platform serialises it. */
export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: number;
  isActive: boolean;
  categoryId: string | null;
  imageUrl: string | null;
}

export interface GetItemsPage {
  items: CatalogItem[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GetItemsOptions {
  /** Page size, clamped to 100 server-side. Defaults to 50. */
  first?: number;
  /** Opaque cursor from a previous page's `endCursor`. */
  after?: string | null;
  /** Only items updated at or after this ISO timestamp. */
  updatedAtMin?: string;
  /** Injected in tests; defaults to the bearer-token HTTP transport. */
  transport?: GraphQLTransport;
}

const GET_ITEMS_QUERY = `
  query GetItems($first: Int!, $after: String, $updatedAtMin: DateTime) {
    items(first: $first, after: $after, updatedAtMin: $updatedAtMin) {
      nodes {
        id
        name
        sku
        priceMinor
        isActive
        categoryId
        imageUrl
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface ItemsResponse {
  items: {
    nodes: CatalogItem[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } | null;
}

/**
 * Fetch one page of catalog items.
 *
 * Throws `ScopeDeniedError` / `TransportError` / `QueryError` (see
 * `lib/sync/errors.ts`) rather than returning an empty page on failure — a
 * denied scope or a bad token is not the same thing as "no items".
 */
export async function getItems(
  options: GetItemsOptions = {},
): Promise<GetItemsPage> {
  const {
    first = 50,
    after = null,
    updatedAtMin,
    transport = createHttpTransport(),
  } = options;

  const result = await transport<ItemsResponse>({
    query: GET_ITEMS_QUERY,
    variables: { first, after, updatedAtMin },
  });

  const error = classifyGraphQLErrors(result.errors, after);
  if (error) {
    throw error;
  }

  const connection = result.data?.items;
  return {
    items: connection?.nodes ?? [],
    hasNextPage: connection?.pageInfo.hasNextPage ?? false,
    endCursor: connection?.pageInfo.endCursor ?? null,
  };
}

/**
 * Walk every page and return the full item list.
 *
 * Fine for the catalog sizes this app targets; for a merchant with a very
 * large catalog, prefer `getItems` page-by-page instead of holding
 * everything in memory at once.
 */
export async function getAllItems(
  options: Omit<GetItemsOptions, "after"> = {},
): Promise<CatalogItem[]> {
  const all: CatalogItem[] = [];
  let after: string | null = null;

  do {
    const page = await getItems({ ...options, after });
    all.push(...page.items);
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  return all;
}
