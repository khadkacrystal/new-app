/**
 * What the REST proxy can and cannot answer.
 *
 * `BridgeProxyController::resolveHandler` is an allow-list of exactly five
 * entries, matched verbatim with no globbing:
 *
 * | method | path            | arguments it accepts                |
 * |--------|-----------------|-------------------------------------|
 * | GET    | `me`            | none                                |
 * | GET    | `orders`        | `location_ids` (required, non-empty)|
 * | GET    | `catalog/items` | `term` + `limit`, or `ids`          |
 * | GET    | `parties`       | `term` + `limit`, or `ids`          |
 * | GET    | `locations`     | `kind` + `limit`, or `ids`          |
 *
 * Read that table next to the eight list domains and the honest conclusion is
 * uncomfortable, which is exactly why it is written down here instead of being
 * quietly smoothed over:
 *
 * - **customers** and **items** have a proxy shape, but ONLY with a search
 *   term — there is no "give me the first page" form. So the fallback works
 *   when the merchant has typed something and cannot work when they have not.
 * - **outlets** does not map to `locations`: `LocationPort` serves SERVICE
 *   locations (tables and rooms), a different resource from an outlet. Using
 *   it as a stand-in would put the wrong rows under the right heading, which
 *   is worse than an empty tab.
 * - **orders** needs `location_ids`, and this screen has no location filter to
 *   supply them from; the port short-circuits to `[]` for an empty list, so a
 *   fallback here would render "no orders" for a profile with 76 of them.
 * - **cmsEntries**, **employees**, **media** and **accounts** have no proxy
 *   path at all.
 *
 * Nothing below invents a row to paper over any of that. A domain with no
 * usable plan returns `null` and the transport reports `unavailable` with the
 * reason, which the screen prints verbatim.
 *
 * The proxy also loses keyset pagination — the ports return a bounded list,
 * not a `{nodes, pageInfo}` connection — so every plan carries a `caveat` that
 * the transport badge shows. Losing pagination silently is how an app ends up
 * believing a merchant has 25 customers.
 */

import type { DataTabSlug } from './views';

export interface ProxyPlan {
  method: 'GET' | 'POST';
  /** Allow-list path, without a leading slash. */
  path: string;
  body: Record<string, unknown>;
  /**
   * Turn the port's REST payload into the same `{ <field>: { nodes, pageInfo } }`
   * shape the GraphQL walk produces, so one renderer serves both transports.
   */
  adapt: (body: unknown) => Record<string, unknown>;
  /** What is LOST on this path. Always shown next to the proxy badge. */
  caveat: string;
}

export interface ProxyContext {
  /** The FilterBar search term. Several proxy paths require one. */
  term: string;
  /** Page size the caller asked the direct path for. */
  first: number;
}

/** Why a domain has no proxy plan, in the merchant's words. Null = it has one. */
export const PROXY_GAPS: Record<DataTabSlug, string | null> = {
  customers: null,
  items: null,
  orders:
    'GET orders requires location_ids and the port returns an empty list without them. This screen has no location filter to supply, and answering "no orders" for a profile that has 76 would be a lie, so the proxy is not offered here.',
  cms: 'The proxy allow-list has no CMS path. cmsEntries is direct-only.',
  employees: 'The proxy allow-list has no employee path. employees is direct-only.',
  media: 'The proxy allow-list has no media path. media is direct-only.',
  accounts: 'The proxy allow-list has no ledger path. accounts is direct-only.',
  outlets:
    'GET locations serves SERVICE locations (tables and rooms), which is a different resource from an outlet. Substituting it would put the wrong rows under the right heading, so the proxy is not offered here.',
};

/** Wrap a bare list as a single-page connection, flagged as un-paginated. */
function asSinglePage(field: string, nodes: unknown): Record<string, unknown> {
  const list = Array.isArray(nodes) ? nodes : [];
  return { [field]: { nodes: list, pageInfo: { hasNextPage: false, endCursor: null } } };
}

function listFrom(body: unknown, key: string): unknown {
  if (body !== null && typeof body === 'object' && key in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>)[key];
  }
  return [];
}

/**
 * The proxy plan for one tab, or null when there is none for these arguments.
 *
 * `term` matters: `parties` and `catalog/items` both short-circuit to `[]`
 * without one, so a plan is only offered once the merchant has typed. The
 * screen surfaces that as "type to enable the proxy path" rather than showing
 * an empty table and calling it a fallback.
 */
export function proxyPlanFor(slug: DataTabSlug, context: ProxyContext): ProxyPlan | null {
  const term = context.term.trim();
  const limit = Math.max(1, Math.min(context.first, 100));

  if (slug === 'customers') {
    if (term === '') {
      return null;
    }
    return {
      method: 'GET',
      path: 'parties',
      body: { term, limit },
      adapt: (body) => asSinglePage('customers', listFrom(body, 'parties')),
      caveat:
        'PartyPort::search, not the keyset walk: it is capped at 100, returns ACTIVE parties only, has no cursor, and matches the term server-side rather than paging everything.',
    };
  }

  if (slug === 'items') {
    if (term === '') {
      return null;
    }
    return {
      method: 'GET',
      path: 'catalog/items',
      body: { term, limit },
      adapt: (body) => asSinglePage('items', listFrom(body, 'items')),
      caveat:
        'CatalogPort::search, not the keyset walk: capped at 100, ACTIVE items only, no cursor, term matched server-side.',
    };
  }

  return null;
}

/**
 * Why the proxy is unavailable for this tab RIGHT NOW — either the standing
 * gap, or "no search term yet" for the two paths that need one.
 */
export function proxyGapFor(slug: DataTabSlug, context: ProxyContext): string | null {
  const standing = PROXY_GAPS[slug];
  if (standing !== null) {
    return standing;
  }
  if (context.term.trim() === '') {
    return 'The proxy path for this domain is a SEARCH (GET parties / GET catalog/items) and returns an empty list without a term. Type in the search box to enable it — an empty table here would not be a fallback, it would be a wrong answer.';
  }
  return null;
}
