/**
 * Piece M — performance-tracker.
 *
 * Emits performance_signals from observable events:
 *   * check-in with response_kind=completed  → on_time_completion or
 *                                                missed_deadline
 *   * check-in with response_kind=blocker AND
 *     >=3 blockers in rolling 30d for this employee → repeated_blocker
 *   * sentiment_score >= +0.5  → positive_sentiment
 *   * sentiment_score <= -0.5  → negative_sentiment
 *   * audit cron: deadline elapsed without completion → missed_deadline
 *
 * Manual signals (exceptional_work, manager_rated overrides) are emitted
 * directly via emitManualSignal — not from the auto-tracker here.
 *
 * Weights are kernel-defined (see WEIGHTS); the writer always uses these
 * values so a downstream aggregator can sum without normalising.
 */

import {
  PerformanceSignalSchema,
  type PerformanceSignal,
  type SignalKind,
  type SignalSourceKind,
  type WorkAssignment,
  type WorkCheckIn,
  type WorkforceDeps,
} from './types.js';

const WEIGHTS: Record<SignalKind, number> = {
  on_time_completion: 1.0,
  missed_deadline: -1.5,
  repeated_blocker: -2.0,
  exceptional_work: 2.0,
  positive_sentiment: 0.5,
  negative_sentiment: -0.5,
};

const REPEATED_BLOCKER_WINDOW_MS = 30 * 24 * 3_600_000;
const REPEATED_BLOCKER_THRESHOLD = 3;

export async function runPerformanceTracker(
  deps: WorkforceDeps,
  args: {
    tenantId: string;
    assignment: WorkAssignment;
    checkIn: WorkCheckIn;
  }
): Promise<SignalKind[]> {
  const emitted: SignalKind[] = [];
  const { tenantId, assignment, checkIn } = args;

  // 1. Completion timing.
  if (checkIn.responseKind === 'completed') {
    const dueAtMs = assignment.dueAt ? new Date(assignment.dueAt).getTime() : null;
    const completedAtMs = new Date(checkIn.createdAt ?? deps.clock().toISOString()).getTime();
    const onTime = dueAtMs === null || completedAtMs <= dueAtMs;
    const kind: SignalKind = onTime ? 'on_time_completion' : 'missed_deadline';
    await emitSignal(deps, {
      tenantId,
      employeeId: checkIn.employeeId,
      signalKind: kind,
      sourceKind: 'check_in',
      sourceRef: checkIn.id,
      context: { assignmentId: assignment.id, dueAt: assignment.dueAt },
    });
    emitted.push(kind);
  }

  // 2. Blocker streak.
  if (checkIn.responseKind === 'blocker') {
    const since = new Date(deps.clock().getTime() - REPEATED_BLOCKER_WINDOW_MS);
    const recent = await deps.store.listCheckInsForEmployee(
      tenantId,
      checkIn.employeeId,
      since
    );
    const blockerCount = recent.filter((c) => c.responseKind === 'blocker').length;
    if (blockerCount >= REPEATED_BLOCKER_THRESHOLD) {
      await emitSignal(deps, {
        tenantId,
        employeeId: checkIn.employeeId,
        signalKind: 'repeated_blocker',
        sourceKind: 'check_in',
        sourceRef: checkIn.id,
        context: { assignmentId: assignment.id, blockerCount },
      });
      emitted.push('repeated_blocker');
    }
  }

  // 3. Sentiment.
  if (typeof checkIn.sentimentScore === 'number') {
    if (checkIn.sentimentScore >= 0.5) {
      await emitSignal(deps, {
        tenantId,
        employeeId: checkIn.employeeId,
        signalKind: 'positive_sentiment',
        sourceKind: 'check_in',
        sourceRef: checkIn.id,
        context: { score: checkIn.sentimentScore },
      });
      emitted.push('positive_sentiment');
    } else if (checkIn.sentimentScore <= -0.5) {
      await emitSignal(deps, {
        tenantId,
        employeeId: checkIn.employeeId,
        signalKind: 'negative_sentiment',
        sourceKind: 'check_in',
        sourceRef: checkIn.id,
        context: { score: checkIn.sentimentScore },
      });
      emitted.push('negative_sentiment');
    }
  }

  return emitted;
}

export async function emitManualSignal(
  deps: WorkforceDeps,
  args: {
    tenantId: string;
    employeeId: string;
    signalKind: SignalKind;
    note?: string;
  }
): Promise<PerformanceSignal> {
  return emitSignal(deps, {
    tenantId: args.tenantId,
    employeeId: args.employeeId,
    signalKind: args.signalKind,
    sourceKind: 'manual',
    sourceRef: null,
    context: args.note ? { note: args.note } : {},
  });
}

async function emitSignal(
  deps: WorkforceDeps,
  args: {
    tenantId: string;
    employeeId: string;
    signalKind: SignalKind;
    sourceKind: SignalSourceKind;
    sourceRef: string | null;
    context: Record<string, unknown>;
  }
): Promise<PerformanceSignal> {
  const row: PerformanceSignal = PerformanceSignalSchema.parse({
    id: deps.uuid(),
    tenantId: args.tenantId,
    employeeId: args.employeeId,
    signalKind: args.signalKind,
    weight: WEIGHTS[args.signalKind],
    contextJsonb: args.context,
    sourceKind: args.sourceKind,
    sourceRef: args.sourceRef,
    createdAt: deps.clock().toISOString(),
  });

  return deps.store.insertSignal(row);
}

/**
 * Audit cron entrypoint — emit a missed_deadline signal for every
 * assignment that has elapsed without completion.
 */
export async function runDeadlineMissAudit(
  deps: WorkforceDeps,
  tenantId: string
): Promise<string[]> {
  const overdue = await deps.store.listOverdueAssignments(tenantId, deps.clock());
  const emitted: string[] = [];
  for (const a of overdue) {
    const row = await emitSignal(deps, {
      tenantId,
      employeeId: a.assignedEmployeeId,
      signalKind: 'missed_deadline',
      sourceKind: 'audit_event',
      sourceRef: a.id,
      context: { assignmentId: a.id, dueAt: a.dueAt },
    });
    emitted.push(row.id);
  }
  return emitted;
}

export { WEIGHTS as PERFORMANCE_WEIGHTS };
