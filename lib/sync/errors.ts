/**
 * The three failure shapes a list walk has to tell apart.
 *
 * The platform draws a distinction the docs call out explicitly and that a
 * sync engine MUST honour, because the correct reaction differs in each case:
 *
 * 1. **SCOPE_DENIED** — HTTP **200** with a GraphQL error in `errors[]`
 *    carrying `extensions.code = "SCOPE_DENIED"` and the scope that was
 *    missing. It is not a transport failure and it is not retryable: the
 *    merchant did not grant that scope. One denied domain must park itself and
 *    let the other seven finish.
 * 2. **Transport error** — 401/403/5xx (or a network throw). The token or the
 *    box is wrong; every domain is affected, so retrying the same call harder
 *    is pointless within a run.
 * 3. **Invalid cursor** — the stored `endCursor` is unusable. Recoverable by
 *    dropping the cursor and re-walking the domain from the start.
 *
 * On the current host, case 3 never arrives as an error at all: the platform's
 * `KeysetCursor::decode` returns null for an unreadable cursor and the port
 * serves page one, deliberately, so an app is never stranded mid-walk. The
 * detector below still exists — a future host, or a cursor that expired rather
 * than corrupted, may well answer with an error — and the engine additionally
 * carries a transport-independent **non-advancing-cursor** guard that catches
 * the silent-rewind shape. See `engine.ts`.
 */

/** A GraphQL error as it appears in the `errors[]` array of a 200 response. */
export interface GraphQLErrorShape {
  message: string;
  path?: ReadonlyArray<string | number>;
  extensions?: Record<string, unknown> & { code?: string; scope?: string };
}

/** A GraphQL response envelope. `data` and `errors` can both be present. */
export interface GraphQLResult<T = unknown> {
  data?: T | null;
  errors?: GraphQLErrorShape[];
}

/** Non-200, or the fetch itself threw. Affects every domain in the run. */
export class TransportError extends Error {
  readonly kind = 'transport' as const;

  constructor(
    message: string,
    readonly status: number | null,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** 200 + `extensions.code === 'SCOPE_DENIED'`. Affects exactly one domain. */
export class ScopeDeniedError extends Error {
  readonly kind = 'scope-denied' as const;

  constructor(
    message: string,
    readonly scope: string | null,
  ) {
    super(message);
    this.name = 'ScopeDeniedError';
  }
}

/** The stored cursor is unusable; the domain re-walks from the beginning. */
export class InvalidCursorError extends Error {
  readonly kind = 'invalid-cursor' as const;

  constructor(
    message: string,
    readonly cursor: string | null,
  ) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

/** A GraphQL error that is none of the above. Fails its domain, not the run. */
export class QueryError extends Error {
  readonly kind = 'query' as const;

  constructor(
    message: string,
    readonly errors: GraphQLErrorShape[],
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export type SyncError = TransportError | ScopeDeniedError | InvalidCursorError | QueryError;

/** Error-extension codes a host may use to reject a cursor. */
const CURSOR_CODES = new Set(['INVALID_CURSOR', 'BAD_CURSOR', 'CURSOR_EXPIRED', 'EXPIRED_CURSOR']);

/**
 * `after`-shaped failures also show up as a plain validation message on hosts
 * that do not classify. Matched narrowly — "cursor" plus a rejection verb —
 * so a business error merely *mentioning* a cursor is not mistaken for one.
 */
const CURSOR_MESSAGE = /\bcursor\b[^.]*\b(invalid|malformed|expired|unreadable|could not be)\b|\b(invalid|malformed|expired|unreadable)\b[^.]*\bcursor\b/i;

/**
 * Turn an `errors[]` array into the one error the caller should react to.
 *
 * Precedence is deliberate: a scope denial outranks everything (it explains
 * the whole domain), then a cursor rejection (recoverable), then anything
 * else. Returns null when the array is empty — a response carrying only
 * partial-data errors on unrelated fields is not this engine's problem.
 */
export function classifyGraphQLErrors(
  errors: GraphQLErrorShape[] | undefined,
  cursor: string | null = null,
): SyncError | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const denied = errors.find((e) => e.extensions?.code === 'SCOPE_DENIED');
  if (denied) {
    const scope = typeof denied.extensions?.scope === 'string' ? denied.extensions.scope : null;
    return new ScopeDeniedError(denied.message, scope);
  }

  const badCursor = errors.find(
    (e) =>
      (typeof e.extensions?.code === 'string' && CURSOR_CODES.has(e.extensions.code)) ||
      CURSOR_MESSAGE.test(e.message),
  );
  if (badCursor) {
    return new InvalidCursorError(badCursor.message, cursor);
  }

  return new QueryError(errors.map((e) => e.message).join('; '), errors);
}

/** Narrow an unknown thrown value to the engine's error vocabulary. */
export function toSyncError(err: unknown): SyncError {
  if (
    err instanceof TransportError ||
    err instanceof ScopeDeniedError ||
    err instanceof InvalidCursorError ||
    err instanceof QueryError
  ) {
    return err;
  }
  return new TransportError(err instanceof Error ? err.message : String(err), null);
}
