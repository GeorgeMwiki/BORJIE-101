/**
 * mining / open_equipment_maintenance — open a maintenance event against
 * a fleet/equipment asset (excavator, compressor, generator, drill rig,
 * truck, vehicle, pump, crusher) and create a follow-up `repair` task so
 * the supervisor closes the loop.
 *
 * Triggered by:
 *   - kernel turn  : "the excavator at site-1 is leaking hydraulic oil"
 *                    (intent=propose_action, entity=asset + maintenance signal)
 *   - document     : an inspection report or breakdown form (Piece K)
 *
 * Writes to two mining-domain tables:
 *   - `maintenance_events` — the actual repair/inspection event row
 *   - `tasks`              — follow-up task so the agent chases the
 *                            supervisor on the asset's behalf
 *
 * Replaces the pre-Borjie `open_maintenance_case` stub (the historical
 * gh-issue #34 work-item, now closed) that targeted `unit_id` (a
 * building/apartment unit). The mining equivalent
 * targets `asset_id` (an excavator, drill, truck, etc.).
 */

import { z } from 'zod';

// ─── Payload schema ───────────────────────────────────────────────────────

const MAINTENANCE_EVENT_KINDS = [
  'scheduled_service',
  'repair',
  'inspection',
  'breakdown',
  'overhaul',
  'tyre_change',
] as const;

const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
type Severity = (typeof SEVERITY_LEVELS)[number];

/** Severity → task priority (1 low → 5 critical). */
const SEVERITY_TO_PRIORITY: Readonly<Record<Severity, number>> = Object.freeze({
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
});

