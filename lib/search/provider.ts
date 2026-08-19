/**
 * Showcase's ⌘K contribution, and the two registrations that prove the gate.
 *
 * `SET_SEARCH_PROVIDER` is a REGISTRATION, not a query: the host persists it
 * against the install and consults it on every ⌘K — including on the many
 * admin pages where this app's iframe is not mounted at all. That is why it is
 * declared once, here, rather than answered live over postMessage.
 */

import type { SearchCommand, SearchDomain, SearchProviderPayload } from '@flashmandu/app-bridge';

/**
 * The gate, re-implemented locally — and why that is not duplication.
 *
 * The SDK exports `isPlatformOwnedSearchType`, and this screen COULD call it
 * directly. It takes the list as a parameter instead for two reasons: the test
 * can then feed it a list it controls, and the screen can print the exact set
 * it judged against rather than asserting one. The real list still comes from
 * the SDK — `app/search/page.tsx` reads `PLATFORM_OWNED_SEARCH_TYPES` and
 * passes it down — and `tests/search/dedupe.test.ts` diffs this function
 * against the SDK's own for every type in that list, singular, plural and
 * upper-cased, so a transcription that drifts fails the suite.
 */

/**
 * True when `type` names something the platform already searches.
 *
 * The plural strip is deliberately crude (one trailing `s`), exactly as the
 * SDK does it: the list is a denylist, and a near-miss like `categorie`
 * failing to match costs nothing — the type is still segregated into the app's
 * own group and badged with the app's name, so it can never be mistaken for a
 * platform row.
 */
export function isPlatformOwnedType(type: string, platformOwnedTypes: readonly string[]): boolean {
  const lower = type.trim().toLowerCase();
  if (lower === '') {
    return false;
  }
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
  return platformOwnedTypes.includes(lower) || platformOwnedTypes.includes(singular);
}

/**
 * The domains Showcase legitimately owns.
 *
 * Both are app-owned records with no platform counterpart — a saved parity
 * report, and a recorded webhook delivery. Neither is a mirror of anything the
 * platform already searches, which is exactly the condition the authority gate
 * tests for.
 */
export const SHOWCASE_DOMAINS: SearchDomain[] = [
  { type: 'parity_report', label: 'Parity reports' },
  { type: 'webhook_delivery', label: 'Deliveries' },
];

/**
 * Static ⌘K entries.
 *
 * Matched by the host IN-PROCESS against the persisted registration, so they
 * cost no network and keep working when this app's server is down — which is
 * the point of having them at all.
 */
export const SHOWCASE_COMMANDS: SearchCommand[] = [
  {
    id: 'showcase-items',
    label: 'Showcase · Items parity',
    subtitle: 'The admin Items index, rebuilt from kit components',
    path: '/items',
    keywords: ['parity', 'filter', 'index'],
  },
  {
    id: 'showcase-categories',
    label: 'Showcase · Categories parity',
    subtitle: 'The admin Categories index, and where the schema runs out',
    path: '/categories',
    keywords: ['parity', 'tree'],
  },
  {
    id: 'showcase-search',
    label: 'Showcase · Global search demo',
    subtitle: 'The authority gate and the dedupe rule, running',
    path: '/search',
    keywords: ['dedupe', 'cmd-k'],
  },
];

/** The registration Showcase actually posts. */
export const SHOWCASE_PROVIDER: SearchProviderPayload = {
  domains: SHOWCASE_DOMAINS,
  commands: SHOWCASE_COMMANDS,
  // Static entries only. A live endpoint would need `receive:search`, because
  // the merchant's typed term then LEAVES the platform — a scope this app does
  // not request, and a claim it will not make falsely on screen.
  endpoint: null,
};

/**
 * The registration that must be REJECTED — the case from the original brief.
 *
 * An app that mirrors the platform's catalog over GraphQL tries to publish its
 * copies back into ⌘K under `item`. The type is platform-owned, so the SDK
 * throws `BridgeValidationError` before the message is posted and the relay
 * answers 422. There is no domain for those rows to appear under, which is why
 * this layer — and not id matching — is what actually stops the duplication.
 */
export const REJECTED_PROVIDER: SearchProviderPayload = {
  domains: [{ type: 'item', label: 'Synced items' }],
  commands: [],
};

/**
 * The rename that IS allowed, and why it is not a loophole.
 *
 * `synced_product` is not platform-owned, so it registers — but layer D means
 * it can only ever render under "Showcase · Synced products", never inside
 * "Items". The merchant sees the app's copy labelled as the app's copy.
 * Deliberate mislabelling past that point is a review matter, not something a
 * protocol can detect, and the spec says so rather than pretending otherwise.
 */
export const RENAMED_PROVIDER: SearchProviderPayload = {
  domains: [{ type: 'synced_product', label: 'Synced products' }],
  commands: [],
};

export interface RegistrationOutcome {
  accepted: boolean;
  /** The offending type, when rejected. */
  offendingType?: string;
  explanation: string;
}

/**
 * Would the host accept this registration?
 *
 * Mirrors the gate the SDK enforces before posting. Pure, so the screen can
 * show the verdict for a payload it never sends — a rejected registration
 * throws, and a demo that had to throw to make its point would be a demo you
 * could only run once.
 */
export function judgeRegistration(
  payload: SearchProviderPayload,
  limits: { domains: number },
  platformOwnedTypes: readonly string[],
): RegistrationOutcome {
  const domains = payload.domains ?? [];

  if (domains.length > limits.domains) {
    return {
      accepted: false,
      explanation: `${domains.length} domains exceeds the cap of ${limits.domains}.`,
    };
  }

  for (const domain of domains) {
    if (isPlatformOwnedType(domain.type, platformOwnedTypes)) {
      return {
        accepted: false,
        offendingType: domain.type,
        explanation:
          `"${domain.type}" is a platform-owned record type. The platform owns a closed set ` +
          `(${platformOwnedTypes.join(', ')}) and an app may not register itself as a ` +
          'source of any of them. This is the authority gate: it is structural, enforced at ' +
          'registration, and it is the only layer that stops an app which mirrors platform ' +
          'records over GraphQL from publishing its copies back — because those copies carry the ' +
          "APP's ids, so no id-matching scheme would ever have matched them.",
      };
    }
  }

  return {
    accepted: true,
    explanation:
      'No domain names a platform-owned type, so the registration is accepted. Results still ' +
      'render only in this app\'s own groups, headed with the app name — segregation is ' +
      'unconditional, not a consequence of passing the gate.',
  };
}
