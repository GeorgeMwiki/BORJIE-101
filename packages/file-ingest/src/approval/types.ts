import type { EntityMappingProposal } from '../proposal/types.js';
import type { InferredSchema, ParsedTable } from '../schema-sniff/types.js';

/**
 * A batch of source rows. Default size = 100; chunking keeps the executor
 * bounded in memory and lets the chat UI report progress at granular
 * intervals.
 */
export interface RowBatch {
  /** Zero-based batch index. */
  readonly batch_idx: number;
  /** Row indices included in this batch (absolute, into the original table). */
  readonly row_idx_start: number;
  readonly row_idx_end: number; // exclusive
  /** Raw rows, in order. */
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * The IngestPlan is the unit of approval. Owner sees one of these in chat,
 * clicks "Approve" → executor commits. Plan is immutable: any change
 * (e.g. mapping tweak) produces a NEW IngestPlan with a new id.
 */
export interface IngestPlan {
  /** Stable identifier (uuid-v4 in production; deterministic in tests). */
  readonly ingest_plan_id: string;
  /** sha256 of the original file bytes. */
  readonly file_hash: string;
  /** Conversation context. */
  readonly conversation_id: string;
  readonly message_id: string;
  /** Source-format-tagged schema. */
  readonly schema: InferredSchema;
  /** Approved proposal. */
  readonly proposal: EntityMappingProposal;
  /** Pre-batched rows (size determined at plan-build time). */
  readonly batched_rows: ReadonlyArray<RowBatch>;
  /** Headers, repeated here so executor doesn't need the original ParsedTable. */
  readonly headers: ReadonlyArray<string>;
  /** Dry-run: when true, executor reports what WOULD happen but writes nothing. */
  readonly dryRun: boolean;
  /** Build timestamp (ISO-8601). */
  readonly built_at: string;
  /** Bump whenever IngestPlan shape changes — feeds provenance.llm_inferred_schema_version. */
  readonly plan_version: string;
}

export interface BuildPlanInput {
  readonly ingest_plan_id: string;
  readonly file_hash: string;
  readonly conversation_id: string;
  readonly message_id: string;
  readonly table: ParsedTable;
  readonly schema: InferredSchema;
  readonly proposal: EntityMappingProposal;
  readonly dryRun?: boolean;
  /** Batch size; defaults to 100 per spec. */
  readonly batchSize?: number;
}

/**
 * Distinct approval states the owner can drive a plan through. The 4-eye
 * rule says the same identity that BUILDS the plan cannot APPROVE it nor
 * EXECUTE it — see ApprovalLedger.markExecuted.
 *
 * `partial_failure` is a terminal state recorded when an executor throws
 * mid-batch. The plan cannot be retried; an operator must build a NEW
 * plan id covering only the rows that did NOT land (see
 * {@link PartialFailureMetadata.completed_batches}).
 */
export type ApprovalState =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'partial_failure';

/**
 * Recorded on the ledger entry alongside a `partial_failure` transition.
 * Captures enough context for an operator to manually replay the unlanded
 * rows.
 */
export interface PartialFailureMetadata {
  /** Batch indices that DID land before the executor threw. */
  readonly completed_batches: ReadonlyArray<number>;
  /** Index of the batch on which the executor threw. */
  readonly failed_batch_idx: number;
  /** Stringified Error.message from the failing batch. */
  readonly failure_reason: string;
}

export interface ApprovalRecord {
  readonly ingest_plan_id: string;
  readonly state: ApprovalState;
  /** The actor who triggered the state transition. */
  readonly actor_id: string;
  /** Free-form comment (e.g. "rejected, employee_ref is wrong column"). */
  readonly comment?: string;
  readonly at: string;
}
