/**
 * Audit-chain link helpers — small wrappers over the
 * `@borjie/audit-hash-chain` primitive that make it ergonomic for
 * connector authors to anchor sync events without hand-rolling the
 * `AuditPayload` shape.
 *
 * Pure; no I/O. The actual append happens through the
 * `AuditChainPort` consumers inject.
 */

import type { AuditChainPort } from '../types.js';

export type SyncAuditEvent =
  | { readonly kind: 'sync.started'; readonly correlationId: string }
  | { readonly kind: 'sync.completed'; readonly correlationId: string; readonly itemsIngested: number; readonly latencyMs: number }
  | { readonly kind: 'sync.failed'; readonly correlationId: string; readonly errorMessage: string }
  | { readonly kind: 'sync.rate-limited'; readonly correlationId: string; readonly retryAfterMs: number }
  | { readonly kind: 'sync.consent-missing'; readonly correlationId: string; readonly missingScopes: ReadonlyArray<string> };

export interface AuditLink {
  readonly recordSyncEvent: (params: {
    readonly tenantId: string;
    readonly connectorId: string;
    readonly event: SyncAuditEvent;
  }) => Promise<{ readonly hash: string }>;
}

export function createAuditLink(audit: AuditChainPort): AuditLink {
  return {
    recordSyncEvent: ({ tenantId, connectorId, event }) =>
      audit.append({
        tenantId,
        action: `omnidata.${event.kind}`,
        resourceId: connectorId,
        metadata: { ...event },
      }),
  };
}
