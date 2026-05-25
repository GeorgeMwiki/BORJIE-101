/**
 * Agency — stall detector + self-heal proposer.
 *
 * LITFIN parity gap G (`.planning/parity-litfin/07-agency.md`):
 *   LITFIN's `computePlanHealth` returns a health score and flips
 *   `active→stalled` when `daysSinceLastAction >= 3`
 *   (`long-horizon-planner.ts:189-252,289-341`). BORJIE has no
 *   stall detection — goals stay `active` indefinitely even when no
 *   executor pass has moved a step for weeks.
 *
 * This module is a pure detector that scans `active` goals where the
 * last step activity timestamp is older than a per-goal stall
 * threshold and emits exactly three categorised proposals per
 * detected goal:
 *
 *     continue (default)  — the brain's recommendation; resume the
 *                           goal from the next pending step on the
 *                           next executor pass. Operator just clicks
 *                           "approve" to unblock.
 *     block               — pause the goal with an inferred reason
 *                           pulled from the latest failed step's
 *                           audit-error (or "no recent activity" when
 *                           no audit row is available).
 *     abandon             — terminate the goal as no-longer-relevant
 *                           (typical for stale arrears chases on
 *                           leases that have since paid in full).
 *
 * The proposals are NOT auto-executed. They are surfaced through the
 * injected `eventSink.emit('goal_stalled', ...)` port and (in the
 * gateway composition root) routed through the existing four-eye
 * approval system so a second human eye confirms the proposed
 * mitigation. The detector itself is storage-agnostic and side-effect-
 * free aside from the event emission.
 *
 * Property-management thresholds (overridable via `StallThresholds`):
 *
 *     lease-renewal goal       → 30 days
 *     maintenance-related goal →  7 days
 *     payment / arrears chase  → 14 days
 *     default                  →  7 days
 *
 * Match heuristics are deliberately fuzzy: the goal's title / step
 * tool-names are matched against keyword sets so the detector keeps
 * working even when callers do not tag goals with a "kind". When the
 * goal cannot be categorised it falls back to the default threshold.
 */

import type {
  Goal,
  GoalsPort,
  GoalStep,
} from './goals/types.js';
import { logger } from '../../logger.js';

export type StallProposalKind = 'continue' | 'block' | 'abandon';

export interface StallProposal {
  readonly kind: StallProposalKind;
  /** Short summary the approver UI shows. */
  readonly summary: string;
  /** Free-form rationale; for `block` this carries the inferred
   *  reason (latest step error / "no recent activity"). */
  readonly reason: string;
}

export interface StalledGoalReport {
  readonly tenantId: string;
  readonly goalId: string;
  readonly userId: string;
  readonly threadId: string;
  /** Number of days the goal has been inactive (rounded down). */
  readonly daysSinceLastActivity: number;
  /** Heuristically-inferred category — drives threshold + reason. */
  readonly category: StallCategory;
  readonly threshold: number;
  /** Default = `continue`; the other two are alternatives. The
   *  receiving system surfaces all three to the approver. */
  readonly proposals: ReadonlyArray<StallProposal>;
}

export type StallCategory =
  | 'lease-renewal'
  | 'maintenance'
  | 'payment-chase'
  | 'default';

export interface StallThresholds {
  readonly leaseRenewalDays?: number;
  readonly maintenanceDays?: number;
  readonly paymentChaseDays?: number;
  readonly defaultDays?: number;
}

export interface StallEventSink {
  emit(event: 'goal_stalled', payload: StalledGoalReport): Promise<void> | void;
}

/** Minimum audit-row shape the detector consumes. The Drizzle audit
 *  service can provide this verbatim; tests pass a hand-rolled stub. */
export interface StallAuditEntryShape {
  readonly goalId: string;
  readonly decision:
    | 'running'
    | 'done'
    | 'failed'
    | 'awaiting-approval'
    | 'skipped'
    | 'unknown-tool';
  readonly outcome: string | null;
  readonly errorMessage: string | null;
  readonly capturedAt: string;
}

