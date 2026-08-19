/**
 * The ⌘K deduplication rule, as an executable model.
 *
 * The rule itself lives in the host
 * (`docs/superpowers/specs/2026-08-11-app-global-search-spec.md` §4). This
 * module re-implements it as four pure functions so the Showcase screen can
 * SHOW it running — including, behind a toggle, what the panel looks like with
 * the gate switched off, which is the only way "the gate is doing something"
 * is visible rather than asserted.
 *
 * This is a MODEL of the host's behaviour, not the host's code, and the screen
 * says so. It is faithful to the spec's four layers:
 *
 *   **A — Authority gate (registration).** The platform owns a closed set of
 *   record types. Registering a domain whose `type` is in that set is rejected
 *   before the message is posted — the SDK throws, the relay answers 422. This
 *   is the layer that actually kills mirror duplication: an app that syncs
 *   items over GraphQL holds rows with its OWN ids, so no id-matching scheme
 *   could ever have caught them. It is denied a domain to publish them under.
 *
 *   **B — Identity backstop (runtime).** A live result whose `type` is
 *   nonetheless platform-owned — a row persisted before the gate existed, or a
 *   response ignoring its own registration — is dropped.
 *
 *   **C — Enrichment is an attachment.** `platformRef` means "this row is
 *   about YOUR record". Such a row never becomes a top-level result: it
 *   attaches as a sub-row under the matching platform result, and is DROPPED
 *   when that platform record is not in the current result set. A merchant who
 *   searched "Kathmandu" and got no outlet should not be shown a satellite
 *   orbiting an invisible planet.
 *
 *   **D — Segregation (unconditional).** App results never merge into a
 *   platform group; they render under `"{App name} · {domain label}"`. Even a
 *   deliberately mislabelled row cannot appear inside "Items".
 *
 * Why the rule is shaped this way rather than "suppress app rows whose type +
 * id matches a platform row": that alternative assumes the app reports the
 * PLATFORM's id. The app in the original brief syncs items over GraphQL into
 * its own store and emits `app_9912`. No match, duplicate survives — it fails
 * on precisely the case it was designed for. So it is kept as layer B, a
 * backstop, and never as the rule.
 */

import type { AppSearchResult } from '@flashmandu/app-bridge';
import { isPlatformOwnedType } from './provider';

/** A platform ⌘K row, as the host produced it. */
export interface PlatformResult {
  /** `GlobalSearchService::GROUPS` type — `item`, `order`, `outlet`, … */
  type: string;
  id: string | number;
  title: string;
  subtitle?: string;
}

/** How one app result was classified. */
export type Disposition =
  /** Rendered as a top-level row in the app's own group. */
  | { kind: 'own'; group: string }
  /** Rendered as a sub-row under a platform result. */
  | { kind: 'attached'; to: PlatformResult }
  /** Not rendered, with the layer that dropped it. */
  | { kind: 'dropped'; layer: 'B' | 'C'; reason: string };

export interface JudgedResult {
  result: AppSearchResult;
  disposition: Disposition;
}

export interface DedupeInput {
  appName: string;
  /**
   * The platform's closed set of record types.
   *
   * Injected rather than imported so the rule is testable with a list the test
   * chooses, and so the screen can PRINT the exact set it judged against. The
   * real list is read from the SDK in `app/search/page.tsx` and handed down;
   * `tests/search/dedupe.test.ts` diffs the local gate against the SDK's own
   * `isPlatformOwnedSearchType` so the two can never drift.
   */
  platformOwnedTypes: readonly string[];
  /** Registered domains, `type` → group label. */
  domains: { type: string; label: string }[];
  platform: PlatformResult[];
  results: AppSearchResult[];
  /**
   * Turn the rule OFF, so the screen can render the duplicating behaviour side
   * by side with the deduped one. Never a runtime option on the host — this
   * exists so the difference is visible, not so it is configurable.
   */
  naive?: boolean;
}

function platformKey(type: string, id: string | number): string {
  return `${type.toLowerCase()}:${String(id)}`;
}

/**
 * Judge each app result.
 *
 * With `naive: true` every result is rendered as its own top-level row — no
 * type check, no attachment, no drop — which is what a ⌘K panel looks like
 * when an app mirroring the platform's records is allowed to publish them
 * back. That output is the duplication complaint, reproduced.
 */
