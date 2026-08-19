/**
 * Persistence for the per-domain sync state machine.
 *
 * The shape mirrors the `SyncState` Prisma model one-for-one, but the engine
 * talks to this interface rather than to Prisma so the suite can run the whole
 * state machine — resume-from-cursor included — without a SQLite file. The
 * Prisma-backed implementation lives in `prisma-store.ts`, which is the only
 * file in `lib/sync` that imports the DB.
 */

import type { SyncDomain } from './domains';

/** `SyncState.lastOutcome`. Exactly the four values the model documents. */
export type SyncOutcome = 'never-run' | 'ok' | 'partial' | 'error';

/** `SyncState.lastRunSource`. */
export type SyncSource = 'install-walk' | 'webhook' | 'schedule:reconcile' | 'manual';

export interface SyncStateRecord {
  domain: SyncDomain;
  endCursor: string | null;
  walkComplete: boolean;
  lastUpdatedAtMin: Date | null;
  lastSyncedAt: Date | null;
  lastRunAt: Date | null;
  lastRunRecordCount: number;
  recordCount: number;
  lastRunPageCount: number;
  lastOutcome: SyncOutcome;
  lastError: string | null;
  lastRunSource: SyncSource | null;
}

export type SyncStatePatch = Partial<Omit<SyncStateRecord, 'domain'>>;

export interface SyncStateStore {
  get(domain: SyncDomain): Promise<SyncStateRecord>;
  all(): Promise<SyncStateRecord[]>;
  update(domain: SyncDomain, patch: SyncStatePatch): Promise<SyncStateRecord>;
  /** Drop everything — `app.uninstalled` / `profile.data.erased`. */
  clear(): Promise<void>;
}

export function emptyState(domain: SyncDomain): SyncStateRecord {
  return {
    domain,
    endCursor: null,
    walkComplete: false,
    lastUpdatedAtMin: null,
    lastSyncedAt: null,
    lastRunAt: null,
    lastRunRecordCount: 0,
    recordCount: 0,
    lastRunPageCount: 0,
    lastOutcome: 'never-run',
    lastError: null,
    lastRunSource: null,
  };
}

/** In-memory store, used by the suite and by any dry-run of the engine. */
export function createMemorySyncStateStore(
  seed: Partial<Record<SyncDomain, Partial<SyncStateRecord>>> = {},
): SyncStateStore {
  const rows = new Map<SyncDomain, SyncStateRecord>();

  for (const [domain, patch] of Object.entries(seed) as [SyncDomain, Partial<SyncStateRecord>][]) {
    rows.set(domain, { ...emptyState(domain), ...patch, domain });
  }

  return {
    async get(domain) {
      const existing = rows.get(domain);
      if (existing) {
        return { ...existing };
      }
      const created = emptyState(domain);
      rows.set(domain, created);
      return { ...created };
    },
    async all() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async update(domain, patch) {
      const current = rows.get(domain) ?? emptyState(domain);
      const next = { ...current, ...patch, domain };
      rows.set(domain, next);
      return { ...next };
    },
    async clear() {
      rows.clear();
    },
  };
}
