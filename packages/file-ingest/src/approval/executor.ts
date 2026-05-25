/**
 * IngestExecutor — walks an APPROVED IngestPlan, builds Provenance + entity
 * writes per row, and commits via IEntityStoreService.
 *
 * Design notes:
 *  - Entity ids are deterministic from the dedup-key columns + tenant_id +
 *    entity_type. Re-ingesting the same file yields the same entity ids.
 *  - Each attribute write carries its row's Provenance. The store dedups by
 *    provenance hash, so re-ingestion is a no-op.
 *  - Dry-run does everything except the final upsert — useful for the
 *    "preview" pane shown in chat before owner approves.
 *
 * Failure model:
 *  - The bulk upsert per batch is treated as a unit. If batch N throws,
 *    the executor stops AND records `partial_failure` on the ledger with
 *    the indices of the batches that DID land. The throw is re-raised as
 *    {@link PartialIngestFailureError} so the orchestration layer can
 *    surface a clear message in chat. A retried ingest of the same logical
 *    file requires a NEW plan id (the partial-failure plan is terminal).
 */

import { createHash } from 'node:crypto';

import type {
  AttributeWrite,
  CreateEntityInput,
  IEntityStoreService,
} from '../entity-store/IEntityStoreService.js';
import { buildProvenance } from '../provenance/hash.js';

import { ApprovalLedger, ApprovalRuleViolationError } from './approval-ledger.js';
import type { IngestPlan, PartialFailureMetadata } from './types.js';

export interface ExecutionContext {
  readonly tenant_id: string;
  /** Same actor that approved the plan in the ledger. The ledger enforces 4-eye. */
  readonly executor_actor_id: string;
  /** Timestamp factory — injectable for tests. Default = Date.now. */
  readonly now?: () => Date;
}

export interface BatchReport {
  readonly batch_idx: number;
  readonly entities_processed: number;
  readonly entities_created: number;
  readonly attributes_written: number;
  readonly attributes_skipped: number;
}

export interface ExecutionReport {
  readonly ingest_plan_id: string;
  readonly tenant_id: string;
  readonly entity_type: string;
  readonly dry_run: boolean;
  readonly total_rows: number;
  readonly entities_processed: number;
  readonly entities_created: number;
  readonly attributes_written: number;
  readonly attributes_skipped: number;
  readonly batch_reports: ReadonlyArray<BatchReport>;
  readonly conversation_id: string;
  /** Suggested chat-message link target. Format: app://entities/{entity_type} */
  readonly tab_link: string;
}

/**
 * Thrown when an in-flight batch upsert throws. Carries the partial-failure
 * metadata so the orchestration layer (and tests) can introspect which
 * batches landed.
 */
export class PartialIngestFailureError extends Error {
  public readonly metadata: PartialFailureMetadata;
  public override readonly cause: unknown;

  constructor(message: string, metadata: PartialFailureMetadata, cause: unknown) {
    super(message);
    this.name = 'PartialIngestFailureError';
    this.metadata = metadata;
    this.cause = cause;
  }
}

/** Keys that must never appear in a dynamic property map. Defence-in-depth
 * against prototype pollution: even though we use null-prototype objects,
 * we still filter these names BEFORE the lookup so a hostile field_map
 * (e.g. from a malicious LLM response that bypassed schema validation)
 * cannot reach Object.prototype. */
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deterministically derive an entity_id from the dedup-key column values.
 * When no dedup signal is available we fall back to a hash of (tenant_id,
 * entity_type, absolute row index, file_hash). The fallback used to call
 * `Math.random()`, which made re-ingesting the same file produce DIFFERENT
 * entity ids — defeating idempotency. The deterministic hash recipe
 * guarantees the same row in the same file always yields the same id.
 */
