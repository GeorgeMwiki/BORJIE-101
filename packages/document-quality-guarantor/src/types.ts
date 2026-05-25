/**
 * @borjie/document-quality-guarantor — public types.
 *
 * One package, eight subsystems, one promise: never silently lose or
 * fabricate a document. Every type here is the contract a subsystem
 * leans on. Internal helpers may type more loosely; this file is the
 * line crossed by callers.
 *
 *   intake/          → extract data FROM documents (OCR portfolio)
 *   output/          → render data TO documents (engine portfolio)
 *   quality-gates/   → blocking validators
 *   retry-queue/     → idempotent retry + dead-letter
 *   escalation/      → human-in-the-loop hand-off to workflow-engine
 *   format-coverage/ → mime → handler registry
 *   audit/           → per-step transformation chain (replayable)
 *
 * Research basis: Docs/DOCUMENT_QUALITY_RESEARCH_2026-05-24.md
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Identifiers — opaque branded strings for clarity in signatures.
// ─────────────────────────────────────────────────────────────────────

export type EngineId = string;
export type IntakeId = string;
export type OutputId = string;
export type EscalationTicketId = string;
export type JobId = string;
export type IdempotencyKey = string;
export type TenantId = string;
export type AuditEntryId = string;

// ─────────────────────────────────────────────────────────────────────
// Format registry — 17 formats the spec requires on day one.
// Each format declares whether it can be ingested, rendered, or both.
// ─────────────────────────────────────────────────────────────────────

export const SUPPORTED_FORMATS = [
  'pdf', // PDF (including PDF/A-3 and PDF/UA flavors)
  'docx', // Word
  'xlsx', // Excel
  'pptx', // PowerPoint
  'odt', // OpenDocument text
  'ods', // OpenDocument spreadsheet
  'odp', // OpenDocument presentation
  'rtf', // Rich Text Format
  'html', // HTML
  'md', // Markdown
  'txt', // Plain text
  'csv', // Comma-separated values
  'json', // JSON
  'eml', // RFC-822 email
  'msg', // Outlook .msg
  'epub', // EPUB e-book
  'image', // jpg/png/heic/webp (intake-only OCR target)
] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export function isSupportedFormat(value: unknown): value is SupportedFormat {
  return typeof value === 'string' && (SUPPORTED_FORMATS as ReadonlyArray<string>).includes(value);
}

export type FormatDirection = 'intake' | 'output' | 'both';

export interface FormatHandler {
  readonly format: SupportedFormat;
  readonly direction: FormatDirection;
  /** Mime types this handler claims (used by mime → handler routing). */
  readonly mimeTypes: ReadonlyArray<string>;
  /** Preferred engine ordering for this format. */
  readonly engineChain: ReadonlyArray<EngineId>;
}

// ─────────────────────────────────────────────────────────────────────
// Intake (OCR) — port shape compatible with @borjie/document-ai/ocr.
// We type it locally so this package does NOT hard-require document-ai;
// the orchestrator accepts any value satisfying `IntakeEngine`.
// ─────────────────────────────────────────────────────────────────────

export interface DocumentBytes {
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** Optional caller-supplied id for tracing. */
  readonly id?: string;
}

export interface IntakeHints {
  /** ISO-639-1 language hints. */
  readonly lang?: ReadonlyArray<string>;
  /** Optional layout complexity hint to help the router. */
  readonly layoutComplexity?: 'simple' | 'moderate' | 'complex';
  /** Document kind, used for routing + audit. */
  readonly kind?: string;
}

export interface ExtractedDocument {
  readonly intakeId: IntakeId;
  /** SHA-256 of the source bytes (content provenance). */
  readonly sourceSha256: string;
  /** Engine that produced the accepted result. */
  readonly producedBy: EngineId;
  /** Per-page text in reading order; pages indexed from 1. */
  readonly pages: ReadonlyArray<{
    readonly pageNumber: number;
    readonly text: string;
    readonly confidence: number;
  }>;
  /** Whole-document confidence in [0,1]. */
  readonly confidence: number;
  /** Detected language code. */
  readonly language: string;
  /** Convenience: joined text across pages, separated by form feed. */
  readonly text: string;
  /** ISO timestamp when extraction finished. */
  readonly producedAtIso: string;
}

