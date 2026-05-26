/**
 * `memory.reinforce` operation (Wave 18AA).
 *
 * Record that an existing cell was used + confirmed by a different
 * specialisation. This is the bidirectional-learning signal — when
 * the Marketplace specialisation reasons over a Geology-contributed
 * fact and produces a consistent answer, that's reinforcement. Spec §3.
 *
 * Side effects:
 *   1. Appends a row to `cognitive_memory_reinforcements`.
 *   2. Updates the parent cell's `reinforced_by_specialisations` and
 *      `reinforced_in_turn_ids` arrays (idempotent on the spec.).
 *   3. May promote `observed → reinforced` via the promotion-decider.
 *   4. Writes one audit-chain entry.
 */

import { promotionApply } from '../promotion/internal-apply.js';
import {
  CognitiveMemoryError,
  reinforceInputSchema,
  type AuditChainPort,
  type CellRepository,
  type CognitiveMemoryCell,
  type MemoryWriteContext,
  type ReinforceInput,
  type ReinforcementRepository,
} from '../types.js';

export interface ReinforceDeps {
  readonly cells: CellRepository;
  readonly reinforcements: ReinforcementRepository;
  readonly audit: AuditChainPort;
  readonly id: () => string;
  readonly now?: () => string;
}

export function createReinforce(deps: ReinforceDeps) {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  return async function reinforce(
    input: ReinforceInput,
    ctx: MemoryWriteContext,
  ): Promise<CognitiveMemoryCell> {
    const parsed = reinforceInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new CognitiveMemoryError(
        'reinforce.invalid_input',
        'memory.reinforce: invalid input',
        { issues: parsed.error.issues },
      );
    }
    const cell = await deps.cells.read(input.cell_id, ctx.tenant_id);
    if (cell === null) {
      throw new CognitiveMemoryError(
        'reinforce.cell_not_found',
        `memory.reinforce: cell ${input.cell_id} not found in tenant ${ctx.tenant_id}`,
      );
    }
    if (
      ctx.specialisation === cell.contributed_by_specialisation &&
      !cell.reinforced_by_specialisations.includes(ctx.specialisation)
    ) {
      // The contributing specialisation reinforcing its own cell is a
      // no-op for the promotion gate (spec §4 explicitly excludes the
      // contributor). The audit row still goes in for traceability.
    }
    const occurred_at: string = ctx.now ?? now();
    const audit_hash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'memory.reinforce',
      cell_id: cell.id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      occurred_at,
    });
    await deps.reinforcements.insert({
      id: deps.id(),
      cell_id: cell.id,
      tenant_id: ctx.tenant_id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      reinforced_at: occurred_at,
      audit_hash,
    });
    const next_reinforcers: ReadonlyArray<string> =
      cell.reinforced_by_specialisations.includes(ctx.specialisation)
        ? cell.reinforced_by_specialisations
        : [...cell.reinforced_by_specialisations, ctx.specialisation];
    const next_turns: ReadonlyArray<string> = cell.reinforced_in_turn_ids.includes(ctx.turn_id)
      ? cell.reinforced_in_turn_ids
      : [...cell.reinforced_in_turn_ids, ctx.turn_id];
    const confidence_delta = input.confidence_delta ?? 0;
    const next_confidence = Math.max(
      0,
      Math.min(1, cell.confidence_score + confidence_delta),
    );
    const next_citations = input.additional_evidence
      ? [...cell.evidence_citations, ...input.additional_evidence]
      : cell.evidence_citations;
    const updated = await deps.cells.update(cell.id, ctx.tenant_id, {
      reinforced_by_specialisations: next_reinforcers,
      reinforced_in_turn_ids: next_turns,
      evidence_citations: next_citations,
      confidence_score: next_confidence,
      audit_hash,
    });
    if (updated === null) {
      throw new CognitiveMemoryError(
        'reinforce.update_failed',
        `memory.reinforce: failed to update cell ${cell.id}`,
      );
    }
    // Try promotion observed → reinforced (no-op if not eligible).
    return promotionApply(updated, ctx, deps);
  };
}

export type ReinforceFn = ReturnType<typeof createReinforce>;
