/**
 * The incremental sync engine — dev-docs §8b, implemented.
 *
 * Three phases, and the whole design is about what happens when one of them
 * fails:
 *
 * 1. **Install walk.** Keyset-paginate every domain to completion. The cursor
 *    is written to `SyncState` after EVERY page, so a walk killed halfway (a
 *    deploy, a crashed lambda, a 15-minute function timeout) resumes at the
 *    page it reached instead of starting over. On a merchant with 40k orders
 *    that difference is the whole feature.
 * 2. **Webhook fast path.** `applyWebhookEvent()` applies one named change
 *    without walking anything. Low latency, but at-least-once and lossy under
 *    an outage — which is why it is never the only path.
 * 3. **Scheduled reconcile.** The `reconcile` schedule (`every = "15m"`)
 *    re-walks each domain with `updatedAtMin` set to the last successful run's
 *    watermark. Webhooks give speed; this gives correctness. A webhook the app
 *    never received is invisible for at most one tick.
 *
 * ## Why the counts are idempotent
 *
 * The reconcile window deliberately OVERLAPS: the watermark is the previous
 * run's start time minus a safety margin, so rows written during a run are
 * seen again rather than skipped. That means a second tick genuinely re-reads
 * rows — and must still change nothing. It does, because the engine adds
 * `sink.applied`, never `nodes.length`, and reads `recordCount` back from
 * `sink.count()` rather than accumulating. Re-reading is free by construction,
 * not by luck.
 *
 * ## Why a denied domain cannot take the run down
 *
 * SCOPE_DENIED arrives as HTTP 200 with a GraphQL error extension. It is
 * caught per domain, recorded on that domain's row, and the loop moves on —
 * seven domains still sync when the merchant withheld one scope. A transport
 * error (401/5xx) is recorded the same way per domain; it just tends to hit
 * all eight, because the token is the token.
 *
 * ## Cursor recovery
 *
 * Two independent guards, because hosts differ:
 *
 * - If the host REJECTS the cursor (`InvalidCursorError`), the domain drops
 *   the cursor and restarts its walk from page one, once per run.
 * - If the host silently REWINDS — which is what this platform does, see
 *   `KeysetCursor::decode` — the walk simply proceeds correctly. The failure
 *   mode left is a cursor that never advances (`endCursor === after`), which
 *   would loop forever; that is detected and treated exactly like a rejection.
 *
 * Either way a domain cannot be wedged by a bad cursor.
 */

import {
  DOMAIN_DESCRIPTORS,
  EVENT_DOMAIN_MAP,
  SYNC_DOMAINS,
  type DomainConnection,
  type DomainDescriptor,
  type SyncDomain,
} from './domains';
import {
  InvalidCursorError,
  ScopeDeniedError,
  classifyGraphQLErrors,
  toSyncError,
  type SyncError,
} from './errors';
import type { SyncNode, SyncSink } from './sink';
import type { SyncOutcome, SyncSource, SyncStateRecord, SyncStateStore } from './store';
import type { GraphQLTransport } from './transport';

/** The schedule whose tick drives the reconcile. Mirrors `[[schedules]]`. */
export const RECONCILE_SCHEDULE = 'reconcile';

export interface SyncEngineOptions {
  transport: GraphQLTransport;
  sink: SyncSink;
  store: SyncStateStore;
  /** Rows per page. The platform clamps to 100 regardless. */
  pageSize?: number;
  /**
   * Seconds subtracted from a run's start time to form the next
   * `updatedAtMin`. Absorbs clock skew between this app and the host, and
   * covers a row written during the run itself.
   */
  overlapSeconds?: number;
  /**
   * Hard ceiling on pages per domain per run, so a pathological cursor cannot
   * spin a scheduled tick forever. A hit ends the run as `partial` with the
   * cursor retained — the next tick picks it straight back up.
   */
  maxPagesPerRun?: number;
  now?: () => Date;
}

export interface DomainRunResult {
  domain: SyncDomain;
  source: SyncSource;
  outcome: SyncOutcome;
  /** `null` on an install walk or an unsupported domain; ISO otherwise. */
  updatedAtMin: string | null;
  resumedFromCursor: boolean;
  cursorRecovered: boolean;
  pages: number;
  recordsSeen: number;
  recordsApplied: number;
  recordsSkipped: number;
  /** Distinct records the sink holds afterwards. */
  totalRecords: number;
  walkComplete: boolean;
  error: { kind: SyncError['kind']; message: string; scope?: string | null } | null;
  startedAt: string;
  finishedAt: string;
}