export interface IntakeEngine {
  readonly id: EngineId;
  /** Languages this engine claims to support; '*' means any. */
  readonly supportedLanguages: ReadonlyArray<string>;
  /**
   * Extract a document. Implementations should NOT throw on low
   * confidence — they should return the result so the orchestrator
   * can decide whether to fall over to the next engine.
   */
  extract(input: DocumentBytes, hints?: IntakeHints): Promise<ExtractedDocument>;
}

export interface IntakeRequest {
  readonly doc: DocumentBytes;
  readonly hints?: IntakeHints;
  /** Idempotency key — same key returns the same result. */
  readonly idempotencyKey?: IdempotencyKey;
  /** Tenant the doc belongs to (for audit + escalation routing). */
  readonly tenantId: TenantId;
}

// ─────────────────────────────────────────────────────────────────────
// Output (render) — engine portfolio that turns data → bytes.
// ─────────────────────────────────────────────────────────────────────

export interface RenderTemplate {
  /** Stable id (so audit can reference the exact template version). */
  readonly id: string;
  /** Template body — engine-specific (Carbone DOCX, Typst source, …). */
  readonly body: string | Uint8Array;
  /** Template engine the body is written for. */
  readonly engineHint?: EngineId;
}

export interface RenderedDocument {
  readonly outputId: OutputId;
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly format: SupportedFormat;
  readonly sha256: string;
  readonly producedBy: EngineId;
  readonly producedAtIso: string;
}

export interface OutputEngine {
  readonly id: EngineId;
  readonly supportedFormats: ReadonlyArray<SupportedFormat>;
  render(
    template: RenderTemplate,
    data: Readonly<Record<string, unknown>>,
    format: SupportedFormat,
  ): Promise<RenderedDocument>;
}

