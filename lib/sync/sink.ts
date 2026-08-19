/**
 * Where synced records land — the seam a real app replaces.
 *
 * Showcase deliberately does NOT mirror the merchant's catalog into its own
 * tables. The design spec's §4 lists exactly three Prisma models (`events`,
 * `sync_state`, `connections`) and the Data Browser reads live from the
 * platform, because a demo app that quietly hoards a merchant's customer list
 * would be the wrong thing to hold up as the reference implementation.
 *
 * That leaves the sink as an interface with an in-process reference
 * implementation. It is not a stub: it is the component that makes the engine
 * idempotent, and it is exercised by every test in `tests/sync`. A real
 * connector implements the same four methods against its own store and gets
 * the same guarantees.
 *
 * Two things live here rather than in the engine, on purpose:
 *
 * - **Dedupe.** The engine adds `applied`, never `nodes.length`, to its
 *   counts. A re-delivered page or an overlapping `updatedAtMin` window
 *   therefore costs zero. That is what makes a double reconcile tick a no-op.
 * - **The sequence guard.** Webhook payloads carry a per-resource monotonic
 *   `sequence`; an update at or below the applied sequence is stale and must
 *   be dropped. The sink is the only place that knows what was applied last,
 *   so the check belongs here and cannot be forgotten by a caller.
 */

import type { SyncDomain } from './domains';

/** A record as the platform returned it. `id` is `ID!`, always a string. */
export interface SyncNode {
  id: string;
  [field: string]: unknown;
}

export interface SinkApplyResult {
  /** Rows written: genuinely new, or changed since the stored copy. */
  applied: number;
  /** Rows the sink already held unchanged, or dropped as stale-sequence. */
  skipped: number;
}

export interface SyncSink {
  /**
   * Upsert a page. `sequence`, when given, applies to every node in the call
   * (the webhook fast path passes one node; a walk passes none, because a page
   * carries no sequence).
   */
  apply(domain: SyncDomain, nodes: SyncNode[], sequence?: number | null): Promise<SinkApplyResult>;
  /** Drop one record. Resolves false when it was not held. */
  remove(domain: SyncDomain, id: string): Promise<boolean>;
  /** Distinct records currently held for the domain. */
  count(domain: SyncDomain): Promise<number>;
  /** Forget a domain, or everything — the `profile.data.erased` path. */
  clear(domain?: SyncDomain): Promise<void>;
}

interface StoredRecord {
  node: SyncNode;
  fingerprint: string;
  sequence: number | null;
}

/**
 * Stable JSON fingerprint. Key order out of GraphQL follows the selection set
 * and is stable in practice, but sorting makes "unchanged" mean unchanged
 * rather than "serialised in the same order this time".
 */
function fingerprint(node: SyncNode): string {
  const keys = Object.keys(node).sort();
  return JSON.stringify(keys.map((k) => [k, node[k]]));
}

/**
 * The reference sink: an in-process Map per domain.
 *
 * In-process is an honest limitation, not a hidden one — restart the Next
 * server and the mirror is empty until the next walk repopulates it, which is
 * why `SyncState.recordCount` is written from `count()` after every run rather
 * than accumulated blindly. Swap this for a table-backed implementation and
 * nothing in the engine changes.
 */
export function createMemorySink(): SyncSink {
  const store = new Map<SyncDomain, Map<string, StoredRecord>>();

  const domainMap = (domain: SyncDomain): Map<string, StoredRecord> => {
    let map = store.get(domain);
    if (!map) {
      map = new Map();
      store.set(domain, map);
    }
    return map;
  };

  return {
    async apply(domain, nodes, sequence = null) {
      const map = domainMap(domain);
      let applied = 0;
      let skipped = 0;

      for (const node of nodes) {
        const id = String(node.id);
        const existing = map.get(id);
        const print = fingerprint(node);

        // Stale-sequence drop. Only meaningful when BOTH sides carry one:
        // a walk has no sequence and must never be blocked by an earlier
        // webhook's number.
        if (
          existing &&
          sequence !== null &&
          existing.sequence !== null &&
          sequence <= existing.sequence
        ) {
          skipped += 1;
          continue;
        }

        if (existing && existing.fingerprint === print) {
          // Byte-identical replay. Keep the higher sequence so a later stale
          // delivery is still recognised as stale.
          if (sequence !== null) {
            existing.sequence = Math.max(existing.sequence ?? sequence, sequence);
          }
          skipped += 1;
          continue;
        }

        map.set(id, {
          node,
          fingerprint: print,
          sequence: sequence ?? existing?.sequence ?? null,
        });
        applied += 1;
      }

      return { applied, skipped };
    },

    async remove(domain, id) {
      return domainMap(domain).delete(String(id));
    },

    async count(domain) {
      return domainMap(domain).size;
    },

    async clear(domain) {
      if (domain) {
        store.delete(domain);
      } else {
        store.clear();
      }
    },
  };
}
