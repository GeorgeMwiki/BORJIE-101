/**
 * Assignment registry — public types.
 *
 * Scope grammar:
 *   - `scope` is a coarse category — `parcel | area | property | district |
 *     tender | po | requisition | maintenance_job | inspection | document |
 *     lease | unit | building`. Tenants may extend with custom scopes via
 *     elastic-config but everything in core ships with the canonical set.
 *
 *   - `scopeRefs` is the concrete instance — the actual entity IDs the
 *     assignment grants access to. An estate manager assigned to "parcel"
 *     scope will have scopeRefs of `["parcel-trc-001", "parcel-trc-007"]`.
 *
 *   - `capabilities` is the action set the assignment authorises. Default
 *     deny: an assignment that grants `view` does NOT grant `polygon_edit`.
 *     Tenants extend via elastic-config; the core list below is the floor
 *     every policy can rely on.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Scope kinds — the canonical set every workflow definition expects.
// Tenants may extend via elastic-config but the engine ships with these.
// ─────────────────────────────────────────────────────────────────────────

export const SCOPE_KINDS = [
  'parcel',
  'area',
  'property',
  'district',
  'region',
  'station',
  'tender',
  'po',
  'requisition',
  'maintenance_job',
  'inspection',
  'document',
  'lease',
  'unit',
  'building',
] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Capability vocabulary — the core action set.
// Capability is the verb the assignment authorises against the scopeRef.
// Workflow stages map their action to one capability; the scope guard
// checks that capability is in the assignment's list.
// ─────────────────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  // Read
  'view',
  // Soft annotations — no live-data change
  'annotate',
  'comment',
  // Edits — captured as a ProposedChange + go through review
  'polygon_edit',
  'metadata_edit',
  'photo_add',
  'video_add',
  'document_upload',
  'inspection_complete',
  'maintenance_complete',
  'lease_draft',
  // Submission to AI review
  'submit_for_review',
  // Approval verbs (held by approvers, not the worker)
  'approve_change',
  'reject_change',
  // Administrative
  'assign_others',
  'revoke_assignment',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// ─────────────────────────────────────────────────────────────────────────
// Assignment status
// ─────────────────────────────────────────────────────────────────────────

export const ASSIGNMENT_STATUSES = [
  'active',
  'paused',
  'revoked',
  'expired',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────
// Core Assignment
// ─────────────────────────────────────────────────────────────────────────

/**
 * An Assignment is a record granting a SPECIFIC user the SPECIFIED
 * capabilities against the SPECIFIED scopeRefs of the given scope kind,
 * within a tenant, for the window between startsAt and (optional) endsAt.
 *
 * Default-deny: no assignment → no access. Even view requires an
 * assignment with the `view` capability. Tenants opt-in to coarser
 * policies via elastic-config (e.g. tenant-wide read).
 */
