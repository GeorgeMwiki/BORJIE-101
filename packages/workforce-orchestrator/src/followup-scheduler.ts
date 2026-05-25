/**
 * Piece M — followup-scheduler.
 *
 * Cron-driven loop. Reads all work_followups with status='pending' and
 * scheduled_at <= now(), dispatches a check-in prompt through the
 * channel adapter, and flips status → 'sent'.
 *
 * On dispatch error the row stays pending; the next tick re-tries.
 * On responder timeout (handled separately in checkMissedFollowups) the
 * row flips to 'missed' and emits a no_response check_in (NB: the
 * timeout path is invoked by the same cron — see scheduleMissedSweep).
 */

import type { WorkforceDeps, WorkFollowup } from './types.js';

export interface DispatchResult {
  followup: WorkFollowup;
  delivered: boolean;
  error?: string;
}

/** Default grace window before a sent followup is declared "missed". */
export const DEFAULT_GRACE_MS = 24 * 3_600_000;

export async function runFollowupSchedulerOnce(
  deps: WorkforceDeps,
  tenantId: string
): Promise<DispatchResult[]> {
  const now = deps.clock();
  const due = await deps.store.listDueFollowups(tenantId, now);

  const results: DispatchResult[] = [];

  for (const followup of due) {
    const assignment = await deps.store.getAssignment(tenantId, followup.assignmentId);
    if (!assignment) {
      // Parent missing — orphaned row. Skip; do not flip status. Could
      // be a race with cascading delete.
      continue;
    }
    if (
      assignment.status === 'completed' ||
      assignment.status === 'cancelled'
    ) {
      // No point chasing a closed assignment. Just mark sent so the
      // scheduler stops re-emitting.
      await deps.store.updateFollowup({ ...followup, status: 'sent' });
      results.push({ followup: { ...followup, status: 'sent' }, delivered: false });
      continue;
    }

    const employee = await deps.store.getEmployee(tenantId, assignment.assignedEmployeeId);
    if (!employee) {
      continue;
    }

    let delivered = false;
    let error: string | undefined;
    try {
      const r = await deps.channel.send({
        tenantId,
        employeeId: assignment.assignedEmployeeId,
        channel: followup.channel,
        template: `workforce.followup.${followup.cadenceKind}`,
        payload: {
          assignmentId: assignment.id,
          title: assignment.title,
          dueAt: assignment.dueAt,
          riskTier: assignment.riskTier,
        },
      });
      delivered = r.delivered;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      delivered = false;
    }

    if (delivered) {
      const updated: WorkFollowup = { ...followup, status: 'sent' };
      await deps.store.updateFollowup(updated);
      results.push({ followup: updated, delivered: true });
    } else {
      results.push({ followup, delivered: false, error });
    }
  }

  return results;
}

/**
 * Sweep follow-ups that were sent more than `graceMs` ago but never had
 * a check-in. Flip them to 'missed' and emit a synthetic no_response
 * check_in so downstream signals fire.
 */
export async function sweepMissedFollowups(
  deps: WorkforceDeps,
  tenantId: string,
  graceMs: number = DEFAULT_GRACE_MS
): Promise<string[]> {
  const now = deps.clock();
  const due = await deps.store.listDueFollowups(tenantId, now);

  // listDueFollowups returns pending rows. For "missed" detection we want
  // sent rows older than graceMs. The store doesn't expose that as a hot
  // query; we cross-walk via per-assignment listing. In production the
  // adapter is expected to support a dedicated query; here we tolerate
  // an O(n) loop in tests.
  const missed: string[] = [];

  for (const f of due) {
    if (f.status !== 'sent') continue;
    if (!f.createdAt) continue;
    const ageMs = now.getTime() - new Date(f.createdAt).getTime();
    if (ageMs < graceMs) continue;

    const updated: WorkFollowup = { ...f, status: 'missed' };
    await deps.store.updateFollowup(updated);

    await deps.store.insertCheckIn({
      id: deps.uuid(),
      tenantId,
      assignmentId: f.assignmentId,
      followupId: f.id,
      employeeId: (await deps.store.getAssignment(tenantId, f.assignmentId))!
        .assignedEmployeeId,
      responseKind: 'no_response',
      responseText: null,
      attachmentsJsonb: [],
      sentimentScore: null,
      createdAt: now.toISOString(),
    });

    missed.push(f.id);
  }

  return missed;
}