export interface StallAuditReader {
  /** Newest-first list of audit rows for the given goal. The detector
   *  uses only the most-recent matching row to infer block reason. */
  listForGoal(
    goalId: string,
    limit: number,
  ): Promise<ReadonlyArray<StallAuditEntryShape>>;
}

export interface StallDetectorDeps {
  readonly goals: Pick<GoalsPort, 'list'>;
  readonly auditReader?: StallAuditReader;
  readonly eventSink?: StallEventSink;
  readonly thresholds?: StallThresholds;
  readonly clock?: () => Date;
}

export interface StallDetectorRunArgs {
  readonly tenantId: string;
  readonly userId: string;
  /** Hard cap on goals scanned per call. Defaults to 200. */
  readonly limit?: number;
}

export interface StallDetectorRunOutcome {
  readonly scanned: number;
  readonly stalled: ReadonlyArray<StalledGoalReport>;
}

const DEFAULT_THRESHOLDS: Required<StallThresholds> = {
  leaseRenewalDays: 30,
  maintenanceDays: 7,
  paymentChaseDays: 14,
  defaultDays: 7,
};
const DEFAULT_SCAN_LIMIT = 200;
const AUDIT_LOOKBACK_ROWS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LEASE_KEYWORDS = ['lease', 'renewal', 'tenancy'];
const MAINTENANCE_KEYWORDS = [
  'maintenance',
  'work-order',
  'workorder',
  'work_order',
  'inspection',
  'repair',
];
const PAYMENT_KEYWORDS = [
  'arrears',
  'payment',
  'collection',
  'rent',
  'invoice',
  'chase',
];

export function categoriseGoal(goal: Goal): StallCategory {
  const tokens: string[] = [];
  tokens.push(goal.title.toLowerCase(), goal.description.toLowerCase());
  for (const step of goal.steps) {
    if (step.toolName) tokens.push(step.toolName.toLowerCase());
    if (step.description) tokens.push(step.description.toLowerCase());
  }
  const blob = tokens.join(' | ');
  if (LEASE_KEYWORDS.some((kw) => blob.includes(kw))) return 'lease-renewal';
  if (PAYMENT_KEYWORDS.some((kw) => blob.includes(kw))) return 'payment-chase';
  if (MAINTENANCE_KEYWORDS.some((kw) => blob.includes(kw))) return 'maintenance';
  return 'default';
}

export function thresholdFor(
  category: StallCategory,
  overrides?: StallThresholds,
): number {
  const t = { ...DEFAULT_THRESHOLDS, ...(overrides ?? {}) };
  switch (category) {
    case 'lease-renewal':
      return t.leaseRenewalDays;
    case 'maintenance':
      return t.maintenanceDays;
    case 'payment-chase':
      return t.paymentChaseDays;
    case 'default':
    default:
      return t.defaultDays;
  }
}

/**
 * Compute the most-recent activity timestamp for a goal. Walks every
 * step, picks the latest of `endedAt` / `startedAt`, and falls back to
 * the goal's `updatedAt` when no step has run yet. Returns null when
 * no usable timestamp exists.
 */
export function lastActivityAt(goal: Goal): Date | null {
  let latest: Date | null = null;
  for (const step of goal.steps) {
    const candidates = [step.endedAt, step.startedAt];
    for (const c of candidates) {
      if (!c) continue;
      const d = new Date(c);
      if (Number.isNaN(d.getTime())) continue;
      if (!latest || d.getTime() > latest.getTime()) latest = d;
    }
  }
  if (latest) return latest;
  const updated = new Date(goal.updatedAt);
  return Number.isNaN(updated.getTime()) ? null : updated;
}

function daysBetween(now: Date, earlier: Date): number {
  return Math.max(0, Math.floor((now.getTime() - earlier.getTime()) / MS_PER_DAY));
}

