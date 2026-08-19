import { loadConfig as loadBridgeConfig } from '@flashmandu/app-bridge/server';

/**
 * Runtime config for Showcase's server code.
 *
 * Thin wrapper over the SDK's `loadConfig()` (`@flashmandu/app-bridge/server`,
 * ported verbatim from this app's original `lib/config.ts`: same env var
 * names, same resolution order — `process.env` first, then the newest
 * `.flashmandu/sandbox-secrets.<app>.json` written by `autohisab-business
 * dev` — and the same sandbox-secrets file lookup).
 *
 * TWO DIVERGENCES THIS WRAPPER RESTORES:
 *
 * 1. The SDK's `loadConfig()` never throws — `apiToken`/`webhookSecret`/
 *    `devBoxBaseUrl` resolve to `''` when absent, so a cold `next build` or an
 *    unprovisioned test never explodes at import time. Showcase's
 *    `app/webhooks/route.ts` (and a few other callers) instead rely on
 *    `loadConfig()` throwing synchronously when a REQUIRED credential is
 *    missing — the webhook route catches it and answers 503
 *    "not_provisioned" rather than verifying a signature against an empty
 *    secret.
 * 2. The SDK resolves each var as `env[name] || fromSandboxSecrets(name)` —
 *    `||`, not `??` — so an env var EXPLICITLY set to `''` is treated as
 *    absent and the resolver falls through to
 *    `.flashmandu/sandbox-secrets.<app>.json` on disk. This app's original
 *    loader used `??`: a deliberately blank env var is respected as blank,
 *    never silently overridden by a stale sandbox file left on disk from a
 *    real `autohisab-business dev` run. `devBoxBaseUrl` is the field this is
 *    externally observable on (it is allowed to be `''` — "no host
 *    configured" — as opposed to `apiToken`/`webhookSecret`, which throw
 *    either way once blank). Confirmed as a real, not cosmetic, SDK
 *    behavioural regression by `tests/ops/platform.test.ts` ("refuses to
 *    guess when there is no host configured") and
 *    `tests/events-screen/hydrate-route.test.ts` ("answers 503, not 500,
 *    when the app has no credentials to read with"), both of which blank
 *    `FLASHMANDU_DEV_BOX_BASE_URL` on purpose and failed against the SDK's
 *    `||` resolution with this repo's real leftover
 *    `.flashmandu/sandbox-secrets.owner-1-showcase.json` on disk.
 */

export interface FlashmanduConfig {
  /** Bearer token issued once by the dev-box at install/dev-register time. */
  apiToken: string;
  /** HMAC secret used to verify inbound webhook signatures. */
  webhookSecret: string;
  /** Dev-box base URL (never a production host). */
  devBoxBaseUrl: string;
}

function required(name: string, value: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Run \`autohisab-business dev\` — it registers your app on the ` +
        `dev-box and writes .flashmandu/sandbox-secrets.<app>.json, which this loader reads.`,
    );
  }
  return value;
}

/**
 * `??`, not the SDK's `||` — see divergence (2) above. `fromSdk` is the
 * SDK-resolved value (env-or-sandbox-file); an env var EXPLICITLY present
 * (including `''`) always wins over it instead of being treated as absent.
 */
function preferExplicitEnv(name: string, fromSdk: string): string {
  const explicit = process.env[name];
  return explicit !== undefined ? explicit : fromSdk;
}

export function loadConfig(): FlashmanduConfig {
  const cfg = loadBridgeConfig();
  return {
    apiToken: required('FLASHMANDU_API_TOKEN', preferExplicitEnv('FLASHMANDU_API_TOKEN', cfg.apiToken)),
    webhookSecret: required(
      'FLASHMANDU_WEBHOOK_SECRET',
      preferExplicitEnv('FLASHMANDU_WEBHOOK_SECRET', cfg.webhookSecret),
    ),
    devBoxBaseUrl: preferExplicitEnv('FLASHMANDU_DEV_BOX_BASE_URL', cfg.devBoxBaseUrl).replace(/\/+$/, ''),
  };
}
