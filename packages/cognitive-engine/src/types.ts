/**
 * Cognitive Engine — type contracts.
 *
 * Source of truth: `Docs/DESIGN/COGNITIVE_ENGINE_SPEC.md` §4.
 *
 * Every type is `Readonly<...>` to preserve immutability (the existing
 * package style — see `@borjie/brain-llm-router/types.ts`). The
 * runtime never mutates a turn input/output once constructed.
 *
 * This module is import-only — zero side effects, no I/O. It is the
 * stable shape consumed by api-gateway routes and the kernel
 * composition root.
 *
 * @module @borjie/cognitive-engine/types
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Confidence + path enums (mirror SQL CHECK constraints — keep in sync)
// ===========================================================================

export const CONFIDENCE_LABELS = ['high', 'medium', 'low', 'refused'] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export const TURN_PATHS = [
  'asked_for_clarification',
  'asked_for_data',
  'composed_output',
  'refused_low_confidence',
] as const;
export type TurnPath = (typeof TURN_PATHS)[number];

export const SUFFICIENCY_STATES = [
  'sufficient',
  'needs_clarification',
  'needs_data',
  'needs_research',
] as const;
export type SufficiencyState = (typeof SUFFICIENCY_STATES)[number];

export const INGEST_KINDS = [
  'excel',
  'csv',
  'pdf',
  'image',
  'audio',
] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

export const DATA_REQUEST_KINDS = [
  ...INGEST_KINDS,
  'manual_form',
] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

// ---------------------------------------------------------------------------
// Span citation — reuses the shape from @borjie/research-tools without
// importing it (cross-package dep would couple this leaf to a heavier
// peer). The shape is structurally compatible.
// ===========================================================================

export const SpanCitationSchema = z.object({
  citationId: z.string().min(1),
  source: z.string().min(1),
  sourceId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  title: z.string().min(1),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  quotedFrom: z.string().max(1000).optional(),
});
export type SpanCitation = z.infer<typeof SpanCitationSchema>;

// ---------------------------------------------------------------------------
// Attachment + passive-capture + UI-state inputs
// ===========================================================================

export interface AttachmentRef {
  readonly attachment_id: string;
  readonly kind: IngestKind;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
}

export interface PassiveCaptureSnapshot {
  readonly captured_at_iso: string;
  /** Free-text summary of the last 60s of owner activity. */
  readonly recent_activity_digest?: string;
  /** UI-event count buckets (clicks, edits, scrolls) — debounced. */
  readonly recent_event_counts?: Readonly<Record<string, number>>;
}

export interface UiStateGraph {
  readonly captured_at_iso: string;
  readonly visible_tab_id?: string;
  readonly visible_route?: string;
  readonly field_focus_path?: string;
  readonly field_dirty_count?: number;
}

// ---------------------------------------------------------------------------
// Evidence inventory + plan steps
// ===========================================================================

export interface EvidenceItem {
  readonly kind: 'corpus' | 'data_join' | 'research_artifact' | 'ingest' | 'ui_state';
  readonly ref_id: string;
  /** 0..1 — relevance to the current intent. */
  readonly relevance: number;
  /** 0..1 — quality (e.g. source-quality score for research artifacts). */
  readonly quality: number;
  readonly summary?: string;
}

export interface PlanStep {
  readonly step_id: string;
  readonly action:
    | 'classify_intent'
    | 'gather_evidence'
    | 'ask_question'
    | 'request_data'
    | 'invoke_capability'
    | 'validate_output'
    | 'calibrate_confidence';
  readonly description: string;
  /** Expected cost in cents (approximate, used for budget pre-check). */
  readonly expected_cost_cents: number;
}

// ---------------------------------------------------------------------------
// Reasoning trace
// ===========================================================================

export interface ReasoningTrace {
  readonly intent_classification: {
    readonly intent: string;
    readonly confidence: number;
  };
  readonly evidence_inventory: ReadonlyArray<EvidenceItem>;
  readonly sufficiency: SufficiencyState;
  readonly plan_steps: ReadonlyArray<PlanStep>;
  readonly expected_confidence: 'high' | 'medium' | 'low';
  readonly cost_estimate_usd_cents: number;
}

// ---------------------------------------------------------------------------
// Interactive scoping outputs
// ===========================================================================

export interface ClarifyingQuestion {
  readonly question: string;
  readonly possible_answers?: ReadonlyArray<string>;
  readonly why_needed: string;
}

export interface DataRequest {
  readonly kind: DataRequestKind;
  readonly description: string;
  readonly required: boolean;
  readonly why_needed: string;
}

// ---------------------------------------------------------------------------
// Adaptive ingest result
// ===========================================================================

export interface ColumnSpec {
  readonly name: string;
  readonly inferred_type:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'currency'
    | 'unknown';
  readonly nullable: boolean;
  readonly sample_values?: ReadonlyArray<string>;
  /** True when the column matches a PII pattern (email / phone / id). */
  readonly is_pii: boolean;
}

