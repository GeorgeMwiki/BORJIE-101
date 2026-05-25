/**
 * Public types for `@borjie/ai-reviewer`.
 *
 * Pure type module — no runtime IO. Every nested shape is `readonly`
 * so callers cannot mutate decisions, coaching tips, or audit records
 * after they leave a reviewer call.
 *
 * The reviewer never writes to a database. It returns a decision; the
 * caller is responsible for persisting state and emitting downstream
 * events. Audit IS fired by the orchestrator — one entry per `review()`
 * call — via an injected port.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Workflow kinds
// ─────────────────────────────────────────────────────────────────────

/**
 * The 10 reviewable workflow kinds. New kinds require a new policy
 * file under `policies/` AND a registry entry in `policies/index.ts`.
 * Keep this list in lockstep with the policy registry — the reviewer
 * uses exhaustive switching to guarantee no kind is silently dropped.
 */
export const WORKFLOW_KINDS = [
  'parcel_edit',
  'polygon_draw',
  'metadata_update',
  'photo_add',
  'inspection',
  'new_lease',
  'maintenance_completion',
  'document_upload',
  'po_approval',
  'requisition_submission',
] as const;

export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────
// Request envelope
// ─────────────────────────────────────────────────────────────────────

/**
 * Universal context every workflow review receives. Tenant + actor
 * scoping is mandatory so the audit row is non-repudiable.
 */
export interface ReviewContext {
  readonly tenantId: string;
  readonly actorUserId: string;
  /** Role used by policies that gate on actor authority. */
  readonly actorRole: string;
  /** Locale/jurisdiction hint — never hard-code in policy logic. */
  readonly jurisdiction?: string;
  /** ISO 8601 timestamp of when the request was constructed. */
  readonly submittedAt: string;
  /**
   * Free-form correlation id for tracing across services. Echoed back
   * on the decision and into the audit row.
   */
  readonly correlationId?: string;
}

/**
 * Per-kind payload. Each policy narrows the `payload` via the
 * discriminated `kind` field and validates shape with its own zod
 * schema. Keep this open-ended so adding a new kind does not force
 * a type-wide refactor.
 */
export interface ReviewRequest {
  readonly kind: WorkflowKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly context: ReviewContext;
}

// ─────────────────────────────────────────────────────────────────────
// Decision shape
// ─────────────────────────────────────────────────────────────────────

export const VERDICTS = [
  'approve',
  'reject_with_changes',
  'reject_final',
  'escalate',
] as const;

export type Verdict = (typeof VERDICTS)[number];

export const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * A single reason backing the verdict. Reasons compose: a verdict of
 * `reject_with_changes` MUST carry at least one `error` reason.
 */
export interface DecisionReason {
  readonly code: string;
  readonly message: string;
  readonly severity: Severity;
  /** Pointer into the payload, e.g. `'polygon.vertices'`. */
  readonly field?: string;
}

/**
 * Concrete remediation the user can apply. Optional pre-baked patch is
 * payload-shaped so a UI can offer a one-click fix.
 */
export interface SuggestedFix {
  readonly description: string;
  /** Optional partial payload representing the proposed change. */
  readonly patch?: Readonly<Record<string, unknown>>;
}

export interface ReviewDecision {
  readonly verdict: Verdict;
  /** 0..1 — calibrated confidence. 1 = formally provable. */
  readonly confidence: number;
  readonly reasons: ReadonlyArray<DecisionReason>;
  readonly suggestedFixes: ReadonlyArray<SuggestedFix>;
  /**
   * Echoed from the request. Lets the caller correlate without holding
   * the original request object.
   */
  readonly correlationId?: string;
  /** ISO 8601 timestamp of when the decision was produced. */
  readonly decidedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Coaching shape
// ─────────────────────────────────────────────────────────────────────

export type CoachingTone = 'hint' | 'caution' | 'block';

/**
 * Sent to the UI BEFORE submission. `block` tones MUST be resolved
 * before the user can submit; `caution` should warn; `hint` is purely
 * advisory.
 */
export interface CoachingMessage {
  readonly id: string;
  readonly tone: CoachingTone;
  readonly title: string;
  readonly body: string;
  /** Field pointer if the hint targets a specific input. */
  readonly field?: string;
  /** Optional auto-fix the UI can offer one-click. */
  readonly suggestedFix?: SuggestedFix;
}

/**
 * Partially-completed work the user has not yet submitted. Same shape
 * as `ReviewRequest` but flagged so policies can be lenient on missing
 * fields they would otherwise red-line.
 */
export interface WorkInProgress {
  readonly kind: WorkflowKind;
  readonly partialPayload: Readonly<Record<string, unknown>>;
  readonly context: ReviewContext;
}

// ─────────────────────────────────────────────────────────────────────
// Validation issue (shared by preChecks + redLines)
// ─────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: Severity;
  readonly field?: string;
  /** Optional fix the policy already knows about. */
  readonly suggestedFix?: SuggestedFix;
}