function deriveEntityId(
  tenantId: string,
  entityType: string,
  dedupKeyValues: ReadonlyArray<string>,
  absRowIdx: number,
  fileHash: string
): string {
  if (dedupKeyValues.length === 0 || dedupKeyValues.every((v) => v.trim() === '')) {
    const payload = `${tenantId}|${entityType}|${absRowIdx}|${fileHash}`;
    const hex = createHash('sha256').update(payload).digest('hex');
    return `${entityType}-${hex.slice(0, 32)}`;
  }
  const payload = [
    tenantId,
    entityType,
    ...dedupKeyValues.map((v) => v.trim().toLowerCase()),
  ].join('|');
  const hex = createHash('sha256').update(payload).digest('hex');
  return `${entityType}-${hex.slice(0, 32)}`;
}

/**
 * Copy `source` into a null-prototype dictionary, filtering forbidden
 * keys. Returns a fresh object — never mutates input.
 */
function safeMap(source: Readonly<Record<string, string>>): Record<string, string> {
  const out = Object.assign(Object.create(null), {}) as Record<string, string>;
  for (const [k, v] of Object.entries(source)) {
    if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Iterate `source` skipping forbidden prototype keys. Returns the pairs in
 * insertion order — the caller is responsible for any further filtering.
 */
function* safeEntries(
  source: Readonly<Record<string, string>>
): IterableIterator<[string, string]> {
  for (const [k, v] of Object.entries(source)) {
    if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
    yield [k, v];
  }
}

export class IngestExecutor {
  constructor(
    private readonly store: IEntityStoreService,
    private readonly ledger: ApprovalLedger
  ) {}

  async execute(plan: IngestPlan, ctx: ExecutionContext): Promise<ExecutionReport> {
    if (!plan.dryRun && !this.ledger.isApproved(plan.ingest_plan_id)) {
      throw new ApprovalRuleViolationError(
        `Cannot execute plan ${plan.ingest_plan_id}: not in 'approved' state`
      );
    }

    const now = ctx.now ?? (() => new Date());
    const proposal = plan.proposal;
    // Null-prototype map keyed by source header → canonical attribute key.
    // Hardened against prototype pollution via FORBIDDEN_PROTO_KEYS.
    const headerToAttr: Record<string, string> = safeMap(proposal.field_map);
    const headerIdx = new Map<string, number>();
    for (let i = 0; i < plan.headers.length; i += 1) {
      const h = plan.headers[i];
      if (h !== undefined) headerIdx.set(h, i);
    }

    const headerToAttrKeys = Array.from(safeEntries(headerToAttr));

    const dedupColumns = plan.schema.dedup_key_candidates.length > 0
      ? plan.schema.dedup_key_candidates
      // No candidate from sniff → use whichever mapped column maps to a
      // *_ref / id-like attribute, else fall back to the first mapped column.
      : headerToAttrKeys.slice(0, 1).map(([col]) => col);

    const batchReports: BatchReport[] = [];
    let totalRows = 0;
    let totalEntitiesCreated = 0;
    let totalAttrsWritten = 0;
    let totalAttrsSkipped = 0;
    let totalEntitiesProcessed = 0;
    const completedBatchIds: number[] = [];

    for (const batch of plan.batched_rows) {
      const inputs: CreateEntityInput[] = [];

      for (let i = 0; i < batch.rows.length; i += 1) {
        const row = batch.rows[i] ?? [];
        const absRowIdx = batch.row_idx_start + i;
        totalRows += 1;

        const dedupValues = dedupColumns.map((col) => {
          const idx = headerIdx.get(col);
          return idx === undefined ? '' : row[idx] ?? '';
        });
        const entityId = deriveEntityId(
          ctx.tenant_id,
          proposal.entity_type,
          dedupValues,
          absRowIdx,
          plan.file_hash
        );

        const attributes: Array<Omit<AttributeWrite, 'entity_type' | 'entity_id'>> = [];
        for (const [col, attrKey] of headerToAttrKeys) {
          const idx = headerIdx.get(col);
          if (idx === undefined) continue;
          const raw = row[idx];
          if (raw === undefined || raw === null) continue;
          const trimmed = String(raw).trim();
          if (trimmed === '') continue;

          const prov = buildProvenance({
            tenant_id: ctx.tenant_id,
            file_hash: plan.file_hash,
            conversation_id: plan.conversation_id,
            message_id: plan.message_id,
            row_idx: absRowIdx,
            llm_inferred_schema_version: `${plan.schema.schema_version}+${plan.plan_version}+${attrKey}`,
            ingest_plan_id: plan.ingest_plan_id,
            timestamp: now().toISOString(),
          });

          attributes.push({
            attribute_key: attrKey,
            value: trimmed,
            provenance: prov,
          });
        }

        inputs.push({
          entity_type: proposal.entity_type,
          entity_id: entityId,
          attributes,
        });
      }

      let entitiesCreated = 0;
      let attrsWritten = 0;
      let attrsSkipped = 0;

      try {
        if (plan.dryRun) {
          // Dry-run: report counts WITHOUT touching the store.
          for (const input of inputs) {
            const exists = await this.store.hasProvenanceHash(
              ctx.tenant_id,
              input.attributes[0]?.provenance.hash ?? ''
            );
            entitiesCreated += exists ? 0 : 1;
            attrsWritten += input.attributes.length;
          }
        } else {
          const results = await this.store.upsertEntitiesBatch(ctx.tenant_id, inputs);
          for (const r of results) {
            if (r.created) entitiesCreated += 1;
            attrsWritten += r.attributes_written;
            attrsSkipped += r.attributes_skipped;
          }
        }
      } catch (err) {
        // Partial-failure rollback contract: record what landed, mark the
        // plan as terminal, throw a typed wrapper. The underlying entity
        // store is responsible for per-entity atomicity (see
        // IEntityStoreService.upsertEntitiesBatch contract) — we ONLY
        // promise to stop the loop and record the boundary.
        if (!plan.dryRun) {
          const metadata: PartialFailureMetadata = Object.freeze({
            completed_batches: Object.freeze([...completedBatchIds]),
            failed_batch_idx: batch.batch_idx,
            failure_reason: err instanceof Error ? err.message : String(err),
          });
          try {
            this.ledger.markPartialFailure(
              plan.ingest_plan_id,
              ctx.executor_actor_id,
              metadata
            );
          } catch {
            // Ledger transition errors must not mask the original failure.
          }
          throw new PartialIngestFailureError(
            `Ingest plan ${plan.ingest_plan_id} failed at batch ${batch.batch_idx}: ${metadata.failure_reason}`,
            metadata,
            err
          );
        }
        throw err;
      }

      batchReports.push(
        Object.freeze({
          batch_idx: batch.batch_idx,
          entities_processed: inputs.length,
          entities_created: entitiesCreated,
          attributes_written: attrsWritten,
          attributes_skipped: attrsSkipped,
        })
      );

      totalEntitiesProcessed += inputs.length;
      totalEntitiesCreated += entitiesCreated;
      totalAttrsWritten += attrsWritten;
      totalAttrsSkipped += attrsSkipped;
      completedBatchIds.push(batch.batch_idx);
    }

    if (!plan.dryRun) {
      this.ledger.markExecuted(plan.ingest_plan_id, ctx.executor_actor_id);
    }

    return Object.freeze({
      ingest_plan_id: plan.ingest_plan_id,
      tenant_id: ctx.tenant_id,
      entity_type: proposal.entity_type,
      dry_run: plan.dryRun,
      total_rows: totalRows,
      entities_processed: totalEntitiesProcessed,
      entities_created: totalEntitiesCreated,
      attributes_written: totalAttrsWritten,
      attributes_skipped: totalAttrsSkipped,
      batch_reports: batchReports,
      conversation_id: plan.conversation_id,
      tab_link: `app://entities/${proposal.entity_type}`,
    });
  }
}
