/**
 * Slack example connector — SKELETON ONLY.
 *
 * Demonstrates the `OmnidataConnector` contract. NOT a real
 * implementation: actual Slack API calls, signature verification,
 * pagination, and rate-limit handling will land in a dedicated wave
 * (`packages/omnidata-slack/` or a `services/mcp-server-slack/` per
 * the OMNIDATA_CONNECTOR_INVENTORY.md MCP-first strategy).
 *
 * This file exists so connector authors can copy-paste a starting
 * point, and so the tests can validate end-to-end orchestration
 * against a stable in-memory stand-in.
 */

import type {
  OmnidataConnector,
  OmnidataConnectorMetadata,
  OmnidataSyncRequest,
  OmnidataSyncResult,
  OmnidataIngestedItem,
} from '../types.js';

/**
 * Stub payload type. Real Slack payloads are far richer; this is
 * intentionally minimal so the orchestration flow is unambiguous.
 */
export interface SlackMessagePayload {
  readonly channel: string;
  readonly user: string;
  readonly ts: string;
  readonly text: string;
}

export interface SlackExampleConnectorDeps {
  readonly metadata: OmnidataConnectorMetadata;
  /** Returns the (already-redacted, already-stamped) items to emit. */
  readonly fetchSince: (req: OmnidataSyncRequest) => Promise<ReadonlyArray<OmnidataIngestedItem<SlackMessagePayload>>>;
}

/**
 * Construct a Slack example connector. The actual upstream HTTP is
 * not implemented here — `fetchSince` is the seam where the
 * production wave plugs in the real `WebClient.conversations.history`
 * call.
 */
export function createSlackExampleConnector(
  deps: SlackExampleConnectorDeps,
): OmnidataConnector<SlackMessagePayload> {
  return {
    metadata: deps.metadata,
    async sync(req: OmnidataSyncRequest): Promise<OmnidataSyncResult<SlackMessagePayload>> {
      if (req.auth.kind !== 'oauth2') {
        return { kind: 'unconfigured', reason: 'Slack connector requires OAuth2 auth context' };
      }
      const startedAt = Date.now();
      try {
        const items = await deps.fetchSince(req);
        const lastTs = items[items.length - 1]?.payload.ts ?? null;
        return {
          kind: 'ok',
          items,
          nextSince: lastTs ?? req.since ?? new Date().toISOString(),
          hasMore: items.length >= req.maxItems,
          latencyMs: Date.now() - startedAt,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { kind: 'transport-error', message };
      }
    },
    verifyWebhook(_rawBody: string, _signature: string, _secret: string): boolean {
      // Real implementation: HMAC-SHA256 of `v0:${timestamp}:${rawBody}`
      // compared to `v0=${signature}` per Slack's spec. The skeleton
      // returns `false` so the orchestrator never trusts an unverified
      // payload from this stub.
      return false;
    },
  };
}