export interface OutputRequest {
  readonly template: RenderTemplate;
  readonly data: Readonly<Record<string, unknown>>;
  readonly format: SupportedFormat;
  readonly tenantId: TenantId;
  readonly idempotencyKey?: IdempotencyKey;
  /** Per-format timeout in ms; default 15 000. */
  readonly timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Quality gates — composable, blocking validators.
// ─────────────────────────────────────────────────────────────────────

export interface QualityScore {
  /** Numeric score in [0,1]; 1 is perfect. */
  readonly value: number;
  /** Threshold the gate uses; informational. */
  readonly threshold: number;
  /** Whether the score met the threshold. */
  readonly passed: boolean;
}

export interface QualityReport {
  readonly gateId: string;
  readonly score: QualityScore;
  /** Human-readable reasons (especially for failures). */
  readonly reasons: ReadonlyArray<string>;
  /** Optional structured details a UI can render. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * A QualityGate is a pure function over either an extracted document
 * (intake-side gate) or a rendered document (output-side gate). The
 * gate decides whether the artifact is allowed to leave the system.
 */
export interface QualityGate<TInput> {
  readonly id: string;
  evaluate(input: TInput): Promise<QualityReport>;
}

// ─────────────────────────────────────────────────────────────────────
// Retry queue — idempotent jobs with exponential backoff + DLQ.
// ─────────────────────────────────────────────────────────────────────

export const JOB_KINDS = [
  'intake_extract',
  'output_render',
  'quality_gate',
  'escalation_dispatch',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface RetryPolicy {
  /** Maximum attempts before DLQ. Default 4. */
  readonly maxAttempts: number;
  /** Base delay in ms. Default 1000. */
  readonly baseDelayMs: number;
  /** Multiplier per attempt. Default 5. */
  readonly multiplier: number;
  /** Max jitter ratio (0..1). Default 0.2. */
  readonly jitterRatio: number;
}

export interface Job {
  readonly id: JobId;
  readonly kind: JobKind;
  readonly idempotencyKey: IdempotencyKey;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly tenantId: TenantId;
  readonly attempts: number;
  readonly nextRunAtMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly createdAtMs: number;
}

export type JobOutcome =
  | { readonly kind: 'success'; readonly result: Readonly<Record<string, unknown>> }
  | { readonly kind: 'failure'; readonly error: string; readonly retryable: boolean };

// ─────────────────────────────────────────────────────────────────────
// Escalation — human-in-the-loop hand-off.
// ─────────────────────────────────────────────────────────────────────

export const ESCALATION_CAUSES = [
  'extraction_failed_n_times',
  'quality_gate_blocked',
  'format_unsupported',
  'data_inconsistent',
  'user_request',
] as const;
export type EscalationCause = (typeof ESCALATION_CAUSES)[number];

export const ESCALATION_URGENCIES = ['low', 'normal', 'high', 'critical'] as const;
export type EscalationUrgency = (typeof ESCALATION_URGENCIES)[number];

export interface EscalationContextRef {
  /** Logical reference, e.g. `intake:abc123` or `output:xyz789`. */
  readonly ref: string;
  /** Optional snapshot to make the ticket actionable without lookups. */
  readonly snapshot?: Readonly<Record<string, unknown>>;
}

export interface EscalationTicket {
  readonly ticketId: EscalationTicketId;
  readonly tenantId: TenantId;
  readonly cause: EscalationCause;
  readonly urgency: EscalationUrgency;
  readonly contextRefs: ReadonlyArray<EscalationContextRef>;
  readonly createdAtIso: string;
  /** When wired, the workflow-engine run created in `in_review` state. */
  readonly workflowRunId: string | null;
  /** Engineer-readable reason summary. */
  readonly summary: string;
}

// ─────────────────────────────────────────────────────────────────────
// Fallback policy — drives engine ordering.
// ─────────────────────────────────────────────────────────────────────

export interface FallbackPolicy {
  /**
   * Minimum acceptable confidence for the primary engine. If the
   * primary engine's confidence < threshold, fall over.
   */
  readonly minPrimaryConfidence: number;
  /**
   * Total time budget across all engine attempts (ms). The orchestrator
   * aborts and escalates once exceeded. Default 60 000.
   */
  readonly totalBudgetMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Roundtrip check — render output, OCR it back, diff against source.
// ─────────────────────────────────────────────────────────────────────

export interface RoundtripCheck {
  /** The text the output was supposed to convey. */
  readonly expectedText: string;
  /** What OCR pulled back from the rendered output. */
  readonly extractedText: string;
  /** Cosine / token similarity in [0,1]. */
  readonly similarity: number;
  /** Threshold the check used. */
  readonly threshold: number;
  readonly passed: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Engine result — what an engine returns to the orchestrator at the
// per-attempt level. Distinct from the public RenderedDocument so the
// orchestrator can record failed attempts without exposing them.
// ─────────────────────────────────────────────────────────────────────

export interface EngineResult<T> {
  readonly engineId: EngineId;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly confidence?: number;
  readonly latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Zod schemas — exported for callers that need runtime validation.
// ─────────────────────────────────────────────────────────────────────

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  baseDelayMs: z.number().int().min(0),
  multiplier: z.number().min(1),
  jitterRatio: z.number().min(0).max(1),
});

export const SupportedFormatSchema = z.enum(SUPPORTED_FORMATS);

export const EscalationCauseSchema = z.enum(ESCALATION_CAUSES);
export const EscalationUrgencySchema = z.enum(ESCALATION_URGENCIES);

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 1000,
  multiplier: 5,
  jitterRatio: 0.2,
});

export const DEFAULT_FALLBACK_POLICY: FallbackPolicy = Object.freeze({
  minPrimaryConfidence: 0.85,
  totalBudgetMs: 60_000,
});