export function judgeResults(input: DedupeInput): JudgedResult[] {
  const groups = new Map(input.domains.map((domain) => [domain.type, domain.label]));
  const present = new Set(input.platform.map((row) => platformKey(row.type, row.id)));

  return input.results.map((result): JudgedResult => {
    const group = `${input.appName} · ${groups.get(result.type) ?? result.type}`;

    if (input.naive === true) {
      return { result, disposition: { kind: 'own', group } };
    }

    // Layer B — the identity backstop.
    if (isPlatformOwnedType(result.type, input.platformOwnedTypes)) {
      return {
        result,
        disposition: {
          kind: 'dropped',
          layer: 'B',
          reason: `type "${result.type}" is platform-owned; the registration that would have allowed it is rejected at layer A, so a live result claiming it is dropped.`,
        },
      };
    }

    // Layer C — enrichment is an attachment, never a standalone row.
    if (result.platformRef !== undefined && result.platformRef !== null) {
      const anchor = input.platform.find(
        (row) => platformKey(row.type, row.id) === platformKey(result.platformRef!.type, result.platformRef!.id),
      );
      if (anchor === undefined) {
        return {
          result,
          disposition: {
            kind: 'dropped',
            layer: 'C',
            reason: `carries platformRef ${result.platformRef.type}#${result.platformRef.id}, which is not in this search's platform results — an enrichment with no record to enrich.`,
          },
        };
      }
      return { result, disposition: { kind: 'attached', to: anchor } };
    }

    // Layer D — an app-owned record, in the app's own group. Always segregated.
    return { result, disposition: { kind: 'own', group } };
  });
}

/** The ⌘K panel as the merchant would see it, platform groups first. */
export interface RenderedGroup {
  heading: string;
  owner: 'platform' | 'app';
  rows: {
    title: string;
    subtitle?: string;
    /** Sub-rows attached under this platform row (layer C). */
    attachments: { title: string; subtitle?: string; badge: string }[];
  }[];
}

export function renderPanel(input: DedupeInput): RenderedGroup[] {
  const judged = judgeResults(input);
  const groups: RenderedGroup[] = [];

  // Platform groups, in the order the host produced them, each carrying its
  // attachments. Never merged with, never reordered by, app output.
  for (const row of input.platform) {
    const heading = `${row.type.charAt(0).toUpperCase()}${row.type.slice(1)}s`;
    let group = groups.find((entry) => entry.heading === heading && entry.owner === 'platform');
    if (group === undefined) {
      group = { heading, owner: 'platform', rows: [] };
      groups.push(group);
    }
    group.rows.push({
      title: row.title,
      subtitle: row.subtitle,
      attachments: judged
        .filter(
          (entry) =>
            entry.disposition.kind === 'attached' &&
            platformKey(entry.disposition.to.type, entry.disposition.to.id) ===
              platformKey(row.type, row.id),
        )
        .map((entry) => ({
          title: entry.result.title,
          subtitle: entry.result.subtitle,
          badge: input.appName,
        })),
    });
  }

  // App groups, after every platform group, headed with the app's name.
  for (const entry of judged) {
    if (entry.disposition.kind !== 'own') {
      continue;
    }
    const heading = entry.disposition.group;
    let group = groups.find((candidate) => candidate.heading === heading && candidate.owner === 'app');
    if (group === undefined) {
      group = { heading, owner: 'app', rows: [] };
      groups.push(group);
    }
    group.rows.push({
      title: entry.result.title,
      subtitle: entry.result.subtitle,
      attachments: [],
    });
  }

  return groups;
}

/**
 * How many rows in the panel name the SAME platform record twice.
 *
 * The number the whole rule exists to keep at zero, and the reason the naive
 * toggle is on the screen: with the gate off it is not zero, and that is
 * visible rather than argued.
 */
export function duplicateCount(input: DedupeInput): number {
  const panel = renderPanel(input);
  const titles = new Map<string, number>();
  for (const group of panel) {
    for (const row of group.rows) {
      const key = row.title.trim().toLowerCase();
      titles.set(key, (titles.get(key) ?? 0) + 1);
    }
  }
  let duplicates = 0;
  for (const count of titles.values()) {
    if (count > 1) {
      duplicates += count - 1;
    }
  }
  return duplicates;
}