function inferBlockReason(
  goal: Goal,
  daysSince: number,
  auditRows: ReadonlyArray<StallAuditEntryShape>,
): string {
  // Prefer the most recent failed / awaiting-approval audit row's
  // message — operators care about WHY the brain stopped.
  const meaningful = auditRows.find(
    (row) =>
      row.decision === 'failed' ||
      row.decision === 'awaiting-approval' ||
      row.decision === 'unknown-tool',
  );
  if (meaningful?.errorMessage) {
    return `latest audit: ${meaningful.errorMessage}`;
  }
  if (meaningful?.outcome) {
    return `latest audit: ${meaningful.decision} (${meaningful.outcome})`;
  }
  // Fall back to a step-status read.
  const blockingStep = goal.steps.find(
    (s) => s.status === 'failed' || s.status === 'running',
  );
  if (blockingStep?.errorMessage) {
    return `step ${blockingStep.seq} (${blockingStep.toolName ?? 'noop'}): ${blockingStep.errorMessage}`;
  }
  return `no recent activity for ${daysSince} days`;
}

function pendingStep(goal: Goal): GoalStep | null {
  return [...goal.steps]
    .sort((a, b) => a.seq - b.seq)
    .find((s) => s.status === 'pending') ?? null;
}

export async function runStallDetection(
  args: StallDetectorRunArgs,
  deps: StallDetectorDeps,
): Promise<StallDetectorRunOutcome> {
  if (!args.tenantId) return { scanned: 0, stalled: [] };
  const clock = deps.clock ?? (() => new Date());
  const now = clock();
  const limit = Math.max(1, Math.min(1000, args.limit ?? DEFAULT_SCAN_LIMIT));

  let activeGoals: ReadonlyArray<Goal> = [];
  try {
    activeGoals = await deps.goals.list({
      tenantId: args.tenantId,
      userId: args.userId,
      status: 'active',
      limit,
    });
  } catch (error) {
    // Listing failure is logged but never throws — the detector is a
    // background sweeper and one bad query should not stop the loop.
    logger.warn('stall-detector: goals.list failed', { error });
    return { scanned: 0, stalled: [] };
  }

  const stalled: StalledGoalReport[] = [];
  for (const goal of activeGoals) {
    const last = lastActivityAt(goal);
    if (!last) continue;
    const category = categoriseGoal(goal);
    const threshold = thresholdFor(category, deps.thresholds);
    const days = daysBetween(now, last);
    if (days < threshold) continue;

    let auditRows: ReadonlyArray<StallAuditEntryShape> = [];
    if (deps.auditReader) {
      try {
        auditRows = await deps.auditReader.listForGoal(
          goal.id,
          AUDIT_LOOKBACK_ROWS,
        );
      } catch (error) {
        logger.warn('stall-detector: auditReader.listForGoal failed', { error });
      }
    }

    const blockReason = inferBlockReason(goal, days, auditRows);
    const nextStep = pendingStep(goal);
    const continueSummary = nextStep
      ? `Continue goal — resume from step ${nextStep.seq} (${nextStep.toolName ?? 'no-tool'}).`
      : 'Continue goal — re-evaluate the plan on the next executor pass.';
    const proposals: ReadonlyArray<StallProposal> = [
      {
        kind: 'continue',
        summary: continueSummary,
        reason: `Goal has been inactive ${days} days (>= ${threshold}d ${category} threshold). Default action: resume.`,
      },
      {
        kind: 'block',
        summary: 'Pause goal until manually unblocked.',
        reason: blockReason,
      },
      {
        kind: 'abandon',
        summary: 'Abandon goal — no longer relevant.',
        reason: `Operator should confirm the underlying ${category} condition has resolved (e.g. lease ended, arrears cleared, work-order completed elsewhere).`,
      },
    ];

    const report: StalledGoalReport = {
      tenantId: goal.tenantId,
      goalId: goal.id,
      userId: goal.userId,
      threadId: goal.threadId,
      daysSinceLastActivity: days,
      category,
      threshold,
      proposals,
    };
    stalled.push(report);
    if (deps.eventSink) {
      try {
        await deps.eventSink.emit('goal_stalled', report);
      } catch (error) {
        logger.warn('stall-detector: eventSink.emit failed', { error });
      }
    }
  }

  return { scanned: activeGoals.length, stalled };
}