// ─────────────────────────────────────────────────────────────────────
// Policy contract
// ─────────────────────────────────────────────────────────────────────

/**
 * A policy is the unit of per-kind expertise. It is PURE:
 *   - `preChecks` returns formal validation issues (e.g. "polygon must
 *     have ≥ 3 vertices"). MUST be deterministic and synchronous.
 *   - `redLines` returns hard-stop issues that mean `reject_final` and
 *     should never reach the brain (e.g. "polygon area exceeds 100x
 *     property boundary"). Also pure.
 *   - `brainPrompt` returns the prompt body the brain port receives.
 *     Pure template; no IO.
 *
 * Policies never call the brain themselves; the orchestrator does.
 */
export interface PolicyRule<TPayload = Readonly<Record<string, unknown>>> {
  readonly kind: WorkflowKind;
  preChecks(request: PolicyRequest<TPayload>): ReadonlyArray<ValidationIssue>;
  redLines(request: PolicyRequest<TPayload>): ReadonlyArray<ValidationIssue>;
  brainPrompt(request: PolicyRequest<TPayload>): string;
}

/**
 * Narrowed request seen by a typed policy. The orchestrator validates
 * the payload against the policy's zod schema before invoking the rule
 * methods so policies can assume shape correctness.
 */
export interface PolicyRequest<TPayload> {
  readonly kind: WorkflowKind;
  readonly payload: TPayload;
  readonly context: ReviewContext;
}

// ─────────────────────────────────────────────────────────────────────
// Brain port (the only IO surface)
// ─────────────────────────────────────────────────────────────────────

export interface BrainAskArgs {
  readonly systemPrompt: string;
  readonly question: string;
  /** Optional structured grounding the brain can cite. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * What the brain is asked to produce. The orchestrator parses this
 * structured output via the {@link brainReviewSchema} below; any
 * deviation degrades to `escalate` rather than crashing.
 */
export interface BrainStructuredReview {
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly reasons: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly severity: Severity;
    readonly field?: string;
  }>;
  readonly suggestedFixes: ReadonlyArray<{
    readonly description: string;
    readonly patch?: Readonly<Record<string, unknown>>;
  }>;
}

/**
 * The single IO surface the reviewer depends on. Implementations may
 * back this with `@borjie/ai-copilot`'s multi-LLM synthesizer, a
 * single-provider client, or — in tests — a deterministic stub.
 */
export interface BrainPort {
  respond(args: BrainAskArgs): Promise<BrainStructuredReview>;
}

/**
 * Coaching uses the same brain port but expects a different output
 * shape (a list of hints rather than a verdict). The orchestrator
 * derives the prompts; the brain implementation just returns text.
 */
export interface BrainCoachArgs extends BrainAskArgs {
  readonly maxHints?: number;
}

export interface BrainCoachPort {
  coach(args: BrainCoachArgs): Promise<ReadonlyArray<CoachingMessage>>;
}

// ─────────────────────────────────────────────────────────────────────
// Audit port + user-context port
// ─────────────────────────────────────────────────────────────────────

export interface ReviewAuditRecord {
  readonly kind: WorkflowKind;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly reasonCount: number;
  readonly preCheckIssueCount: number;
  readonly redLineIssueCount: number;
  readonly brainInvoked: boolean;
  readonly correlationId?: string;
  /** ISO 8601 — when the audit row was emitted. */
  readonly timestamp: string;
}

export interface ReviewAuditPort {
  recordReview(record: ReviewAuditRecord): Promise<void>;
}

/**
 * Optional dossier surface used by coaching to personalise hints.
 * Kept generic to avoid a hard coupling to `@borjie/user-context-store`.
 */
export interface UserContextPort {
  fetchDossier(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly intent: string;
  }): Promise<Readonly<{ snippets: ReadonlyArray<string> }>>;
}

// ─────────────────────────────────────────────────────────────────────
// Zod schemas — runtime validation for brain output
// ─────────────────────────────────────────────────────────────────────

export const verdictSchema = z.enum(VERDICTS);
export const severitySchema = z.enum(SEVERITIES);

export const decisionReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: severitySchema,
  field: z.string().optional(),
});

export const suggestedFixSchema = z.object({
  description: z.string().min(1),
  patch: z.record(z.unknown()).optional(),
});

export const brainReviewSchema = z.object({
  verdict: verdictSchema,
  confidence: z.number().min(0).max(1),
  reasons: z.array(decisionReasonSchema).default([]),
  suggestedFixes: z.array(suggestedFixSchema).default([]),
});

export const coachingMessageSchema = z.object({
  id: z.string().min(1),
  tone: z.enum(['hint', 'caution', 'block']),
  title: z.string().min(1),
  body: z.string().min(1),
  field: z.string().optional(),
  suggestedFix: suggestedFixSchema.optional(),
});
