/**
 * Stage 04 — idempotent writes to memory blocks.
 *
 * For each delta the review gate approved, dispatch to the appropriate
 * memory store via the `MemoryWriter` port:
 *
 *   - `blockKind === 'core'`      → core_memory_blocks (Letta-style)
 *   - `blockKind === 'semantic'`  → kernel_memory_semantic
 *   - `blockKind === 'embedded'`  → ai_semantic_memories
 *
 * The port carries an `appliedKey` parameter — the writer must skip the
 * write when a row with the same `appliedKey` already exists for the
 * target. This is the idempotency contract: a second run of the same
 * day's pipeline produces no net change.
 *
 * Errors per-delta are caught and reported on the per-delta result so
 * a single write failure doesn't poison the rest of the batch.
 */

import type {
  DeltaApplicationResult,
  MemoryDelta,
  BrainWorkerLogger,
} from '../types.js';

/**
 * Storage port — composition root wires this to the three Drizzle-backed
 * services in `packages/database/`:
 *   - `createCoreMemoryService` (upsert by appliedKey on core_memory_blocks)
 *   - `createSemanticMemoryService.upsertFact` (kernel_memory_semantic)
 *   - `createAiSemanticMemoryService` (ai_semantic_memories)
 *
 * The writer is responsible for the idempotency cursor: it MUST no-op
 * when a row already carries this `appliedKey`.
 */
export interface MemoryWriter {
  writeCore(args: {
    readonly tenantId: string;
    readonly userId: string | null;
    readonly personaId: string | null;
    readonly coreSubKind: NonNullable<MemoryDelta['coreSubKind']>;
    readonly content: string;
    readonly appliedKey: string;
  }): Promise<{ readonly skipped: boolean }>;

  writeSemantic(args: {
    readonly tenantId: string;
    readonly userId: string | null;
    readonly key: string;
    readonly value: unknown;
    readonly confidence: number;
    readonly appliedKey: string;
  }): Promise<{ readonly skipped: boolean }>;

  writeEmbedded(args: {
    readonly tenantId: string;
    readonly personaId: string | null;
    readonly content: string;
    readonly confidence: number;
    readonly appliedKey: string;
  }): Promise<{ readonly skipped: boolean }>;
}

export interface WriteMemoryArgs {
  readonly deltas: ReadonlyArray<MemoryDelta>;
  readonly approvals: ReadonlyArray<DeltaApplicationResult>;
  readonly logger?: BrainWorkerLogger;
}

/**
 * Run stage 04. Walks the approval list — only deltas whose application
 * result has `applied=true` are passed to the writer. Anything else is
 * surfaced on the returned results as-is so the report stage can
 * tabulate.
 */
export async function writeApprovedDeltas(
  writer: MemoryWriter,
  args: WriteMemoryArgs,
): Promise<ReadonlyArray<DeltaApplicationResult>> {
  const byKey = new Map<string, MemoryDelta>();
  for (const delta of args.deltas) {
    byKey.set(delta.idempotencyKey, delta);
  }

  const results: DeltaApplicationResult[] = [];

  for (const approval of args.approvals) {
    if (!approval.applied) {
      results.push(approval);
      continue;
    }
    const delta = byKey.get(approval.idempotencyKey);
    if (!delta) {
      results.push({
        ...approval,
        applied: false,
        skippedReason: 'delta_missing_from_batch',
      });
      continue;
    }

    try {
      const skipped = await dispatchWrite(writer, delta);
      results.push({
        ...approval,
        applied: !skipped,
        skippedReason: skipped ? 'idempotency_no_op' : null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      args.logger?.warn?.(
        {
          tenantId: delta.tenantId,
          deltaKey: delta.idempotencyKey,
          actionTag: delta.actionTag,
          err: msg,
        },
        'brain-evolution-worker: memory write failed — delta will retry next run',
      );
      results.push({
        ...approval,
        applied: false,
        escalated: false,
        skippedReason: `write_error:${msg}`,
      });
    }
  }

  return results;
}

async function dispatchWrite(
  writer: MemoryWriter,
  delta: MemoryDelta,
): Promise<boolean> {
  if (delta.blockKind === 'core') {
    const sub = delta.coreSubKind ?? 'preferences';
    const { skipped } = await writer.writeCore({
      tenantId: delta.tenantId,
      userId: delta.userId,
      personaId: delta.personaId,
      coreSubKind: sub,
      content: delta.content,
      appliedKey: delta.idempotencyKey,
    });
    return skipped;
  }

  if (delta.blockKind === 'semantic') {
    const key = delta.semanticKey ?? 'sleep-time-insight';
    const { skipped } = await writer.writeSemantic({
      tenantId: delta.tenantId,
      userId: delta.userId,
      key,
      value: { text: delta.content, rationale: delta.rationale },
      confidence: delta.confidence,
      appliedKey: delta.idempotencyKey,
    });
    return skipped;
  }

  const { skipped } = await writer.writeEmbedded({
    tenantId: delta.tenantId,
    personaId: delta.personaId,
    content: delta.content,
    confidence: delta.confidence,
    appliedKey: delta.idempotencyKey,
  });
  return skipped;
}
