/**
 * The GraphQL transport the sync engine reads through.
 *
 * It is an interface first and an HTTP client second, and that ordering is the
 * point: the certification suite drives the engine against a stubbed transport
 * that can produce a multi-page walk, a rejected cursor, a SCOPE_DENIED
 * extension and a 401 on demand — none of which are reliably reproducible
 * against a live box.
 *
 * Server-side sync uses the install's long-lived bearer `api_token` against
 * `POST /api/apps/graphql` (the route `AppsServiceProvider` mounts behind the
 * `remote-app` middleware). The browser's short-lived session token is a
 * different path entirely and belongs to the API Console screen, not here.
 */

import { loadConfig, type FlashmanduConfig } from "../config";
import { TransportError, type GraphQLResult } from "./errors";

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
}

export interface GraphQLTransport {
  <T = unknown>(request: GraphQLRequest): Promise<GraphQLResult<T>>;
}

export interface HttpTransportOptions {
  config?: FlashmanduConfig;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Attempts for a throttled/unavailable read. Reads only — see below. */
  maxAttempts?: number;
  /** Base backoff in ms, doubled per attempt and jittered. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE = new Set([429, 503]);

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Parse `Retry-After` in its seconds form. The HTTP-date form is accepted too,
 * because a proxy in front of the box may rewrite it.
 */
function retryAfterMs(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Bearer-token GraphQL transport.
 *
 * Every call this engine makes is a READ, which is what makes the retry safe:
 * the docs are explicit that idempotent reads may be retried on 429/503 with
 * jittered backoff honouring `Retry-After`, and that writes never are. There
 * is no mutation on this path, so there is no write to accidentally duplicate.
 */
export function createHttpTransport(
  options: HttpTransportOptions = {},
): GraphQLTransport {
  const config = options.config ?? loadConfig();
  const doFetch = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  if (!config.devBoxBaseUrl) {
    throw new Error(
      "FLASHMANDU_DEV_BOX_BASE_URL is not set; the sync engine has nowhere to read from.",
    );
  }
  const endpoint = `${config.devBoxBaseUrl}/api/apps/graphql`;

  return async function transport<T>(
    request: GraphQLRequest,
  ): Promise<GraphQLResult<T>> {
    let lastError: TransportError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify(request),
          cache: "no-store",
        });
      } catch (err) {
        // A network throw is retryable in exactly the same way a 503 is.
        lastError = new TransportError(
          `GraphQL transport failed: ${err instanceof Error ? err.message : String(err)}`,
          null,
        );
        if (attempt === maxAttempts) {
          throw lastError;
        }
        await sleep(backoffMs * 2 ** (attempt - 1) * (0.5 + random()));
        continue;
      }

      if (RETRYABLE.has(response.status) && attempt < maxAttempts) {
        const wait = retryAfterMs(response.headers.get("retry-after"));
        await sleep(wait ?? backoffMs * 2 ** (attempt - 1) * (0.5 + random()));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        // 401/403 here is a TRANSPORT failure — a bad or revoked token — and
        // is a different thing entirely from a 200 carrying SCOPE_DENIED.
        throw new TransportError(
          `GraphQL transport ${response.status} ${response.statusText}`,
          response.status,
          body.slice(0, 500),
        );
      }

      return (await response.json()) as GraphQLResult<T>;
    }

    throw (
      lastError ??
      new TransportError("GraphQL transport exhausted its attempts", null)
    );
  };
}