export interface PiiRedaction {
  readonly field_path: string;
  readonly pattern_kind: string;
  readonly count: number;
}

export interface DataJoinRef {
  readonly join_id: string;
  readonly kind: 'tabular' | 'document' | 'image' | 'audio';
  readonly storage_key: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly retention_until_iso: string;
}

export interface AdaptiveIngestResult {
  readonly attachment_id: string;
  readonly kind: IngestKind;
  readonly storage_key: string;
  readonly parsed_columns: ReadonlyArray<ColumnSpec>;
  readonly parsed_rows_count: number;
  readonly pii_redactions: ReadonlyArray<PiiRedaction>;
  readonly inferred_data_join_ref: DataJoinRef;
  readonly relevance_to_intent: number;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Cognitive turn input + output
// ===========================================================================

export interface CognitiveTurnInput {
  readonly turn_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly utterance: string;
  readonly voice_transcript?: string;
  readonly attachments?: ReadonlyArray<AttachmentRef>;
  readonly passive_capture?: PassiveCaptureSnapshot;
  readonly ui_state_snapshot?: UiStateGraph;
  /** Owner has been in the workspace for fewer than 14 days. */
  readonly is_new_user: boolean;
  readonly active_authority_tier_max: 0 | 1 | 2;
}

export interface UncertaintyNote {
  readonly kind: 'low_corroboration' | 'stale_evidence' | 'corpus_contradiction' | 'tenant_gap';
  readonly note: string;
}

export interface ArtifactRef {
  readonly kind:
    | 'research'
    | 'tab'
    | 'doc'
    | 'media'
    | 'campaign'
    | 'mutation';
  readonly id: string;
}

export interface CognitiveTurnOutput {
  readonly turn_id: string;
  readonly reasoning_trace: ReasoningTrace;
  readonly path: TurnPath;
  readonly questions?: ReadonlyArray<ClarifyingQuestion>;
  readonly requested_data?: ReadonlyArray<DataRequest>;
  readonly artifact_ref?: ArtifactRef;
  readonly confidence: ConfidenceLabel;
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly uncertainty_notes?: ReadonlyArray<UncertaintyNote>;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Zod schemas — used by api-gateway routes for input validation
// ===========================================================================

export const ClarifyingQuestionSchema = z.object({
  question: z.string().min(1).max(400),
  possible_answers: z.array(z.string()).optional(),
  why_needed: z.string().min(1).max(400),
});

export const DataRequestSchema = z.object({
  kind: z.enum(DATA_REQUEST_KINDS),
  description: z.string().min(1).max(400),
  required: z.boolean(),
  why_needed: z.string().min(1).max(400),
});

export const CognitiveTurnInputSchema = z.object({
  turn_id: z.string().min(1),
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  utterance: z.string().min(1),
  voice_transcript: z.string().optional(),
  is_new_user: z.boolean(),
  active_authority_tier_max: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export type CognitiveTurnInputZod = z.infer<typeof CognitiveTurnInputSchema>;

// ---------------------------------------------------------------------------
// Engine ports (DI surface — concrete impls live in callers / runtime)
// ===========================================================================

/** LLM port — narrowed slice of `@borjie/brain-llm-router::brainCall`. */
export interface CognitiveLlmPort {
  readonly classify: (input: {
    readonly system: string;
    readonly user: string;
    readonly thinkingBudgetTokens?: number;
  }) => Promise<{
    readonly text: string;
    readonly thinkingTrace?: string;
    readonly costUsdCents: number;
  }>;
}

/** Storage port for ingested attachments. */
export interface IngestStoragePort {
  readonly put: (input: {
    readonly tenant_id: string;
    readonly session_id: string;
    readonly attachment_id: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }) => Promise<{ readonly storage_key: string }>;
}

/** Excel/CSV parsing port — caller wires the actual SheetJS / fast-csv adapter. */
export interface TabularParserPort {
  readonly parseExcel: (bytes: Uint8Array) => Promise<{
    readonly columns: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  }>;
  readonly parseCsv: (bytes: Uint8Array) => Promise<{
    readonly columns: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  }>;
}

/** PDF + image + audio parser ports — caller wires document-analysis / vision LLM / Whisper. */
export interface DocumentParserPort {
  readonly parsePdf: (bytes: Uint8Array) => Promise<{ readonly text: string }>;
  readonly parseImage: (bytes: Uint8Array) => Promise<{ readonly caption: string; readonly ocrText: string }>;
  readonly parseAudio: (bytes: Uint8Array) => Promise<{ readonly transcript: string }>;
}

/** Clock port — testable time. */
export interface ClockPort {
  readonly now: () => Date;
}

/** Audit-sink port — observability hook (loosely typed; callers wire OCSF emitter). */
export interface AuditSinkPort {
  readonly emit: (event: {
    readonly kind: string;
    readonly turn_id: string;
    readonly tenant_id: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => void;
}