export interface SyncRunResult {
  source: SyncSource;
  startedAt: string;
  finishedAt: string;
  domains: DomainRunResult[];
  /** True when every attempted domain finished `ok`. */
  ok: boolean;
}

/** What the webhook receiver (task 2.1) gets back. Never throws. */
export type WebhookApplyStatus =
  | 'applied' // record hydrated and written
  | 'removed' // record dropped (delete/archive event)
  | 'stale' // sequence at or below what was already applied
  | 'unchanged' // hydrated, byte-identical to what was held
  | 'missing' // id no longer resolvable — nothing to write
  | 'ignored' // event carries no record change for this engine
  | 'error'; // read failed; the reconcile will pick it up

export interface WebhookApplyResult {
  status: WebhookApplyStatus;
  domain: SyncDomain | null;
  /** Human-readable reason, always populated for `ignored` and `error`. */
  reason: string | null;
  error: { kind: SyncError['kind']; message: string; scope?: string | null } | null;
}

export interface WebhookApplyInput {
  /** `X-App-Event` / the verified body's event name, e.g. `customer.updated`. */
  event: string;
  /** Thin payload `id`. Numbers are accepted and stringified. */
  resourceId: string | number | null | undefined;
  /** Thin payload `sequence`. Per-resource monotonic; omit when absent. */
  sequence?: number | null;
  /** Thin payload `occurred_at`. ISO string or Date. */
  occurredAt?: string | Date | null;
}

interface DomainRunOptions {
  source: SyncSource;
  /** `walk` ignores any watermark; `incremental` uses it where supported. */
  mode: 'walk' | 'incremental';
  /** Continue from a stored cursor rather than starting at page one. */
  resume: boolean;
}

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function describeError(err: SyncError) {
  return {
    kind: err.kind,
    message: err.message,
    scope: err instanceof ScopeDeniedError ? err.scope : null,
  };
}

