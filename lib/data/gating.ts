/**
 * The check that has to happen before an app republishes CMS content.
 *
 * `types/cms.graphql` states the contract in its own words: gated entries are
 * RETURNED AND LABELLED, never silently filtered, because filtering would hand
 * a backup or audit app an incomplete inventory it cannot detect. The cost of
 * that choice is that **the app now owns the gate**:
 *
 * > you must check this field, or `isPublic`, before republishing an entry
 * > anywhere a non-member can read it. Syndicating a `role_restricted` post to
 * > a public Facebook page leaks the merchant's members-only content, and
 * > nothing downstream will catch it for you.
 *
 * So this module exists, it is pure, and the Republish button on the CMS tab
 * cannot be wired without going through it. Three rules:
 *
 * 1. `isPublic` is the single check. The schema says it is true only when
 *    `accessLevel` is `public`.
 * 2. When the two DISAGREE, fail closed. A host mid-deploy, an older schema,
 *    or a field this app forgot to select all produce disagreement, and the
 *    safe reading of "I am not sure whether this is public" is "it is not".
 * 3. An unrecognised `accessLevel` is also blocked. A new gating level added
 *    to the platform must not fall through an app's `=== 'public'` check and
 *    get published — forward-compatibility here means failing closed, not
 *    guessing.
 *
 * Showcase does not actually publish anywhere: the button opens a host
 * confirmation and then reports what a real syndication app WOULD have been
 * allowed to send. The gate is the point; the destination is not.
 */

/** The gating fields, as selected by the `cmsEntries` walk. */
export interface GatedEntry {
  id: string | number;
  title?: unknown;
  accessLevel?: unknown;
  isPublic?: unknown;
  status?: unknown;
}

export type GateSeverity = 'ok' | 'blocked';

export interface GateVerdict {
  id: string;
  title: string;
  allowed: boolean;
  severity: GateSeverity;
  /** The `accessLevel` verbatim, or `'(missing)'`. */
  accessLevel: string;
  /** Short reason, shown on the row. */
  headline: string;
  /** The full explanation, shown in the confirmation before republish. */
  detail: string;
}

/** The three levels the platform documents today. */
const KNOWN_LEVELS = new Set(['public', 'authenticated', 'role_restricted']);

const LEVEL_WORDS: Record<string, string> = {
  authenticated: 'logged-in customers only',
  role_restricted: 'specific customer roles only',
};

export function evaluateRepublish(entry: GatedEntry): GateVerdict {
  const id = String(entry.id);
  const title = typeof entry.title === 'string' && entry.title !== '' ? entry.title : `Entry ${id}`;
  const level = typeof entry.accessLevel === 'string' ? entry.accessLevel : '';
  const isPublic = entry.isPublic;
  const shown = level === '' ? '(missing)' : level;

  const block = (headline: string, detail: string): GateVerdict => ({
    id,
    title,
    allowed: false,
    severity: 'blocked',
    accessLevel: shown,
    headline,
    detail,
  });

  if (level === '') {
    return block(
      'accessLevel missing',
      'This entry carries no accessLevel, so there is nothing to check against. An app that treats a missing gate as "public" is one schema change away from leaking members-only content, so this fails closed.',
    );
  }

  if (!KNOWN_LEVELS.has(level)) {
    return block(
      `unknown accessLevel "${level}"`,
      `The platform returned a gating level this app does not recognise. A new level must never fall through an "=== public" check and get republished, so an unknown value is treated as gated until this app is updated to understand it.`,
    );
  }

  if (typeof isPublic !== 'boolean') {
    return block(
      'isPublic missing',
      'The single documented check — isPublic — was not returned, so this app cannot assert the entry is public. Not knowing is not the same as it being safe.',
    );
  }

  if (isPublic !== (level === 'public')) {
    return block(
      'isPublic disagrees with accessLevel',
      `The platform says isPublic=${String(isPublic)} while accessLevel="${level}". The schema guarantees isPublic is true only for public entries, so the two disagreeing means one of them is stale — a host mid-deploy, or a cached row. Republishing on a coin flip is not a option; this fails closed.`,
    );
  }

  if (level !== 'public') {
    return block(
      `gated: ${LEVEL_WORDS[level] ?? level}`,
      `This entry is readable on the storefront by ${LEVEL_WORDS[level] ?? level}. Pushing it to any destination a non-member can read leaks the merchant's gated content, and nothing downstream catches it. Republish is blocked.`,
    );
  }

  return {
    id,
    title,
    allowed: true,
    severity: 'ok',
    accessLevel: level,
    headline: 'public',
    detail:
      'accessLevel is public and isPublic is true, so this entry is safe to push to a public destination.',
  };
}

export interface GateSummary {
  verdicts: GateVerdict[];
  allowed: GateVerdict[];
  blocked: GateVerdict[];
  /** Confirmation body, shown in the host modal before republish. */
  confirmation: string;
  /** True when there is at least one entry that may be republished. */
  canProceed: boolean;
}

export function summariseRepublish(entries: GatedEntry[]): GateSummary {
  const verdicts = entries.map(evaluateRepublish);
  const allowed = verdicts.filter((v) => v.allowed);
  const blocked = verdicts.filter((v) => !v.allowed);

  const lines: string[] = [];
  if (allowed.length > 0) {
    lines.push(
      `${allowed.length} of ${verdicts.length} selected ${verdicts.length === 1 ? 'entry is' : 'entries are'} public and would be sent.`,
    );
  }
  if (blocked.length > 0) {
    lines.push(
      `${blocked.length} would be withheld: ${blocked
        .map((v) => `${v.title} (${v.headline})`)
        .join('; ')}.`,
    );
  }
  if (verdicts.length === 0) {
    lines.push('Nothing is selected.');
  }
  lines.push(
    'Showcase does not publish anywhere — it reports what a syndication app would have been permitted to send.',
  );

  return {
    verdicts,
    allowed,
    blocked,
    confirmation: lines.join(' '),
    canProceed: allowed.length > 0,
  };
}
