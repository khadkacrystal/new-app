/**
 * The transport here is the app-bridge itself, not a fetch wrapper. This
 * file just describes the minimal shape `execute.ts` needs from it — the
 * same structural-typing trick as `TransportBridge` in a typical
 * app-bridge SDK, so the real bridge object satisfies it with no adapting.
 *
 * No 'server-only' here on purpose: this runs in the embedded client,
 * where the bridge holds a short-TTL session token it manages and
 * refreshes on its own. There's no static secret in this file to protect.
 */

export interface BridgeTransport {
  graphql(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{
    status: number;
    body: unknown;
  }>;
}
