/**
 * estate / schedule_renewal_negotiation — open a work assignment so a
 * leasing officer drives the renewal conversation with the tenant.
 *
 * Triggered when:
 *   - capture sees a `lease` entity with intent=propose_action and the
 *     brain identifies "renewal-pre-window" signals (60-day countdown)
 *   - a bulk_mark_for_renewal_prep handler iterates leases and emits one
 *     of these per lease
 *
 * Uses Piece M's `work_assignments` port to create the assignment. Wave-3
 * Piece M is the agentic-workforce-management piece — its port has the
 * canonical shape we adopt here.
 *
 * If Piece M is not yet wired, the stub port returns a fake assignment id
 * and a TODO(#34) warn keeps the call shape testable.
 */

import { z } from 'zod';
import { logger } from '../../../logger.js';

// ─── Payload schema ───────────────────────────────────────────────────────

export const ScheduleRenewalNegotiationPayloadSchema = z.object({
  /** Lease (core_entity id) whose renewal is being scheduled. */
  lease_id: z.string().min(1),
  /** Tenant (PERSON entity) holding the lease. */
  tenant_entity_id: z.string().min(1),
  /** Unit (core_entity id) bound to the lease — used for officer routing. */
  unit_id: z.string().min(1),
  /** ISO date by which the conversation must start. */
  target_start_date: z.string(),
  /** Why now — gives the officer brief context. */
  rationale: z.string().min(3),
  /**
   * Optional officer assignment hint. When null, Piece M's allocator picks
   * the most-available certified leasing officer for the catchment area.
   */
  assigned_officer_id: z.string().nullable(),
  /** Priority bucket — drives the SLA timer on the assignment. */
  priority: z
    .enum(['critical', 'high', 'medium', 'low'])
    .default('medium'),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type ScheduleRenewalNegotiationPayload = z.infer<
  typeof ScheduleRenewalNegotiationPayloadSchema
>;

export interface ScheduleRenewalNegotiationResult {
  readonly assignment_id: string;
  readonly audit_chain_id: string;
  readonly status: 'scheduled';
  /** True when Piece M port produced a real id; false when stubbed. */
  readonly persisted: boolean;
}

// ─── Ports ────────────────────────────────────────────────────────────────

export interface WorkAssignmentPort {
  /**
   * Create a work assignment via the Piece M agency port. Returns `null`
   * when the underlying table / service is not yet wired; the handler
   * then degrades gracefully and emits a TODO(#34) warning.
   */
  assign(args: {
    readonly tenantId: string;
    readonly assigneeUserId: string | null;
    readonly title: string;
    readonly rationale: string;
    readonly targetStartDate: string;
    readonly priority: 'critical' | 'high' | 'medium' | 'low';
    readonly relatedEntities: ReadonlyArray<{
      readonly kind: string;
      readonly id: string;
    }>;
  }): Promise<{ readonly id: string } | null>;
}

export interface AuditChainPort {
  append(args: {
    readonly tenantId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface NotificationPort {
  publish(args: {
    readonly tenantId: string;
    readonly channel: string;
    readonly subject: string;
    readonly correlation: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface ScheduleRenewalNegotiationDeps {
  readonly workAssignments: WorkAssignmentPort;
  readonly auditChain: AuditChainPort;
  readonly notifications: NotificationPort;
  readonly logger?: {
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface ScheduleRenewalNegotiationContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function scheduleRenewalNegotiationHandler(
  payload: ScheduleRenewalNegotiationPayload,
  ctx: ScheduleRenewalNegotiationContext,
  deps: ScheduleRenewalNegotiationDeps,
): Promise<ScheduleRenewalNegotiationResult> {
  const parsed = ScheduleRenewalNegotiationPayloadSchema.parse(payload);

  const assignment = await deps.workAssignments.assign({
    tenantId: ctx.tenantId,
    assigneeUserId: parsed.assigned_officer_id,
    title: `Renewal negotiation — lease ${parsed.lease_id}`,
    rationale: parsed.rationale,
    targetStartDate: parsed.target_start_date,
    priority: parsed.priority,
    relatedEntities: [
      { kind: 'lease', id: parsed.lease_id },
      { kind: 'unit', id: parsed.unit_id },
      { kind: 'tenant', id: parsed.tenant_entity_id },
    ],
  });

  let assignmentId: string;
  let persisted: boolean;
  if (assignment === null) {
    assignmentId = `stub_assignment_${ctx.proposalId}`;
    persisted = false;
    const warn = deps.logger?.warn;
    if (warn) {
      warn(
        { proposal_id: ctx.proposalId, lease_id: parsed.lease_id },
        'TODO(#34): route to Piece M work_assignments when port lands',
      );
    } else {
      logger.warn('TODO(#34): route to Piece M work_assignments when port lands', { proposal_id: ctx.proposalId, lease_id: parsed.lease_id });
    }
  } else {
    assignmentId = assignment.id;
    persisted = true;
  }

  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'estate.schedule_renewal_negotiation',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      assignment_id: assignmentId,
      lease_id: parsed.lease_id,
      tenant_entity_id: parsed.tenant_entity_id,
      target_start_date: parsed.target_start_date,
      priority: parsed.priority,
      persisted,
    },
  });

  await deps.notifications.publish({
    tenantId: ctx.tenantId,
    channel: `tenant:${ctx.tenantId}:module:ESTATE:renewals`,
    subject: `Renewal negotiation scheduled for lease ${parsed.lease_id}`,
    correlation: {
      assignment_id: assignmentId,
      proposal_id: ctx.proposalId,
      lease_id: parsed.lease_id,
    },
  });

  return Object.freeze({
    assignment_id: assignmentId,
    audit_chain_id: audit.id,
    status: 'scheduled' as const,
    persisted,
  });
}