export interface Assignment {
  readonly id: string;
  readonly tenantId: string;
  readonly assigneeUserId: string;
  readonly scope: ScopeKind;
  /**
   * Concrete entity IDs this assignment grants access to. Empty array
   * means "scope-wide" (e.g. district admin sees all districts) and is
   * only honoured if `capabilities` includes admin verbs.
   */
  readonly scopeRefs: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly assignedByUserId: string;
  readonly status: AssignmentStatus;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Assignment request — pre-assignment intent.
// A manager requests their team get assigned; a workflow may auto-approve
// or route for human approval depending on tenant policy.
// ─────────────────────────────────────────────────────────────────────────

export interface AssignmentRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly requesterUserId: string;
  readonly intendedAssigneeUserId: string;
  readonly scope: ScopeKind;
  readonly scopeRefs: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly reason: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly resolvedByUserId: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Assignment event — append-only history.
// Every lifecycle change writes one event. This is what feeds the
// "who-changed-what-when" audit, plus the time-travel queries.
// ─────────────────────────────────────────────────────────────────────────

export type AssignmentEventKind =
  | 'created'
  | 'capability_added'
  | 'capability_removed'
  | 'scope_ref_added'
  | 'scope_ref_removed'
  | 'paused'
  | 'resumed'
  | 'revoked'
  | 'expired'
  | 'extended';

export interface AssignmentEvent {
  readonly id: string;
  readonly assignmentId: string;
  readonly tenantId: string;
  readonly kind: AssignmentEventKind;
  readonly actorUserId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// Scope guard decision
// ─────────────────────────────────────────────────────────────────────────

export type Decision = 'allow' | 'deny' | 'requires_review';

export interface ScopeCheckInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly action: Capability;
  readonly scope: ScopeKind;
  readonly scopeRef: string;
  /**
   * When the action is on a CHILD of a scope (e.g. a parcel within a
   * district), provide the parent chain so cascade rules can fire.
   * Order is leaf → root: `['district-001']` for a parcel whose parent
   * district is `district-001`. Omit to disable cascade evaluation.
   */
  readonly parentChain?: ReadonlyArray<{
    readonly scope: ScopeKind;
    readonly scopeRef: string;
  }>;
}

export interface ScopeCheckResult {
  readonly decision: Decision;
  readonly reason: string;
  readonly matchedAssignmentId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Cascade rule — configurable per-tenant.
// "Does an assignment at a parent scope authorise actions on its
// children?" YES for read-heavy capabilities; usually NO for write
// capabilities unless the tenant explicitly opts in.
// ─────────────────────────────────────────────────────────────────────────

export interface CascadeRule {
  /** The parent scope that may cascade (e.g. 'district'). */
  readonly parentScope: ScopeKind;
  /** The child scope that may receive cascade (e.g. 'parcel'). */
  readonly childScope: ScopeKind;
  /**
   * Which capabilities cascade from parent → child. An assignment at
   * district scope with `['view', 'annotate']` here will satisfy a check
   * for `view` on a parcel within that district.
   */
  readonly cascadedCapabilities: ReadonlyArray<Capability>;
}

export const DEFAULT_CASCADE_RULES: ReadonlyArray<CascadeRule> = Object.freeze([
  {
    parentScope: 'district',
    childScope: 'parcel',
    cascadedCapabilities: ['view', 'annotate', 'comment'],
  },
  {
    parentScope: 'region',
    childScope: 'district',
    cascadedCapabilities: ['view', 'annotate', 'comment'],
  },
  {
    parentScope: 'region',
    childScope: 'parcel',
    cascadedCapabilities: ['view'],
  },
  {
    parentScope: 'property',
    childScope: 'unit',
    cascadedCapabilities: ['view', 'annotate'],
  },
  {
    parentScope: 'property',
    childScope: 'building',
    cascadedCapabilities: ['view', 'annotate'],
  },
]);

// ─────────────────────────────────────────────────────────────────────────
// Zod schemas — exported for routes / DB-layer validators.
// ─────────────────────────────────────────────────────────────────────────

export const ScopeKindSchema = z.enum(SCOPE_KINDS);
export const CapabilitySchema = z.enum(CAPABILITIES);
export const AssignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);

export const AssignUserRequestSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  scope: ScopeKindSchema,
  scopeRefs: z.array(z.string().min(1)).min(0),
  capabilities: z.array(CapabilitySchema).min(1),
  assignedBy: z.string().min(1),
  startsAt: z.date().optional(),
  endsAt: z.date().nullable().optional(),
  reason: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type AssignUserRequest = z.infer<typeof AssignUserRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Persistence port — every adapter implements this.
// In-memory adapter ships with the package; production wires a Drizzle
// adapter in `services/api-gateway`.
// ─────────────────────────────────────────────────────────────────────────

export interface AssignmentRepository {
  insert(assignment: Assignment): Promise<void>;
  update(assignment: Assignment): Promise<void>;
  findById(id: string): Promise<Assignment | null>;
  findByAssignee(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<Assignment>>;
  findByScope(
    tenantId: string,
    scope: ScopeKind,
    scopeRef?: string,
  ): Promise<ReadonlyArray<Assignment>>;
  list(tenantId: string): Promise<ReadonlyArray<Assignment>>;
}

export interface AssignmentEventRepository {
  insert(event: AssignmentEvent): Promise<void>;
  listForAssignment(assignmentId: string): Promise<ReadonlyArray<AssignmentEvent>>;
}
