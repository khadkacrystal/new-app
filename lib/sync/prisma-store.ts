import 'server-only';

/**
 * The `SyncState` table as a `SyncStateStore`.
 *
 * The only file under `lib/sync` that touches Prisma — everything else in the
 * engine is storage-agnostic, which is what lets the certification suite run
 * the full state machine without a database file.
 *
 * `upsert` rather than `update` throughout: the eight rows are created lazily
 * on first read, so a fresh install has no seeding step and a domain added to
 * `SYNC_DOMAINS` later needs no migration.
 */

import { prisma } from '../db';
import { SYNC_DOMAINS, isSyncDomain, type SyncDomain } from './domains';
import {
  emptyState,
  type SyncOutcome,
  type SyncSource,
  type SyncStatePatch,
  type SyncStateRecord,
  type SyncStateStore,
} from './store';

/** Prisma row → engine record. The string columns are narrowed here. */
function toRecord(row: {
  domain: string;
  endCursor: string | null;
  walkComplete: boolean;
  lastUpdatedAtMin: Date | null;
  lastSyncedAt: Date | null;
  lastRunAt: Date | null;
  lastRunRecordCount: number;
  recordCount: number;
  lastRunPageCount: number;
  lastOutcome: string;
  lastError: string | null;
  lastRunSource: string | null;
}): SyncStateRecord {
  return {
    domain: (isSyncDomain(row.domain) ? row.domain : row.domain) as SyncDomain,
    endCursor: row.endCursor,
    walkComplete: row.walkComplete,
    lastUpdatedAtMin: row.lastUpdatedAtMin,
    lastSyncedAt: row.lastSyncedAt,
    lastRunAt: row.lastRunAt,
    lastRunRecordCount: row.lastRunRecordCount,
    recordCount: row.recordCount,
    lastRunPageCount: row.lastRunPageCount,
    lastOutcome: row.lastOutcome as SyncOutcome,
    lastError: row.lastError,
    lastRunSource: (row.lastRunSource as SyncSource | null) ?? null,
  };
}

export function createPrismaSyncStateStore(): SyncStateStore {
  return {
    async get(domain) {
      const row = await prisma.syncState.findUnique({ where: { domain } });
      return row ? toRecord(row) : emptyState(domain);
    },

    async all() {
      const rows = await prisma.syncState.findMany();
      const byDomain = new Map(rows.map((row) => [row.domain, toRecord(row)]));
      // Always eight rows in declaration order, whether or not the table has
      // caught up — the Sync screen renders a fixed grid, not whatever exists.
      return SYNC_DOMAINS.map((domain) => byDomain.get(domain) ?? emptyState(domain));
    },

    async update(domain: SyncDomain, patch: SyncStatePatch) {
      const row = await prisma.syncState.upsert({
        where: { domain },
        create: { ...emptyStateForCreate(domain), ...patch },
        update: patch,
      });
      return toRecord(row);
    },

    async clear() {
      await prisma.syncState.deleteMany({});
    },
  };
}

/** `emptyState` minus the `domain` duplication Prisma's create input dislikes. */
function emptyStateForCreate(domain: SyncDomain) {
  const { domain: _ignored, ...rest } = emptyState(domain);
  return { domain, ...rest };
}
