/**
 * mining / bulk_mark_licences_for_renewal — flag many mining licences at
 * once for upcoming renewal preparation.
 *
 * Bulk actions are HIGH-risk by definition (one approve flips N rows) so
 * the routing rule's `hitl_required` flag MUST be true regardless of
 * confidence. The dispatcher enforces this — see the
 * `bulk_op_always_requires_hitl` test in the dispatch-router package.
 *
 * Triggered by:
 *   - kernel turn  : "flag all licences expiring in the next 90 days for
 *                    renewal prep" (intent=propose_action with cohort
 *                    filter shape recognised by the brain)
 *   - admin script : ops can fire this directly via the proposals API
 *
 * For every licence_id passed in, the handler creates a typed `tasks`
 * row of kind=`licence_renewal` that surfaces in the licences renewal
 * cohort dashboard. The handler returns per-licence outcome rows so the
 * manager UI can show progress at a glance.
 *
 * Replaces the pre-Borjie `bulk_mark_for_renewal_prep` stub (the
 * historical gh-issue #34 work-item, now closed) which targeted
 * `lease_ids`. The mining equivalent targets
 * `licence_ids` and writes typed Drizzle inserts against `tasks`.
 */

import { z } from 'zod';

// ─── Payload schema ───────────────────────────────────────────────────────

export const BulkMarkLicencesForRenewalPayloadSchema = z.object({
  /**
   * Licence ids to flag. ≥1 — empty arrays are rejected so a misfire
   * doesn't no-op silently. Capped at 500 per call.
   */
  licence_ids: z.array(z.string().min(1)).min(1).max(500),
  /** Human-readable reason; persisted on every task created. */
  reason: z.string().min(3),
  /** Prep window in days — informs `due_date` on each task. */
  prep_window_days: z.number().int().min(7).max(180).default(60),
  /** AI follow-up cadence — task ticks the agent's chase loop. */
  followup_cadence: z
    .enum(['daily', 'every_3d', 'weekly', 'monthly'])
    .default('weekly'),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type BulkMarkLicencesForRenewalPayload = z.infer<
  typeof BulkMarkLicencesForRenewalPayloadSchema
>;

export interface BulkMarkLicencesForRenewalResult {
  readonly success: true;
  readonly entity_id: string;
  readonly evidence_ids: ReadonlyArray<string>;
  readonly audit_chain_id: string;
  readonly created_count: number;
  readonly skipped_count: number;
  readonly per_licence: ReadonlyArray<{
    readonly licence_id: string;
    readonly status: 'flagged' | 'skipped';
    readonly task_id?: string;
    readonly reason?: string;
  }>;
}

// ─── Ports ────────────────────────────────────────────────────────────────

export interface BulkLicenceTaskStorePort {
  /**
   * Bulk-create renewal tasks for the given licences. Returns the
   * per-licence outcome. Implementation MUST ignore licences that don't
   * exist or are already closed.
   */
  bulkCreateRenewalTasks(args: {
    readonly tenantId: string;
    readonly licenceIds: ReadonlyArray<string>;
    readonly reason: string;
    readonly dueDate: string;
    readonly followupCadence: 'daily' | 'every_3d' | 'weekly' | 'monthly';
    readonly attributes: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly created: ReadonlyArray<{
      readonly licenceId: string;
      readonly taskId: string;
    }>;
    readonly skipped: ReadonlyArray<{
      readonly licenceId: string;
      readonly reason: string;
    }>;
  }>;
}

export interface AuditChainPort {
  append(args: {
    readonly tenantId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface BulkMarkLicencesForRenewalDeps {
  readonly licenceTasks: BulkLicenceTaskStorePort;
  readonly auditChain: AuditChainPort;
}

export interface BulkMarkLicencesForRenewalContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
  /** Today's ISO date (UTC). Used to compute due_date deterministically. */
  readonly todayIso: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────

/**
 * Adds `prep_window_days` to `todayIso` and returns the resulting
 * ISO date string. Throws if `todayIso` is not a parseable ISO date.
 */
function addDays(todayIso: string, prepWindowDays: number): string {
  const base = new Date(todayIso);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`bulk_mark_licences: todayIso "${todayIso}" is not parseable`);
  }
  const next = new Date(base.getTime() + prepWindowDays * 24 * 60 * 60 * 1000);
  const isoDate = next.toISOString().slice(0, 10);
  return isoDate;
}

export async function bulkMarkLicencesForRenewalHandler(
  payload: BulkMarkLicencesForRenewalPayload,
  ctx: BulkMarkLicencesForRenewalContext,
  deps: BulkMarkLicencesForRenewalDeps,
): Promise<BulkMarkLicencesForRenewalResult> {
  const parsed = BulkMarkLicencesForRenewalPayloadSchema.parse(payload);

  const dueDate = addDays(ctx.todayIso, parsed.prep_window_days);

  const outcome = await deps.licenceTasks.bulkCreateRenewalTasks({
    tenantId: ctx.tenantId,
    licenceIds: parsed.licence_ids,
    reason: parsed.reason,
    dueDate,
    followupCadence: parsed.followup_cadence,
    attributes: {
      proposal_id: ctx.proposalId,
      prep_window_days: parsed.prep_window_days,
      source: parsed.source,
    },
  });

  const createdMap = new Map(
    outcome.created.map((c) => [c.licenceId, c.taskId] as const),
  );
  const skippedMap = new Map(
    outcome.skipped.map((s) => [s.licenceId, s.reason] as const),
  );

  const perLicence = parsed.licence_ids.map((licenceId) => {
    const taskId = createdMap.get(licenceId);
    if (taskId !== undefined) {
      return {
        licence_id: licenceId,
        status: 'flagged' as const,
        task_id: taskId,
      };
    }
    return {
      licence_id: licenceId,
      status: 'skipped' as const,
      reason: skippedMap.get(licenceId) ?? 'not_found',
    };
  });

  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'mining.bulk_mark_licences_for_renewal',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      requested: parsed.licence_ids.length,
      created: outcome.created.length,
      skipped: outcome.skipped.length,
      reason: parsed.reason,
      prep_window_days: parsed.prep_window_days,
      due_date: dueDate,
    },
  });

  return Object.freeze({
    success: true as const,
    entity_id: audit.id,
    evidence_ids: [],
    audit_chain_id: audit.id,
    created_count: outcome.created.length,
    skipped_count: outcome.skipped.length,
    per_licence: perLicence,
  });
}
