/**
 * Keyset walking, as the Data Browser drives it.
 *
 * `lib/sync/engine.ts` already walks these domains server-side for the sync
 * store. This is not a second copy of that: it reuses the same
 * `DOMAIN_DESCRIPTORS` page queries and the same `classifyGraphQLErrors`
 * vocabulary, and adds the one thing a screen needs and a background engine
 * does not — a walk you can drive one page at a time, watch, stop, and
 * deliberately break.
 *
 * Three behaviours are demonstrable from the UI, because all three are things
 * a real app gets wrong:
 *
 * 1. **The full walk.** Follow `pageInfo.endCursor` until `hasNextPage` is
 *    false. Every page is logged with its cursor so the trail is visible.
 * 2. **The incremental walk.** Same loop with `updatedAtMin` set to the last
 *    watermark. Six domains support it; `accounts` and `outlets` do not, and
 *    `runWalk` refuses to send the argument to them rather than letting the
 *    schema reject the query.
 * 3. **Malformed-cursor recovery.** Feed a garbage cursor and see what
 *    happens. On THIS host the answer is a silent rewind — `KeysetCursor::
 *    decode` returns null and the port serves page one — so a walk that only
 *    watched for an error would loop forever re-reading page one and calling
 *    it progress. `fetchPage` therefore detects BOTH shapes: a rejecting host
 *    (an `INVALID_CURSOR` error → drop the cursor and restart) and a rewinding
 *    one (page one arrived when a cursor was sent → say so and restart).
 *
 * The walk is bounded by `maxPages`. An unbounded loop in a browser tab
 * driven by a cursor the host may not advance is how a screen wedges.
 */

import { classifyGraphQLErrors, InvalidCursorError, type SyncError } from '@/lib/sync/errors';
import type { DomainDescriptor } from '@/lib/sync/domains';
import type { SyncNode } from '@/lib/sync/sink';
import { callGraphQL, type CallMeta, type TransportBridge } from './transport';
import type { ProxyPlan } from './proxy';

