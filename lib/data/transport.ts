/**
 * The Data Browser's transport — and the reason every call on this screen
 * carries a transport badge.
 *
 * There are two ways an embedded app reaches the platform, and they are NOT
 * interchangeable:
 *
 * - **Direct** (`bridge.graphql()`): the iframe `fetch`es
 *   `{origin}/api/apps/graphql` itself with a short-TTL session token. Full
 *   GraphQL, real keyset pagination, and the `X-RateLimit-*` headers are
 *   readable cross-origin. Gated on the host announcing
 *   `capabilities.directApi` — the real host announces it for every app embed,
 *   and `bridge.graphql()` REJECTS rather than hopefully POSTing when it does
 *   not.
 * - **Proxy** (`bridge.request()`): REST over postMessage, always available,
 *   answered by `BridgeProxyController` against a five-entry allow-list
 *   (`me`, `orders`, `catalog/items`, `parties`, `locations`). It has no
 *   GraphQL path — so this is not a fallback the bridge can do for you, and
 *   the SDK deliberately does not try.
 *
 * That last point is the whole design of this module. The bridge has no
 * automatic fallback; the APP has to decide, per read, whether a proxy call
 * can answer the same question. `lib/data/proxy.ts` answers that honestly:
 * three of the eight domains have a proxy shape that returns real rows (and
 * only under conditions the allow-list imposes), and five have none at all.
 *
 * When neither transport can serve a read, this returns
 * `kind: 'unavailable'` with the reason. The screen prints the reason. It
 * never substitutes fabricated rows — the spec rule that no capability may be
 * shown via mock data has no exception for "the fallback was awkward".
 */

import type { GraphQLResult } from '@/lib/sync/errors';
import type { GraphQLRequest } from '@/lib/sync/transport';
import type { ProxyPlan } from './proxy';

/** Which path a call actually took. */
export type TransportKind = 'direct' | 'proxy' | 'unavailable';

/** Everything the transport badge renders, for one call. */
export interface CallMeta {
  kind: TransportKind;
  /** GraphQL operation or proxy path, for the badge's tooltip. */
  label: string;
  /** HTTP status. 0 means the fetch itself failed; null when never sent. */
  status: number | null;
  /** Attempts the bridge made (1 = no retry). */
  attempts: number;
  /** `X-RateLimit-Remaining`. Proxy forwards it; limit/reset are direct-only. */
  remaining: number | null;
  limit: number | null;
  reset: number | null;
  /** `Retry-After` in seconds, when the host asked for one. */
  retryAfter: number | null;
  durationMs: number;
  /**
   * Why this path was taken, in one sentence. Always populated for `proxy`
   * and `unavailable`; populated for `direct` only when something notable
   * happened (a retry, a rate-limit warning).
   */
  note: string | null;
  /** Wall-clock of the call, for the call log. */
  at: string;
}

export interface CallOutcome<T> {
  /** GraphQL envelope. Empty `{}` when `meta.kind === 'unavailable'`. */
  result: GraphQLResult<T>;
  meta: CallMeta;
}

/**
 * A refusal the platform labelled, as the bridge classifies it. Optional so
 * this module still compiles (and behaves) against an older bridge build that
 * does not populate it.
 */
export interface TransportFailure {
  code: string;
  serverCode: string | null;
  message: string;
}

/** The slice of `AppBridge` this module needs. Keeps the tests honest. */
export interface TransportBridge {
  readonly hostCapabilities: { directApi?: boolean };
  graphql(
    query: string,
    variables?: Record<string, unknown>,
    options?: { operationName?: string; retry?: boolean },
  ): Promise<{
    status: number;
    body: unknown;
    attempts: number;
    transport: 'direct' | 'proxy';
    remaining: number | null;
    limit: number | null;
    reset: number | null;
    retryAfter: number | null;
    failure?: TransportFailure | null;
  }>;
  request(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: Record<string, unknown> | null;
  }): Promise<{
    status: number;
    body: unknown;
    attempts: number;
    transport: 'direct' | 'proxy';
    remaining: number | null;
    limit: number | null;
    reset: number | null;
    retryAfter: number | null;
    failure?: TransportFailure | null;
  }>;
}

export interface CallOptions {
  /** Human label for the badge — the operation name, typically. */
  label: string;
  /**
   * How the same question could be asked over the REST proxy, if at all.
   * Omit for reads with no proxy equivalent; the call then reports
   * `unavailable` instead of pretending.
   */
  proxy?: ProxyPlan | null;
  /**
   * Force the proxy path even when `directApi` is announced. The screen's
   * transport switch uses this so a merchant can SEE the difference rather
   * than read about it.
   */
  prefer?: 'direct' | 'proxy';
  now?: () => number;
  clock?: () => Date;
}

/** Extract the GraphQL envelope out of whatever the transport returned. */
function asEnvelope<T>(body: unknown): GraphQLResult<T> {
  if (body !== null && typeof body === 'object') {
    return body as GraphQLResult<T>;
  }
  return { data: null };
}

/**
 * A non-2xx on the direct path is a TRANSPORT failure and must not be read as
 * an empty result. Turning it into a GraphQL-shaped error keeps one error
 * vocabulary on the screen — `classifyGraphQLErrors` then sorts it alongside
 * SCOPE_DENIED and a bad cursor.
 */