export class SyncEngine {
  private readonly transport: GraphQLTransport;
  private readonly sink: SyncSink;
  private readonly store: SyncStateStore;
  private readonly pageSize: number;
  private readonly overlapSeconds: number;
  private readonly maxPagesPerRun: number;
  private readonly now: () => Date;

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport;
    this.sink = options.sink;
    this.store = options.store;
    this.pageSize = Math.min(options.pageSize ?? 100, 100);
    this.overlapSeconds = options.overlapSeconds ?? 60;
    this.maxPagesPerRun = options.maxPagesPerRun ?? 500;
    this.now = options.now ?? (() => new Date());
  }

  /** Current persisted state for every domain, in declaration order. */
  async state(): Promise<SyncStateRecord[]> {
    const rows = await Promise.all(SYNC_DOMAINS.map((d) => this.store.get(d)));
    return rows;
  }

  /**
   * Phase 1 — walk every domain (or a subset) to completion.
   *
   * Resumes by default: a domain holding a cursor continues from it. Pass
   * `restart: true` to force page one, which is also what the malformed-cursor
   * recovery does internally for a single domain.
   */
  async installWalk(
    options: { domains?: SyncDomain[]; restart?: boolean; source?: SyncSource } = {},
  ): Promise<SyncRunResult> {
    return this.runDomains(options.domains ?? [...SYNC_DOMAINS], {
      source: options.source ?? 'install-walk',
      mode: 'walk',
      resume: !options.restart,
    });
  }

  /**
   * Phase 3 — the reconcile. Re-walks with `updatedAtMin` from the last
   * successful run, which is the safety net for a webhook that never arrived.
   *
   * A domain that has never completed a walk is backfilled instead: an
   * incremental read against an empty mirror would silently pretend the
   * merchant's history does not exist.
   */
  async reconcile(
    options: { domains?: SyncDomain[]; source?: SyncSource } = {},
  ): Promise<SyncRunResult> {
    return this.runDomains(options.domains ?? [...SYNC_DOMAINS], {
      source: options.source ?? 'schedule:reconcile',
      mode: 'incremental',
      resume: true,
    });
  }

  /**
   * The `schedule.tick` entry point.
   *
   * `[[schedules]]` delivers ticks by NAME; an app with several schedules gets
   * them all on the same webhook. Anything that is not the reconcile schedule
   * is not this engine's business and is reported as such rather than being
   * silently swallowed.
   */
  async handleScheduleTick(schedule: string): Promise<SyncRunResult | { ignored: true; schedule: string }> {
    if (schedule !== RECONCILE_SCHEDULE) {
      return { ignored: true, schedule };
    }
    return this.reconcile();
  }

  /**
   * Phase 2 — the webhook fast path. **This is the seam task 2.1 calls.**
   *
   * Contract:
   * - Call it only for a delivery whose HMAC VERIFIED. The engine trusts the
   *   `event`/`id`/`sequence` it is handed and reads the platform with them.
   * - It never throws. Every failure comes back as `status: 'error'` with a
   *   classified reason, so a read failure cannot turn into a 500 that burns
   *   a webhook retry — the reconcile will catch whatever this missed.
   * - It is safe to call for ANY of the 22 event names. Lifecycle events and
   *   `schedule.tick` come back `ignored`; use `purge()` and
   *   `handleScheduleTick()` for those.
   * - Re-delivery is free: the sink dedupes, so an at-least-once double
   *   delivery reports `unchanged` rather than writing twice.
   */
  async applyWebhookEvent(input: WebhookApplyInput): Promise<WebhookApplyResult> {
    const mapping = EVENT_DOMAIN_MAP[input.event];
    if (!mapping) {
      return {
        status: 'ignored',
        domain: null,
        reason: `\`${input.event}\` names no synced record`,
        error: null,
      };
    }

    const id = input.resourceId === null || input.resourceId === undefined ? '' : String(input.resourceId);
    if (id === '') {
      return {
        status: 'ignored',
        domain: mapping.domain,
        reason: 'payload carried no resource id',
        error: null,
      };
    }

    const domain = mapping.domain;
    const descriptor = DOMAIN_DESCRIPTORS[domain];
    const startedAt = this.now();

    try {
      if (mapping.removes) {
        const removed = await this.sink.remove(domain, id);
        await this.recordWebhookRun(domain, startedAt, removed ? 1 : 0);
        return {
          status: removed ? 'removed' : 'ignored',
          domain,
          reason: removed ? null : 'record was not held',
          error: null,
        };
      }

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
      const nodes = await this.hydrate(descriptor, id, occurredAt);

      if (nodes.length === 0) {
        await this.recordWebhookRun(domain, startedAt, 0);
        return {
          status: 'missing',
          domain,
          reason: 'the platform no longer resolves this id',
          error: null,
        };
      }

      const sequence = typeof input.sequence === 'number' ? input.sequence : null;
      const result = await this.sink.apply(domain, nodes, sequence);
      await this.recordWebhookRun(domain, startedAt, result.applied);

      if (result.applied > 0) {
        return { status: 'applied', domain, reason: null, error: null };
      }
      // Nothing written. Distinguishing stale from unchanged matters to the
      // Event Inspector: one is an out-of-order delivery the app correctly
      // dropped, the other is a duplicate it correctly absorbed.
      return {
        status: sequence !== null ? 'stale' : 'unchanged',
        domain,
        reason:
          sequence !== null
            ? `sequence ${sequence} is not newer than the applied one`
            : 'record identical to the held copy',
        error: null,
      };
    } catch (err) {
      const error = toSyncError(err);
      await this.store.update(domain, {
        lastRunAt: startedAt,
        lastRunSource: 'webhook',
        lastOutcome: 'error',
        lastError: this.errorLine(error),
      });
      return { status: 'error', domain, reason: error.message, error: describeError(error) };
    }
  }

  /**
   * The mandatory-lifecycle path: `app.uninstalled` and `profile.data.erased`
   * both mean "you no longer hold this merchant's data". Wipes the mirror and
   * every cursor, so a reinstall backfills from scratch rather than resuming a
   * walk against data it is no longer entitled to.
   */
  async purge(): Promise<void> {
    await this.sink.clear();
    await this.store.clear();
  }

  // ------------------------------------------------------------------ private

  private async hydrate(
    descriptor: DomainDescriptor,
    id: string,
    occurredAt: Date | null,
  ): Promise<SyncNode[]> {
    const nodes = await descriptor.hydrate(this.transport, id, occurredAt);
    // A by-ids query returns whatever the platform resolved; keep only the row
    // we asked about, so a permissive host cannot widen a single-record apply.
    return nodes.filter((node) => String(node.id) === id);
  }

  private async recordWebhookRun(
    domain: SyncDomain,
    startedAt: Date,
    applied: number,
  ): Promise<void> {
    await this.store.update(domain, {
      lastRunAt: startedAt,
      lastRunSource: 'webhook',
      lastRunRecordCount: applied,
      lastRunPageCount: 0,
      lastOutcome: 'ok',
      lastError: null,
      recordCount: await this.sink.count(domain),
    });
  }

  private errorLine(error: SyncError): string {
    if (error instanceof ScopeDeniedError) {
      return `SCOPE_DENIED${error.scope ? ` (${error.scope})` : ''}: ${error.message}`;
    }
    return `${error.kind}: ${error.message}`;
  }

  private async runDomains(
    domains: SyncDomain[],
    options: DomainRunOptions,
  ): Promise<SyncRunResult> {
    const startedAt = this.now();
    const results: DomainRunResult[] = [];

    for (const domain of domains) {
      // Sequential on purpose. Eight parallel walks against one merchant is
      // how an app earns a 429 ladder; the platform's rate limiter is per app,
      // not per domain.
      results.push(await this.runDomain(domain, options));
    }

    return {
      source: options.source,
      startedAt: startedAt.toISOString(),
      finishedAt: this.now().toISOString(),
      domains: results,
      ok: results.every((r) => r.outcome === 'ok'),
    };
  }

  private async runDomain(domain: SyncDomain, options: DomainRunOptions): Promise<DomainRunResult> {
    const descriptor = DOMAIN_DESCRIPTORS[domain];
    const state = await this.store.get(domain);
    const startedAt = this.now();

    // A domain that never finished a walk is backfilled even when the caller
    // asked for an incremental run.
    const backfilling = !state.walkComplete;
    const incremental =
      options.mode === 'incremental' && !backfilling && descriptor.supportsUpdatedAtMin;
    const updatedAtMin = incremental ? state.lastUpdatedAtMin : null;

    let after = options.resume ? state.endCursor : null;
    const resumedFromCursor = after !== null;
    let cursorRecovered = false;

    let pages = 0;
    let seen = 0;
    let applied = 0;
    let skipped = 0;

    await this.store.update(domain, { lastRunAt: startedAt, lastRunSource: options.source });

    try {
      for (;;) {
        if (pages >= this.maxPagesPerRun) {
          // Stop cleanly with the cursor kept. `partial` is the honest word:
          // work happened, the domain is not done.
          const total = await this.sink.count(domain);
          await this.store.update(domain, {
            endCursor: after,
            lastRunPageCount: pages,
            lastRunRecordCount: seen,
            recordCount: total,
            lastOutcome: 'partial',
            lastError: `stopped after ${pages} pages; cursor retained for the next run`,
          });
          return {
            domain,
            source: options.source,
            outcome: 'partial',
            updatedAtMin: isoOrNull(updatedAtMin),
            resumedFromCursor,
            cursorRecovered,
            pages,
            recordsSeen: seen,
            recordsApplied: applied,
            recordsSkipped: skipped,
            totalRecords: total,
            walkComplete: state.walkComplete,
            error: null,
            startedAt: startedAt.toISOString(),
            finishedAt: this.now().toISOString(),
          };
        }

        let page;
        try {
          page = await this.fetchPage(descriptor, after, updatedAtMin);
        } catch (err) {
          const error = toSyncError(err);
          if (error instanceof InvalidCursorError && after !== null && !cursorRecovered) {
            // Recovery, not surrender: drop the cursor, restart this domain's
            // walk at page one, and say so on the row.
            cursorRecovered = true;
            after = null;
            pages = 0;
            seen = 0;
            applied = 0;
            skipped = 0;
            await this.store.update(domain, { endCursor: null });
            continue;
          }
          throw error;
        }

        pages += 1;
        seen += page.nodes.length;
        const result = await this.sink.apply(domain, page.nodes);
        applied += result.applied;
        skipped += result.skipped;

        const next = page.endCursor;

        if (!page.hasNextPage || next === null) {
          break;
        }

        if (after !== null && next === after) {
          // The cursor is not moving. Whatever the cause — a rewinding host, a
          // cursor the port could not read — continuing is an infinite loop.
          // Same recovery as an outright rejection.
          if (cursorRecovered) {
            throw new InvalidCursorError(
              `cursor did not advance past ${after} after a restart`,
              after,
            );
          }
          cursorRecovered = true;
          after = null;
          pages = 0;
          seen = 0;
          applied = 0;
          skipped = 0;
          await this.store.update(domain, { endCursor: null });
          continue;
        }

        after = next;
        // Persist EVERY page. This line is the whole resumability story.
        await this.store.update(domain, {
          endCursor: after,
          lastRunPageCount: pages,
          lastRunRecordCount: seen,
        });
      }

      const finishedAt = this.now();
      const total = await this.sink.count(domain);

      // The watermark for the NEXT run is this run's START minus the overlap
      // margin — never `finishedAt`, which would open a hole the width of the
      // run for anything written while it was in flight.
      const watermark = descriptor.supportsUpdatedAtMin
        ? new Date(startedAt.getTime() - this.overlapSeconds * 1000)
        : null;

      await this.store.update(domain, {
        endCursor: null,
        walkComplete: true,
        lastUpdatedAtMin: watermark,
        lastSyncedAt: finishedAt,
        lastRunRecordCount: seen,
        lastRunPageCount: pages,
        recordCount: total,
        lastOutcome: 'ok',
        lastError: null,
        lastRunSource: options.source,
      });

      return {
        domain,
        source: options.source,
        outcome: 'ok',
        updatedAtMin: isoOrNull(updatedAtMin),
        resumedFromCursor,
        cursorRecovered,
        pages,
        recordsSeen: seen,
        recordsApplied: applied,
        recordsSkipped: skipped,
        totalRecords: total,
        walkComplete: true,
        error: null,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      };
    } catch (err) {
      const error = toSyncError(err);
      const total = await this.sink.count(domain);

      // The cursor is KEPT on failure. A 429 or a dropped connection mid-walk
      // must not cost the pages already paid for — EXCEPT when the cursor is
      // itself what failed, in which case persisting it would re-enter the
      // same trap on the next tick. That is the difference between a domain
      // that is behind and a domain that is wedged.
      await this.store.update(domain, {
        endCursor: error instanceof InvalidCursorError ? null : after,
        lastRunPageCount: pages,
        lastRunRecordCount: seen,
        recordCount: total,
        lastOutcome: 'error',
        lastError: this.errorLine(error),
        lastRunSource: options.source,
      });

      return {
        domain,
        source: options.source,
        outcome: 'error',
        updatedAtMin: isoOrNull(updatedAtMin),
        resumedFromCursor,
        cursorRecovered,
        pages,
        recordsSeen: seen,
        recordsApplied: applied,
        recordsSkipped: skipped,
        totalRecords: total,
        walkComplete: state.walkComplete,
        error: describeError(error),
        startedAt: startedAt.toISOString(),
        finishedAt: this.now().toISOString(),
      };
    }
  }

  private async fetchPage(
    descriptor: DomainDescriptor,
    after: string | null,
    updatedAtMin: Date | null,
  ) {
    const variables: Record<string, unknown> = { first: this.pageSize, after };
    if (descriptor.supportsUpdatedAtMin) {
      // Sent as null rather than omitted: the variable is declared by the
      // document, and a declared-but-absent variable is a GraphQL error.
      variables.updatedAtMin = updatedAtMin ? updatedAtMin.toISOString() : null;
    }

    const response = await this.transport<Record<string, DomainConnection | null>>({
      query: descriptor.pageQuery,
      variables,
    });

    const error = classifyGraphQLErrors(response.errors, after);
    if (error) {
      throw error;
    }

    const connection = response.data?.[descriptor.field];
    if (!connection) {
      throw new InvalidCursorError(
        `\`${descriptor.field}\` returned no connection and no error`,
        after,
      );
    }

    return {
      nodes: connection.nodes ?? [],
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
      endCursor: connection.pageInfo?.endCursor ?? null,
    };
  }
}
