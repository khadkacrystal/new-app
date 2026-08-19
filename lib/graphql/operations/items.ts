import type { GraphQLOperation } from "../types";

export const CATALOG_ITEM_FIELDS =
  "id name sku priceMinor isActive categoryId imageUrl";

export interface Item {
  id: string;
  name: string;
  sku: string;
  priceMinor: number;
  isActive: boolean;
  categoryId: string;
  imageUrl: string | null;
}

export interface ItemsData {
  items: {
    nodes: Item[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface ItemsVars {
  first: number;
  after?: string | null;
  query?: string;
}

export const ItemsQuery: GraphQLOperation<ItemsData, ItemsVars> = {
  document: `
    query ParityItems(
      $first: Int!
      $after: String
      $query: String
    ) {
      items(
        first: $first
        after: $after
        query: $query
      ) {
        nodes {
          ${CATALOG_ITEM_FIELDS}
        }

        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
};