function statusEnvelope<T>(
  status: number,
  label: string,
  failure?: TransportFailure | null,
): GraphQLResult<T> {
  // The bridge NAMES the cause when the platform labelled its own refusal —
  // `invalid_token` and `origin_not_allowed` are both credentials-shaped 401/403
  // on the wire but need completely different fixes, and an HTTP number cannot
  // tell them apart. Prefer that sentence; fall back to the status only when the
  // platform said nothing useful.
  if (failure) {
    return {
      data: null,
      errors: [
        {
          message: `${label}: ${failure.message}`,
          extensions: { code: 'TRANSPORT', status, cause: failure.code, serverCode: failure.serverCode },
        },
      ],
    };
  }

  const message =
    status === 0
      ? `${label}: the request never reached the platform (network failure or a blocked origin).`
      : `${label}: the platform answered HTTP ${status}.`;
  return { data: null, errors: [{ message, extensions: { code: 'TRANSPORT', status } }] };
}

export async function callGraphQL<T = unknown>(
  bridge: TransportBridge,
  request: GraphQLRequest,
  options: CallOptions,
): Promise<CallOutcome<T>> {
  const now = options.now ?? (() => Date.now());
  const clock = options.clock ?? (() => new Date());
  const started = now();
  const at = clock().toISOString();

  const directAnnounced = bridge.hostCapabilities.directApi === true;
  const wantsProxy = options.prefer === 'proxy';

  if (directAnnounced && !wantsProxy) {
    try {
      const response = await bridge.graphql(request.query, request.variables);
      const ok = response.status >= 200 && response.status < 300;
      return {
        result: ok
          ? asEnvelope<T>(response.body)
          : statusEnvelope<T>(response.status, options.label, response.failure),
        meta: {
          kind: 'direct',
          label: options.label,
          status: response.status,
          attempts: response.attempts,
          remaining: response.remaining,
          limit: response.limit,
          reset: response.reset,
          retryAfter: response.retryAfter,
          durationMs: now() - started,
          // A named refusal outranks the retry note: "the origin is not
          // registered" is what the developer has to act on, and it is not
          // recoverable by anything the screen can do.
          note: response.failure
            ? response.failure.message
            : response.attempts > 1
              ? `Retried ${response.attempts - 1}× — the platform answered 429/503 and the document is a pure read, so the bridge backed off and re-sent it.`
              : null,
          at,
        },
      };
    } catch (err) {
      // `graphql()` rejects for reasons that are not HTTP at all (no fetch, no
      // resolved origin, a destroyed bridge). Falling through to the proxy is
      // right, but only when a proxy plan exists — never into invention.
      const reason = err instanceof Error ? err.message : String(err);
      if (!options.proxy) {
        return unavailable<T>(options.label, `bridge.graphql() failed: ${reason}`, started, now, at);
      }
      return runProxy<T>(bridge, options.proxy, options, started, now, at, `bridge.graphql() failed (${reason}); fell back to the REST proxy.`);
    }
  }

  if (!options.proxy) {
    return unavailable<T>(
      options.label,
      wantsProxy
        ? 'The REST proxy has no allow-listed path that answers this read, so the proxy switch cannot serve it. The proxy allow-list is me · orders · catalog/items · parties · locations.'
        : 'The host did not announce capabilities.directApi, so bridge.graphql() is unavailable, and the REST proxy has no allow-listed path that answers this read.',
      started,
      now,
      at,
    );
  }

  return runProxy<T>(
    bridge,
    options.proxy,
    options,
    started,
    now,
    at,
    wantsProxy
      ? 'Proxy selected explicitly, so this read went over postMessage instead of the direct endpoint.'
      : 'The host did not announce capabilities.directApi, so this read went over the REST proxy.',
  );
}

async function runProxy<T>(
  bridge: TransportBridge,
  plan: ProxyPlan,
  options: CallOptions,
  started: number,
  now: () => number,
  at: string,
  why: string,
): Promise<CallOutcome<T>> {
  const response = await bridge.request({ method: plan.method, path: plan.path, body: plan.body });
  const ok = response.status >= 200 && response.status < 300;

  return {
    result: ok
      ? ({ data: plan.adapt(response.body) } as GraphQLResult<T>)
      : statusEnvelope<T>(response.status, `${options.label} via ${plan.method} ${plan.path}`, response.failure),
    meta: {
      kind: 'proxy',
      label: `${options.label} → ${plan.method} ${plan.path}`,
      status: response.status,
      attempts: response.attempts,
      remaining: response.remaining,
      // The host does not forward limit/reset across the postMessage proxy;
      // reporting null is the truth, and `—` on the badge says so.
      limit: null,
      reset: null,
      retryAfter: response.retryAfter,
      durationMs: now() - started,
      note: `${why} ${plan.caveat}`,
      at,
    },
  };
}

function unavailable<T>(
  label: string,
  note: string,
  started: number,
  now: () => number,
  at: string,
): CallOutcome<T> {
  return {
    result: { data: null },
    meta: {
      kind: 'unavailable',
      label,
      status: null,
      attempts: 0,
      remaining: null,
      limit: null,
      reset: null,
      retryAfter: null,
      durationMs: now() - started,
      note,
      at,
    },
  };
}

/** One-line summary for the badge. Pure, so the suite asserts the wording. */
export function describeTransport(meta: CallMeta): string {
  switch (meta.kind) {
    case 'direct':
      return `direct · bridge.graphql() · HTTP ${meta.status} · ${meta.durationMs}ms`;
    case 'proxy':
      return `proxy · bridge.request() · HTTP ${meta.status} · ${meta.durationMs}ms`;
    default:
      return 'unavailable · no transport can answer this read';
  }
}

/** Rate-limit headers as the badge shows them. `—` where the host sent none. */
export function describeRateLimit(meta: CallMeta): string {
  const value = (n: number | null) => (n === null ? '—' : String(n));
  return `remaining ${value(meta.remaining)} / limit ${value(meta.limit)} · reset ${value(
    meta.reset,
  )} · retry-after ${value(meta.retryAfter)}`;
}
