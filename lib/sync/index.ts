import 'server-only';

/**
 * Server-side wiring for the sync engine.
 *
 * Everything below this line is pure composition — the pieces are all
 * injectable, and the certification suite injects its own. The singleton
 * matters for one reason: the reference `SyncSink` is in-process (see
 * `sink.ts`), so a second engine would mean a second, empty mirror.
 *
 * ## For the webhook receiver (task 2.1)
 *
 * ```ts
 * import { getSyncEngine } from '@/lib/sync';
 *
 * // after the HMAC verified and the delivery was recorded:
 * const outcome = await getSyncEngine().applyWebhookEvent({
 *   event,                       // 'customer.updated'
 *   resourceId: payload.id,      // string | number
 *   sequence: payload.sequence,  // number | null
 *   occurredAt: payload.occurred_at,
 * });
 *
 * // schedule.tick:
 * await getSyncEngine().handleScheduleTick(payload.schedule);
 *
 * // app.uninstalled / profile.data.erased:
 * await getSyncEngine().purge();
 * ```
 *
 * `applyWebhookEvent` never throws and never needs a try/catch: it classifies
 * its own failures into `status: 'error'`, because a read failure inside the
 * app must not turn a delivered webhook into a 500 the host will retry.
 */

import { SyncEngine } from './engine';
import { createMemorySink, type SyncSink } from './sink';
import { createPrismaSyncStateStore } from './prisma-store';
import { createHttpTransport } from './transport';

const globalForSync = globalThis as unknown as { showcaseSyncEngine?: SyncEngine };

/** Process-wide engine, cached across Next's dev-mode module reloads. */
export function getSyncEngine(): SyncEngine {
  if (!globalForSync.showcaseSyncEngine) {
    const sink: SyncSink = createMemorySink();
    globalForSync.showcaseSyncEngine = new SyncEngine({
      transport: createHttpTransport(),
      sink,
      store: createPrismaSyncStateStore(),
    });
  }
  return globalForSync.showcaseSyncEngine;
}

export { SyncEngine, RECONCILE_SCHEDULE } from './engine';
export type {
  DomainRunResult,
  SyncRunResult,
  WebhookApplyInput,
  WebhookApplyResult,
  WebhookApplyStatus,
} from './engine';
export { SYNC_DOMAINS, DOMAIN_DESCRIPTORS, EVENT_DOMAIN_MAP, isSyncDomain } from './domains';
export type { SyncDomain } from './domains';
export { createMemorySink } from './sink';
export type { SyncSink, SyncNode } from './sink';
export { createMemorySyncStateStore, emptyState } from './store';
export type { SyncStateRecord, SyncStateStore, SyncOutcome, SyncSource } from './store';
export { createHttpTransport } from './transport';
export type { GraphQLTransport } from './transport';
export * from './errors';
