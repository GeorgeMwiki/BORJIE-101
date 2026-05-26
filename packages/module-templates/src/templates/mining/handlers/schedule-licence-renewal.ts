/**
 * mining / schedule_licence_renewal — open a licence renewal task and
 * record the renewal-window edge in the temporal entity graph so the
 * brain can ask "what licences need renewal next quarter?" later.
 *
 * Triggered when:
 *   - capture sees a `licence` entity with intent=propose_action and the
 *     brain identifies "renewal-window approaching" signals (mining
 *     licences renew on 60/90-day cycles depending on kind)
 *   - a `bulk_mark_licences_for_renewal` handler iterates licences and
 *     emits one of these per licence
 *
 * Writes to two mining-domain tables:
 *   - `tasks`             — owner-pickable follow-up with cadence
 *   - `temporal_entities` — bi-temporal edge so the KG knows the
 *                           renewal-window edge exists from now to
 *                           `target_start_date`
 *
 * Ports are typed Drizzle inserts; callers inject the Drizzle client at
 * the composition root. The handler is pure: validate → insert → notify.
 *
 * Replaces the pre-Borjie `schedule_renewal_negotiation` stub (the
 * historical gh-issue #34 work-item, now closed) that targeted
 * `lease`/`tenant`/`unit` entities. The mining equivalent
 * targets `licence`/`company`/`site`.
 */

import { z } from 'zod';

// ─── Payload schema ───────────────────────────────────────────────────────

export const ScheduleLicenceRenewalPayloadSchema = z.object({
  /** Licence row id whose renewal is being scheduled. */
  licence_id: z.string().min(1),
  /** Company that holds the licence (FK to `companies.id`). */
  company_id: z.string().min(1),
  /** Site id that the licence covers — used for routing the action. */
  site_id: z.string().min(1).nullable(),
  /** ISO date by which the renewal action must begin. */
  target_start_date: z.string().min(1),
  /** Free-text rationale that surfaces on the task card. */
  rationale: z.string().min(3),
  /**
   * Optional licence-officer assignment hint. When null, the dispatcher's
   * owner-resolution picks the company's mining-role=`owner` user.
   */
  assigned_user_id: z.string().nullable(),
  /** Priority (1 low → 5 critical) drives the SLA timer on the task. */
  priority: z.number().int().min(1).max(5).default(3),
  /** AI follow-up cadence — task ticks the agent's chase loop. */
  followup_cadence: z
    .enum(['daily', 'every_3d', 'weekly', 'monthly'])
    .default('weekly'),
  /** Evidence ids that justify scheduling this renewal (assays, letters). */
  evidence_ids: z.array(z.string().min(1)).default([]),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type ScheduleLicenceRenewalPayload = z.infer<
  typeof ScheduleLicenceRenewalPayloadSchema
>;

export interface ScheduleLicenceRenewalResult {
  readonly success: true;
  readonly entity_id: string;
  readonly evidence_ids: ReadonlyArray<string>;
  readonly temporal_entity_id: string;
  readonly audit_chain_id: string;
}

// ─── Ports ────────────────────────────────────────────────────────────────

/** Typed Drizzle insert against `tasks`. */
export interface TasksStorePort {
  insert(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly ownerUserId: string | null;
    readonly title: string;
    readonly kind: 'licence_renewal';
    readonly priority: number;
    readonly siteId: string | null;
    readonly licenceId: string;
    readonly dueDate: string;
    readonly requiredEvidence: ReadonlyArray<string>;
    readonly riskIfDelayed: string;
    readonly aiFollowupCadence: 'daily' | 'every_3d' | 'weekly' | 'monthly';
    readonly attributes: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

/** Typed Drizzle insert against `temporal_entities`. */
export interface TemporalEntityStorePort {
  insert(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly entityType: 'licence-renewal-window';
    readonly entityKey: string;
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly validFrom: string;
    readonly validTo: string | null;
    readonly confidence: number;
    readonly evidenceIds: ReadonlyArray<string>;
    readonly source: string;
  }): Promise<{ readonly id: string }>;
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

/** Stable id factory injected by callers — keeps the handler pure. */
export interface IdGeneratorPort {
  newId(prefix: string): string;
}

export interface ScheduleLicenceRenewalDeps {
  readonly tasks: TasksStorePort;
  readonly temporalEntities: TemporalEntityStorePort;
  readonly auditChain: AuditChainPort;
  readonly notifications: NotificationPort;
  readonly ids: IdGeneratorPort;
}

export interface ScheduleLicenceRenewalContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
  /** When the proposal was raised — used as `valid_from` on the KG edge. */
  readonly nowIso: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function scheduleLicenceRenewalHandler(
  payload: ScheduleLicenceRenewalPayload,
  ctx: ScheduleLicenceRenewalContext,
  deps: ScheduleLicenceRenewalDeps,
): Promise<ScheduleLicenceRenewalResult> {
  const parsed = ScheduleLicenceRenewalPayloadSchema.parse(payload);

  const taskId = deps.ids.newId('task');
  const temporalId = deps.ids.newId('te');

  const task = await deps.tasks.insert({
    id: taskId,
    tenantId: ctx.tenantId,
    ownerUserId: parsed.assigned_user_id,
    title: `Licence renewal — ${parsed.licence_id}`,
    kind: 'licence_renewal',
    priority: parsed.priority,
    siteId: parsed.site_id,
    licenceId: parsed.licence_id,
    dueDate: parsed.target_start_date,
    requiredEvidence: parsed.evidence_ids,
    riskIfDelayed: parsed.rationale,
    aiFollowupCadence: parsed.followup_cadence,
    attributes: {
      proposal_id: ctx.proposalId,
      company_id: parsed.company_id,
      source: parsed.source,
    },
  });

  const temporal = await deps.temporalEntities.insert({
    id: temporalId,
    tenantId: ctx.tenantId,
    entityType: 'licence-renewal-window',
    entityKey: parsed.licence_id,
    attributes: {
      task_id: task.id,
      company_id: parsed.company_id,
      site_id: parsed.site_id,
      priority: parsed.priority,
      proposal_id: ctx.proposalId,
    },
    validFrom: ctx.nowIso,
    validTo: parsed.target_start_date,
    confidence: 0.95,
    evidenceIds: parsed.evidence_ids,
    source: `agent:schedule_licence_renewal:${ctx.proposalId}`,
  });

  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'mining.schedule_licence_renewal',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      task_id: task.id,
      temporal_entity_id: temporal.id,
      licence_id: parsed.licence_id,
      company_id: parsed.company_id,
      target_start_date: parsed.target_start_date,
      priority: parsed.priority,
    },
  });

  await deps.notifications.publish({
    tenantId: ctx.tenantId,
    channel: `tenant:${ctx.tenantId}:module:MINING:licences`,
    subject: `Licence renewal scheduled for ${parsed.licence_id}`,
    correlation: {
      task_id: task.id,
      proposal_id: ctx.proposalId,
      licence_id: parsed.licence_id,
    },
  });

  return Object.freeze({
    success: true as const,
    entity_id: task.id,
    evidence_ids: parsed.evidence_ids,
    temporal_entity_id: temporal.id,
    audit_chain_id: audit.id,
  });
}