export const OpenEquipmentMaintenancePayloadSchema = z.object({
  /** Asset row id (FK to `assets.id`). */
  asset_id: z.string().min(1),
  /** Site at which the maintenance is needed (FK to `sites.id`). */
  site_id: z.string().min(1).nullable(),
  /** One-line summary used as the event title. */
  summary: z.string().min(3).max(200),
  /** Maintenance kind — drives downstream SLAs + parts requisition. */
  kind: z.enum(MAINTENANCE_EVENT_KINDS),
  /** Severity drives task priority + alert channels. */
  severity: z.enum(SEVERITY_LEVELS).default('medium'),
  /** Optional long-form description. */
  description: z.string().nullable(),
  /** ISO timestamp when the work should start. */
  scheduled_for: z.string().nullable(),
  /** Estimated downtime in hours — informs production forecast. */
  estimated_downtime_hours: z.number().nonnegative().nullable(),
  /** Reporter user id (canonical). */
  reporter_user_id: z.string().nullable(),
  /** Evidence ids (photos, voice memos, inspection rows). */
  evidence_ids: z.array(z.string().min(1)).default([]),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type OpenEquipmentMaintenancePayload = z.infer<
  typeof OpenEquipmentMaintenancePayloadSchema
>;

export interface OpenEquipmentMaintenanceResult {
  readonly success: true;
  readonly entity_id: string;
  readonly task_id: string;
  readonly evidence_ids: ReadonlyArray<string>;
  readonly audit_chain_id: string;
}

// ─── Ports ────────────────────────────────────────────────────────────────

/** Typed Drizzle insert against `maintenance_events`. */
export interface MaintenanceEventStorePort {
  insert(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly assetId: string;
    readonly kind: (typeof MAINTENANCE_EVENT_KINDS)[number];
    readonly status: 'open';
    readonly summary: string;
    readonly downtimeHours: number | null;
    readonly performedByUserId: string | null;
    readonly scheduledFor: string | null;
    readonly evidenceIds: ReadonlyArray<string>;
    readonly attributes: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

/** Typed Drizzle insert against `tasks`. */
export interface TasksStorePort {
  insert(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly ownerUserId: string | null;
    readonly title: string;
    readonly kind: 'repair';
    readonly priority: number;
    readonly siteId: string | null;
    readonly licenceId: string | null;
    readonly dueDate: string | null;
    readonly requiredEvidence: ReadonlyArray<string>;
    readonly riskIfDelayed: string;
    readonly aiFollowupCadence: 'daily' | 'every_3d' | 'weekly' | 'monthly';
    readonly attributes: Readonly<Record<string, unknown>>;
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

export interface IdGeneratorPort {
  newId(prefix: string): string;
}

export interface OpenEquipmentMaintenanceDeps {
  readonly maintenanceEvents: MaintenanceEventStorePort;
  readonly tasks: TasksStorePort;
  readonly auditChain: AuditChainPort;
  readonly notifications: NotificationPort;
  readonly ids: IdGeneratorPort;
}

export interface OpenEquipmentMaintenanceContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────

/**
 * Picks the task `aiFollowupCadence` from severity — critical issues get
 * chased daily; low ones weekly.
 */
function cadenceForSeverity(
  severity: Severity,
): 'daily' | 'every_3d' | 'weekly' | 'monthly' {
  switch (severity) {
    case 'critical':
      return 'daily';
    case 'high':
      return 'every_3d';
    case 'medium':
      return 'weekly';
    case 'low':
      return 'monthly';
  }
}

export async function openEquipmentMaintenanceHandler(
  payload: OpenEquipmentMaintenancePayload,
  ctx: OpenEquipmentMaintenanceContext,
  deps: OpenEquipmentMaintenanceDeps,
): Promise<OpenEquipmentMaintenanceResult> {
  const parsed = OpenEquipmentMaintenancePayloadSchema.parse(payload);

  const eventId = deps.ids.newId('me');
  const taskId = deps.ids.newId('task');

  const event = await deps.maintenanceEvents.insert({
    id: eventId,
    tenantId: ctx.tenantId,
    assetId: parsed.asset_id,
    kind: parsed.kind,
    status: 'open' as const,
    summary: parsed.summary,
    downtimeHours: parsed.estimated_downtime_hours,
    performedByUserId: null,
    scheduledFor: parsed.scheduled_for,
    evidenceIds: parsed.evidence_ids,
    attributes: {
      proposal_id: ctx.proposalId,
      severity: parsed.severity,
      site_id: parsed.site_id,
      description: parsed.description,
      reporter_user_id: parsed.reporter_user_id,
      source: parsed.source,
    },
  });

  const task = await deps.tasks.insert({
    id: taskId,
    tenantId: ctx.tenantId,
    ownerUserId: parsed.reporter_user_id,
    title: `Close maintenance event ${event.id} — ${parsed.summary}`,
    kind: 'repair' as const,
    priority: SEVERITY_TO_PRIORITY[parsed.severity],
    siteId: parsed.site_id,
    licenceId: null,
    dueDate: parsed.scheduled_for,
    requiredEvidence: parsed.evidence_ids,
    riskIfDelayed:
      parsed.severity === 'critical' || parsed.severity === 'high'
        ? 'Production halt risk + safety exposure if maintenance is delayed'
        : 'Downtime risk if maintenance is delayed',
    aiFollowupCadence: cadenceForSeverity(parsed.severity),
    attributes: {
      maintenance_event_id: event.id,
      asset_id: parsed.asset_id,
      proposal_id: ctx.proposalId,
    },
  });

  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'mining.open_equipment_maintenance',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      maintenance_event_id: event.id,
      task_id: task.id,
      asset_id: parsed.asset_id,
      kind: parsed.kind,
      severity: parsed.severity,
    },
  });

  await deps.notifications.publish({
    tenantId: ctx.tenantId,
    channel: `tenant:${ctx.tenantId}:module:MINING:maintenance`,
    subject: `Maintenance event opened for asset ${parsed.asset_id}`,
    correlation: {
      maintenance_event_id: event.id,
      task_id: task.id,
      proposal_id: ctx.proposalId,
      kind: parsed.kind,
      severity: parsed.severity,
    },
  });

  return Object.freeze({
    success: true as const,
    entity_id: event.id,
    task_id: task.id,
    evidence_ids: parsed.evidence_ids,
    audit_chain_id: audit.id,
  });
}
