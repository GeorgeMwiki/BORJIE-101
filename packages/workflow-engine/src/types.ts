/**
 * @borjie/workflow-engine — public types.
 *
 * The engine is the spine that converts an estate-manager's intent
 * (e.g. "I want to redraw this parcel polygon") into a fully audited
 * lifecycle:
 *
 *   open → in_progress → in_review → in_approval → committed
 *                                              ↘ rejected
 *
 * Every state transition is event-sourced; the runtime state of a
 * `WorkflowRun` is a projection of its append-only `WorkflowRunEvent`
 * log. The hashed audit chain (`workflow_audit_chain` table) gives
 * cryptographic ordering for the SOC 2 + GDPR audit trail.
 *
 * A `ProposedChange` is the captured-but-not-yet-applied delta. The
 * delta only hits production state when `applyProposedChange` runs
 * after `approve`. This is the maker-checker / four-eyes pattern.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Workflow definition
// ─────────────────────────────────────────────────────────────────────────

/**
 * The narrow domain the workflow operates on — the engine routes review
 * + approval based on this. Each kind has a corresponding policy in
 * `@borjie/ai-reviewer`.
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

export const WORKFLOW_RUN_STATES = [
  'open',
  'in_progress',
  'in_review',
  'in_approval',
  'committed',
  'rejected',
  'cancelled',
] as const;

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

export interface WorkflowDefinition {
  readonly id: string;
  readonly kind: WorkflowKind;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  /** The capability the worker MUST hold to start a run of this kind. */
  readonly requiredCapability: string;
  /** Whether AI review fires at submit-for-review. Default true. */
  readonly aiReviewRequired: boolean;
  /** Whether human approval is required after AI review. Default true. */
  readonly humanApprovalRequired: boolean;
  /** Auto-commit when both gates pass. Default true. */
  readonly autoCommitOnApproval: boolean;
  /**
   * If this kind triggers an elastic-config threshold (e.g. PO over a
   * tenant's TZS limit), the approval router uses this key to look up
   * the policy chain.
   */
  readonly elasticPolicyKey: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Workflow run
// ─────────────────────────────────────────────────────────────────────────

