/**
 * `memory.contradict` operation (Wave 18AA).
 *
 * Mark an existing cell as contradicted when a later observation
 * breaks it. The call is gated by `isContradictionPlausible` —
 * `new_evidence_confidence` must be ≥ 0.7 (spec §4). On success:
 *
 *   1. The original cell transitions to `contradicted` status.
 *   2. A NEW cell is created (kind='failure' by default? no — same
 *      kind, but reflecting the new evidence) — and the original
 *      cell's `contradicting_cell_id` points at it.
 *   3. Two audit-chain entries fire: `memory.observe` (the new cell)
 *      and `memory.contradict` (the link).
 *
 * The new cell starts at `observed` status — it has not yet been
 * reinforced. The MD inbox surfaces this for reconciliation.
 */

import { isContradictionPlausible } from '../promotion/promotion-decider.js';
import {
  CognitiveMemoryError,
  contradictInputSchema,
  type AuditChainPort,
  type CellRepository,
  type CognitiveMemoryCell,
  type ContradictInput,
  type EmbeddingService,
  type MemoryWriteContext,
} from '../types.js';

export interface ContradictDeps {
  readonly cells: CellRepository;
  readonly embedder: EmbeddingService;
  readonly audit: AuditChainPort;
  readonly id: () => string;
  readonly now?: () => string;
}

export interface ContradictResult {
  readonly original: CognitiveMemoryCell;
  readonly replacement: CognitiveMemoryCell;
}

export function createContradict(deps: ContradictDeps) {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  return async function contradict(
    input: ContradictInput,
    ctx: MemoryWriteContext,
  ): Promise<ContradictResult> {
    const parsed = contradictInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new CognitiveMemoryError(
        'contradict.invalid_input',
        'memory.contradict: invalid input',
        { issues: parsed.error.issues },
      );
    }
    if (!isContradictionPlausible(input.new_evidence_confidence)) {
      throw new CognitiveMemoryError(
        'contradict.evidence_too_weak',
        `memory.contradict: new_evidence_confidence ${input.new_evidence_confidence.toString()} below 0.7 threshold`,
      );
    }
    const original = await deps.cells.read(input.cell_id, ctx.tenant_id);
    if (original === null) {
      throw new CognitiveMemoryError(
        'contradict.cell_not_found',
        `memory.contradict: cell ${input.cell_id} not found in tenant ${ctx.tenant_id}`,
      );
    }
    if (original.promotion_status === 'contradicted') {
      throw new CognitiveMemoryError(
        'contradict.already_contradicted',
        `memory.contradict: cell ${original.id} is already contradicted`,
      );
    }
    const occurred_at: string = ctx.now ?? now();
    const replacement_id = deps.id();
    const new_embedding = await deps.embedder.embed(input.new_evidence_text);

    // Audit row #1: the new cell coming into existence.
    const replacement_audit_hash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'memory.observe',
      cell_id: replacement_id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      occurred_at,
      extra: {
        kind: original.kind,
        scope_id: ctx.scope_id,
        replaces_cell_id: original.id,
      },
    });

    const replacement: CognitiveMemoryCell = {
      id: replacement_id,
      tenant_id: ctx.tenant_id,
      scope_id: ctx.scope_id,
      content: {
        text: input.new_evidence_text,
        embedding: new_embedding,
        structured: { replaces_cell_id: original.id },
      },
      kind: original.kind,
      contributed_by_specialisation: ctx.specialisation,
      reinforced_by_specialisations: [],
      contributed_in_turn_id: ctx.turn_id,
      reinforced_in_turn_ids: [],
      evidence_citations: input.new_evidence_citations ?? [],
      confidence_score: input.new_evidence_confidence,
      access_count: 0,
      last_accessed_at: null,
      created_at: occurred_at,
      promoted_at: null,
      decayed_at: null,
      promotion_status: 'observed',
      contradicting_cell_id: null,
      audit_hash: replacement_audit_hash,
    };
    const inserted = await deps.cells.insert(replacement);

    // Audit row #2: the contradiction link.
    const link_audit_hash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'memory.contradict',
      cell_id: original.id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      occurred_at,
      extra: {
        replacement_cell_id: inserted.id,
        new_evidence_confidence: input.new_evidence_confidence,
      },
    });

    const updated_original = await deps.cells.update(original.id, ctx.tenant_id, {
      promotion_status: 'contradicted',
      contradicting_cell_id: inserted.id,
      audit_hash: link_audit_hash,
    });
    if (updated_original === null) {
      throw new CognitiveMemoryError(
        'contradict.update_failed',
        `memory.contradict: failed to flag cell ${original.id} as contradicted`,
      );
    }
    return { original: updated_original, replacement: inserted };
  };
}

export type ContradictFn = ReturnType<typeof createContradict>;
