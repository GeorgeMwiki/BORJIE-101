/**
 * `memory.cite` operation (Wave 18AA).
 *
 * Link an existing cell into an artifact being composed (doc paragraph,
 * UI panel, media frame, campaign hook, turn output, mutation
 * justification). Citing also bumps the cell's `access_count` and
 * `last_accessed_at` so the consolidation worker can promote it. Spec §3.
 *
 * Side effects:
 *   1. Appends a row to the audit chain ('memory.cite').
 *   2. Updates the cell's access_count + last_accessed_at.
 */

import {
  CognitiveMemoryError,
  citeInputSchema,
  type AuditChainPort,
  type CellRepository,
  type CiteInput,
  type CognitiveMemoryCell,
  type MemoryWriteContext,
} from '../types.js';

export interface CiteDeps {
  readonly cells: CellRepository;
  readonly audit: AuditChainPort;
  readonly now?: () => string;
}

export function createCite(deps: CiteDeps) {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  return async function cite(
    input: CiteInput,
    ctx: MemoryWriteContext,
  ): Promise<CognitiveMemoryCell> {
    const parsed = citeInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new CognitiveMemoryError(
        'cite.invalid_input',
        'memory.cite: invalid input',
        { issues: parsed.error.issues },
      );
    }
    const cell = await deps.cells.read(input.cell_id, ctx.tenant_id);
    if (cell === null) {
      throw new CognitiveMemoryError(
        'cite.cell_not_found',
        `memory.cite: cell ${input.cell_id} not found in tenant ${ctx.tenant_id}`,
      );
    }
    const occurred_at: string = ctx.now ?? now();
    const audit_hash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'memory.cite',
      cell_id: cell.id,
      specialisation: ctx.specialisation,
      turn_id: ctx.turn_id,
      occurred_at,
      extra: {
        artifact_id: input.artifact_id,
        artifact_kind: input.artifact_kind,
      },
    });
    const updated = await deps.cells.update(cell.id, ctx.tenant_id, {
      access_count: cell.access_count + 1,
      last_accessed_at: occurred_at,
      audit_hash,
    });
    if (updated === null) {
      throw new CognitiveMemoryError(
        'cite.update_failed',
        `memory.cite: failed to update cell ${cell.id}`,
      );
    }
    return updated;
  };
}

export type CiteFn = ReturnType<typeof createCite>;
