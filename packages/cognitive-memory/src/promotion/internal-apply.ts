/**
 * Internal promotion applier (Wave 18AA).
 *
 * After a reinforce / observe / contradict mutation lands, run the
 * promotion decider against the freshly-updated cell and persist any
 * state transition that fires. Keeps the audit-chain semantics
 * consistent: every state change writes its own chain entry.
 *
 * This is intentionally split out of `promotion-decider.ts` to keep
 * that module pure (no IO). The applier is the one place that knows
 * how to mutate the store.
 */

import {
  type AuditChainPort,
  type CellRepository,
  type CognitiveMemoryCell,
  type MemoryWriteContext,
} from '../types.js';
import { nextPromotion } from './promotion-decider.js';

export interface PromotionApplyDeps {
  readonly cells: CellRepository;
  readonly audit: AuditChainPort;
  readonly now?: () => string;
}

/**
 * Apply any pending promotion to `cell`. Returns the cell as it
 * stands after the (possibly null) transition — call sites should
 * use the returned cell for any downstream work.
 */
export async function promotionApply(
  cell: CognitiveMemoryCell,
  ctx: MemoryWriteContext,
  deps: PromotionApplyDeps,
): Promise<CognitiveMemoryCell> {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  const occurred_at: string = ctx.now ?? now();
  const decision = nextPromotion(cell, occurred_at);
  if (decision.action !== 'promote') {
    return cell;
  }
  const event_kind = decision.to === 'decayed' ? 'memory.decay' : 'memory.promote';
  const audit_hash = await deps.audit.append({
    tenant_id: cell.tenant_id,
    event_kind,
    cell_id: cell.id,
    specialisation: ctx.specialisation,
    turn_id: ctx.turn_id,
    occurred_at,
    extra: { from: cell.promotion_status, to: decision.to, reason: decision.reason },
  });
  const patch: Parameters<CellRepository['update']>[2] =
    decision.to === 'decayed'
      ? { promotion_status: decision.to, decayed_at: occurred_at, audit_hash }
      : { promotion_status: decision.to, promoted_at: occurred_at, audit_hash };
  const promoted = await deps.cells.update(cell.id, cell.tenant_id, patch);
  return promoted ?? cell;
}