export interface WorkflowRun {
  readonly id: string;
  readonly tenantId: string;
  readonly definitionId: string;
  readonly kind: WorkflowKind;
  readonly scope: string;
  readonly scopeRef: string;
  readonly initiatedByUserId: string;
  readonly assignedReviewerUserId: string | null;
  readonly assignedApproverUserId: string | null;
  readonly state: WorkflowRunState;
  readonly input: Readonly<Record<string, unknown>>;
  readonly proposedChange: ProposedChange | null;
  readonly reviewDecision: ReviewDecision | null;
  readonly approvalDecision: ApprovalDecision | null;
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly committedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Proposed change — the diff captured before commit.
// ─────────────────────────────────────────────────────────────────────────

export interface ProposedChange {
  readonly id: string;
  readonly runId: string;
  /**
   * Logical entity the change targets (e.g. `parcel:parcel-123`). This
   * is what the committer uses to find the row to update.
   */
  readonly targetEntity: string;
  /**
   * Field-level deltas. Each entry describes one path being changed.
   * `before` is the value as the engine first observed it; `after` is
   * the proposed new value. The committer applies the `after` values.
   */
  readonly fieldDiffs: ReadonlyArray<FieldDiff>;
  /**
   * Optional whole-document JSON snapshot if the change is structural
   * (e.g. a new polygon GeoJSON FeatureCollection). When set, the
   * committer prefers this over `fieldDiffs`.
   */
  readonly snapshot: Readonly<Record<string, unknown>> | null;
  readonly capturedAt: Date;
}

export interface FieldDiff {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// Review + approval decisions
// ─────────────────────────────────────────────────────────────────────────

export const REVIEW_VERDICTS = [
  'approve',
  'request_changes',
  'reject',
] as const;

export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface ReviewDecision {
  readonly id: string;
  readonly runId: string;
  readonly verdict: ReviewVerdict;
  /** Whether this decision came from the AI reviewer or a human. */
  readonly source: 'ai' | 'human';
  readonly reviewerUserId: string | null;
  readonly rationale: string;
  /** Red-line list — concerns that must be addressed before approval. */
  readonly redLines: ReadonlyArray<string>;
  /** Coaching hints surfaced to the worker. */
  readonly coachingHints: ReadonlyArray<string>;
  readonly decidedAt: Date;
}

export const APPROVAL_VERDICTS = ['approve', 'reject'] as const;
export type ApprovalVerdict = (typeof APPROVAL_VERDICTS)[number];

export interface ApprovalDecision {
  readonly id: string;
  readonly runId: string;
  readonly verdict: ApprovalVerdict;
  readonly approverUserId: string;
  readonly approverRole: string;
  readonly rationale: string;
  readonly decidedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Append-only run event — every state transition logs one.
// ─────────────────────────────────────────────────────────────────────────

export type WorkflowRunEventKind =
  | 'started'
  | 'progressed'
  | 'change_proposed'
  | 'submitted_for_review'
  | 'reviewed'
  | 'submitted_for_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'committed';

export interface WorkflowRunEvent {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly kind: WorkflowRunEventKind;
  readonly actorUserId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Hashed audit chain entry — what we'd write to `workflow_audit_chain`.
// ─────────────────────────────────────────────────────────────────────────

export interface AuditChainEntry {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly previousHash: string;
  readonly currentHash: string;
  readonly recordedKind: WorkflowRunEventKind;
  readonly recordedPayload: Readonly<Record<string, unknown>>;
  readonly recordedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Zod schemas — for routes / queues.
// ─────────────────────────────────────────────────────────────────────────

export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export const WorkflowRunStateSchema = z.enum(WORKFLOW_RUN_STATES);
export const ReviewVerdictSchema = z.enum(REVIEW_VERDICTS);
export const ApprovalVerdictSchema = z.enum(APPROVAL_VERDICTS);

export const StartRunSchema = z.object({
  tenantId: z.string().min(1),
  definitionId: z.string().min(1),
  scope: z.string().min(1),
  scopeRef: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

export type StartRunRequest = z.infer<typeof StartRunSchema>;

export const ProposeChangeSchema = z.object({
  runId: z.string().min(1),
  targetEntity: z.string().min(1),
  fieldDiffs: z
    .array(
      z.object({
        path: z.string().min(1),
        before: z.unknown(),
        after: z.unknown(),
      }),
    )
    .min(1),
  snapshot: z.record(z.unknown()).optional(),
});

export type ProposeChangeRequest = z.infer<typeof ProposeChangeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Persistence ports — every adapter implements these.
// ─────────────────────────────────────────────────────────────────────────

export interface WorkflowRunRepository {
  insert(run: WorkflowRun): Promise<void>;
  update(run: WorkflowRun): Promise<void>;
  findById(id: string): Promise<WorkflowRun | null>;
  listForUser(tenantId: string, userId: string): Promise<ReadonlyArray<WorkflowRun>>;
  listReviewQueue(tenantId: string): Promise<ReadonlyArray<WorkflowRun>>;
  listApprovalQueue(tenantId: string): Promise<ReadonlyArray<WorkflowRun>>;
  list(tenantId: string): Promise<ReadonlyArray<WorkflowRun>>;
}

export interface WorkflowRunEventRepository {
  insert(event: WorkflowRunEvent): Promise<void>;
  listForRun(runId: string): Promise<ReadonlyArray<WorkflowRunEvent>>;
}

export interface AuditChainRepository {
  insert(entry: AuditChainEntry): Promise<void>;
  listForRun(runId: string): Promise<ReadonlyArray<AuditChainEntry>>;
  /** Returns the most recent hash for a tenant — used as previousHash. */
  latestHashForTenant(tenantId: string): Promise<string>;
}
