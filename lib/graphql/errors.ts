/**
 * One error vocabulary for every GraphQL call, regardless of which
 * transport made it (server fetch, client fetch, or anything else you add
 * later). `execute.ts` is the only place that should throw these.
 */

import type { GraphQLErrorShape } from "./types";

/** The server rejected the request outright — network failure, 5xx, timeout. */
export class TransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** The request reached the server, but the caller lacks a required permission/scope. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The query ran but returned a GraphQL-level error not covered by a more specific class. */
export class QueryError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphQLErrorShape[],
  ) {
    super(message);
    this.name = "QueryError";
  }
}

export type AppGraphQLError = TransportError | ForbiddenError | QueryError;

/**
 * Turn a GraphQL response's `errors` array into a typed error, or `null` if
 * there's nothing to report. Extend the `code` checks below to match
 * whatever error codes your actual API uses.
 */
export function classifyErrors(
  errors: GraphQLErrorShape[] | undefined,
): AppGraphQLError | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const forbidden = errors.find(
    (e) =>
      e.extensions?.code === "FORBIDDEN" ||
      e.extensions?.code === "UNAUTHENTICATED",
  );
  if (forbidden) {
    return new ForbiddenError(forbidden.message);
  }

  return new QueryError(errors.map((e) => e.message).join("; "), errors);
}

/** Normalizes any thrown value into one of our known error types. */
export function toAppGraphQLError(err: unknown): AppGraphQLError {
  if (
    err instanceof TransportError ||
    err instanceof ForbiddenError ||
    err instanceof QueryError
  ) {
    return err;
  }
  if (err instanceof Error) {
    return new TransportError(err.message);
  }
  return new TransportError(String(err));
}