/** The wire shape of every `XConnection`. Mirrors `lib/sync/domains.ts`. */
interface Connection {
  nodes: SyncNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface PageRequest {
  first: number;
  after: string | null;
  /** Ignored (and reported) when the descriptor does not support it. */
  updatedAtMin?: string | null;
  proxy?: ProxyPlan | null;
  prefer?: 'direct' | 'proxy';
}

/** What one page read produced, including how it got there and what broke. */
export interface PageResult {
  nodes: SyncNode[];
  hasNextPage: boolean;
  endCursor: string | null;
  meta: CallMeta;
  /** Classified failure. Null on success. `nodes` is empty when set. */
  error: SyncError | null;
  /**
   * Set when the host answered a cursor by serving page one instead of
   * failing. The caller must NOT treat this as progress.
   */
  rewound: boolean;
  /** The arguments actually sent, for the on-screen call log. */
  sent: { first: number; after: string | null; updatedAtMin: string | null };
  /**
   * True for the extra page-one read a RESUMED walk makes before following its
   * cursor. See `runWalk` — it is how a silent rewind is detectable at all on
   * the very first request.
   */
  probe?: boolean;
}

/**
 * Read one page.
 *
 * `updatedAtMin` is dropped — loudly, via `sent` — for the two domains whose
 * schema has no such argument. Sending it anyway would fail the whole query
 * with a validation error that reads like a platform outage.
 */
export async function fetchPage(
  bridge: TransportBridge,
  descriptor: DomainDescriptor,
  request: PageRequest,
): Promise<PageResult> {
  const updatedAtMin = descriptor.supportsUpdatedAtMin ? (request.updatedAtMin ?? null) : null;

  const variables: Record<string, unknown> = {
    first: Math.max(1, Math.min(request.first, 100)),
    after: request.after,
  };
  if (descriptor.supportsUpdatedAtMin) {
    variables.updatedAtMin = updatedAtMin;
  }

  const { result, meta } = await callGraphQL<Record<string, Connection | null>>(
    bridge,
    { query: descriptor.pageQuery, variables },
    { label: `${descriptor.field}(first, after${descriptor.supportsUpdatedAtMin ? ', updatedAtMin' : ''})`, proxy: request.proxy ?? null, prefer: request.prefer },
  );

  const sent = { first: variables.first as number, after: request.after, updatedAtMin };

  if (meta.kind === 'unavailable') {
    return {
      nodes: [],
      hasNextPage: false,
      endCursor: null,
      meta,
      error: null,
      rewound: false,
      sent,
    };
  }

  const error = classifyGraphQLErrors(result.errors, request.after);
  if (error) {
    return { nodes: [], hasNextPage: false, endCursor: null, meta, error, rewound: false, sent };
  }

  const connection = result.data?.[descriptor.field] ?? null;
  if (!connection) {
    return { nodes: [], hasNextPage: false, endCursor: null, meta, error: null, rewound: false, sent };
  }

  return {
    nodes: connection.nodes ?? [],
    hasNextPage: connection.pageInfo?.hasNextPage ?? false,
    endCursor: connection.pageInfo?.endCursor ?? null,
    meta,
    error: null,
    rewound: false,
    sent,
  };
}

/**
 * Read one page, recovering from a cursor the host cannot use.
 *
 * `firstPageCursor` is how the rewind is detected: the caller remembers what
 * page one's `endCursor` was, and if a LATER request comes back with that same
 * cursor, the host served page one again. Comparing cursors rather than rows
 * is deliberate — the rows may legitimately repeat when nothing changed, but a
 * cursor that goes backwards cannot.
 */
export async function fetchPageWithRecovery(
  bridge: TransportBridge,
  descriptor: DomainDescriptor,
  request: PageRequest,
  firstPageCursor: string | null,
): Promise<PageResult> {
  const page = await fetchPage(bridge, descriptor, request);

  const hostRejectedCursor = page.error instanceof InvalidCursorError;
  const hostRewound =
    request.after !== null &&
    firstPageCursor !== null &&
    page.endCursor === firstPageCursor &&
    page.error === null;

  if (!hostRejectedCursor && !hostRewound) {
    return page;
  }

  // Both shapes have the same cure: forget the cursor and re-walk from the
  // start. The DIFFERENCE is only in what the screen tells you happened.
  const restarted = await fetchPage(bridge, descriptor, { ...request, after: null });
  return { ...restarted, rewound: true, error: hostRejectedCursor ? null : restarted.error };
}

export interface WalkOptions {
  pageSize?: number;
  updatedAtMin?: string | null;
  /** Hard stop. A browser tab must never loop on a host that will not advance. */
  maxPages?: number;
  /** Start from a specific cursor — including a deliberately malformed one. */
  startAfter?: string | null;
  proxy?: ProxyPlan | null;
  prefer?: 'direct' | 'proxy';
  /** Called after every page, so the screen can render progressively. */
  onPage?: (page: PageResult, index: number) => void;
}

export interface WalkResult {
  nodes: SyncNode[];
  pages: PageResult[];
  /** The last usable cursor — the resume point for the next incremental run. */
  endCursor: string | null;
  error: SyncError | null;
  /** True when `maxPages` stopped the walk before the host said it was done. */
  truncated: boolean;
  /** True when a cursor had to be dropped and the walk restarted. */
  recovered: boolean;
  /** Total wall-clock across every page. */
  durationMs: number;
}

export async function runWalk(
  bridge: TransportBridge,
  descriptor: DomainDescriptor,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 20;

  const pages: PageResult[] = [];
  const nodes: SyncNode[] = [];
  const seen = new Set<string>();

  let after = options.startAfter ?? null;
  let firstPageCursor: string | null = null;
  let recovered = false;
  let error: SyncError | null = null;
  let durationMs = 0;
  let truncated = false;

  /**
   * A RESUMED walk probes page one before following its cursor.
   *
   * Without it a silent rewind is undetectable on the very first request: the
   * app has never seen page one, so it has nothing to recognise page one BY,
   * and it would happily walk from the start believing it resumed. One extra
   * read — only when resuming, and with the same page size so the cursors are
   * comparable — is what turns "the host quietly ignored my cursor" from
   * invisible into a labelled row in the trail.
   */
  if (after !== null) {
    const probe = await fetchPage(bridge, descriptor, {
      first: pageSize,
      after: null,
      updatedAtMin: options.updatedAtMin ?? null,
      proxy: options.proxy ?? null,
      prefer: options.prefer,
    });
    probe.probe = true;
    pages.push(probe);
    durationMs += probe.meta.durationMs;
    options.onPage?.(probe, -1);
    firstPageCursor = probe.endCursor;
  }

  for (let index = 0; index < maxPages; index += 1) {
    const page = await fetchPageWithRecovery(
      bridge,
      descriptor,
      {
        first: pageSize,
        after,
        updatedAtMin: options.updatedAtMin ?? null,
        proxy: options.proxy ?? null,
        prefer: options.prefer,
      },
      firstPageCursor,
    );

    pages.push(page);
    durationMs += page.meta.durationMs;
    options.onPage?.(page, index);

    if (page.rewound) {
      recovered = true;
      // The restart already returned page one, so the cursor trail starts over.
      firstPageCursor = page.endCursor;
    } else if (index === 0 && after === null) {
      firstPageCursor = page.endCursor;
    }

    if (page.error) {
      error = page.error;
      break;
    }
    if (page.meta.kind === 'unavailable') {
      break;
    }

    // De-duplicate: a rewind (or a host that re-serves a boundary row) must
    // not double-count a record into the table.
    for (const node of page.nodes) {
      const id = String(node.id);
      if (!seen.has(id)) {
        seen.add(id);
        nodes.push(node);
      }
    }

    if (!page.hasNextPage || page.endCursor === null) {
      after = page.endCursor;
      return { nodes, pages, endCursor: page.endCursor, error, truncated: false, recovered, durationMs };
    }

    if (page.endCursor === after) {
      // The host says "more" but hands back the cursor we just sent. Stopping
      // is the only correct move; continuing is an infinite loop.
      error = new InvalidCursorError(
        'The host reported hasNextPage but returned the same endCursor that was sent, so the walk cannot advance.',
        after,
      );
      break;
    }

    after = page.endCursor;

    if (index === maxPages - 1) {
      truncated = true;
    }
  }

  return { nodes, pages, endCursor: after, error, truncated, recovered, durationMs };
}

/** A cursor that is certainly not decodable, for the recovery demo. */
export const MALFORMED_CURSOR = 'not-a-cursor::' + 'x'.repeat(12);
