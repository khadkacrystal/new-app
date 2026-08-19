/**
 * Shared, transport-agnostic GraphQL types.
 *
 * Nothing in this file knows how a request is sent — that's `execute.ts`'s
 * job. This file only describes shapes: the envelope every GraphQL server
 * returns, and the generic connection/pagination pattern most schemas use.
 */

/** A single error entry inside a GraphQL response's `errors` array. */
export interface GraphQLErrorShape {
  message: string;
  path?: (string | number)[];
  extensions?: {
    code?: string;
    [key: string]: unknown;
  };
}

/**
 * The raw response envelope. `data` and `errors` can both be present at once
 * (a partial success) — never assume one implies the absence of the other.
 */
export interface GraphQLResult<T> {
  data: T | null;
  errors?: GraphQLErrorShape[];
}

/** Standard Relay-style pagination info, if your schema follows that convention. */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage?: boolean;
  endCursor: string | null;
  startCursor?: string | null;
}

/** A paginated connection of nodes, Relay-style. */
export interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

/**
 * Ties a query's document string to its response (`TData`) and variables
 * (`TVars`) types at compile time. The `__data`/`__vars` fields are never
 * assigned — they exist purely so `TData`/`TVars` can be inferred at the
 * call site instead of asserted with `as`.
 */
export interface GraphQLOperation<TData, TVars = Record<string, never>> {
  document: string;
  __data?: TData;
  __vars?: TVars;
}

/** Extracts the response type from a GraphQLOperation. */
export type OperationData<Op> =
  Op extends GraphQLOperation<infer TData, unknown> ? TData : never;

/** Extracts the variables type from a GraphQLOperation. */
export type OperationVars<Op> =
  Op extends GraphQLOperation<unknown, infer TVars> ? TVars : never;
