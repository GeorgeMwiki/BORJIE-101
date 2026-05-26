/**
 * `audit-chain-link.ts` — emits the audit-hash payload for a single MCTS
 * invocation. Mirrors the `AuditPayload` shape of `@borjie/audit-hash-chain`
 * (PO-14 spec): a `kind` tag plus a canonical payload object.
 *
 * Pure. The caller threads the result through the chain's `appendEntry`.
 */

import type { MctsAuditPayload, MctsTerminationReason } from '../types.js';

export interface BuildMctsAuditPayloadInput {
  readonly tenantId: string;
  readonly turnId: string;
  readonly intentKind: string;
  readonly rolloutsRun: number;
  readonly bestValue: number;
  readonly terminatedReason: MctsTerminationReason;
  readonly selectedPathHash: string;
  readonly treeSize: number;
  readonly wallMs: number;
  readonly timestampIso: string;
}

export function buildMctsAuditPayload(
  input: BuildMctsAuditPayloadInput,
): MctsAuditPayload {
  return Object.freeze({
    kind: 'mcts_reasoning_search' as const,
    payload: Object.freeze({
      tenant_id: input.tenantId,
      turn_id: input.turnId,
      intent_kind: input.intentKind,
      rollouts_run: input.rolloutsRun,
      best_value: input.bestValue,
      terminated_reason: input.terminatedReason,
      selected_path_hash: input.selectedPathHash,
      tree_size: input.treeSize,
      wall_ms: input.wallMs,
      timestamp_iso: input.timestampIso,
    }),
  });
}
