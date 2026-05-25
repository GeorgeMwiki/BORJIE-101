/**
 * Replan engine — Piece Q.
 *
 * Given a drift signal the checkpoint runner just persisted, decide
 * whether the plan needs to mutate, propose the mutation, and either
 * (a) apply autonomously (when autonomy_tier permits) or (b) park it
 * for HITL approval. Every mutation writes a row to mission_drift_log.
 *
 * Replan recipes (deterministic — exported for tests):
 *   - step_replan       → insert a "reflect" + a fresh "plan" step
 *                         before the stuck one; mark the stuck step
 *                         skipped.
 *   - deadline_slip     → push expected_completion_date out by N days
 *                         (N = remaining_pending_steps).
 *   - budget_overrun    → emit a 'budget_overrun' drift event but
 *                         never adjusts the budget; the assigner must.
 *   - external_blocker  → mark mission paused; assigner must intervene.
 *   - goal_shift        → never auto-handled; HITL only.
 *
 * Autonomy gating mirrors step-dispatcher.needsApproval but for
 * REPLAN-level mutations:
 *   - AUTONOMOUS + risk_tier=LOW   → auto-apply all but goal_shift
 *   - HITL_LOW                     → auto-apply only step_replan
 *   - HITL_MEDIUM                  → no auto-apply
 *   - HITL_HIGH                    → no auto-apply
 */

import {
  type AgencyMission,
  type DriftSignal,
  type DriftKind,
  type MissionDriftEvent,
  type MissionStep,
  type PlannedStep,
} from './types.js';

export interface ReplanRepositoryPort {
  readMission(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<AgencyMission | null>;

  readAllSteps(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<ReadonlyArray<MissionStep>>;

  /**
   * Insert new steps + mark a single step skipped in one transaction.
   * The action_plan_id pointer on inserted steps may be null when
   * Piece E hasn't been wired yet.
   */
  applyReplan(args: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly insertSteps: ReadonlyArray<Omit<MissionStep, 'createdAt'>>;
    readonly skipStepIds: ReadonlyArray<string>;
    readonly newExpectedCompletionDate: string | null;
    readonly newStatus: AgencyMission['status'] | null;
  }): Promise<void>;

  insertDriftEvent(
    event: Omit<MissionDriftEvent, 'createdAt'>,
  ): Promise<void>;
}

export interface IdGeneratorPort {
  nextId(prefix: string): string;
}

export interface ClockPort {
  nowIso(): string;
}

export interface ReplanEngineDeps {
  readonly repository: ReplanRepositoryPort;
  readonly ids: IdGeneratorPort;
  readonly clock: ClockPort;
}

export interface HandleDriftArgs {
  readonly tenantId: string;
  readonly missionId: string;
  readonly signal: DriftSignal;
  /**
   * When provided the engine treats the user as the approver; otherwise
   * it consults the mission's autonomy_tier.
   */
  readonly forceApprovedByUserId?: string;
}

export interface ReplanReport {
  readonly action: 'auto-applied' | 'queued-for-hitl' | 'no-op';
  readonly driftEventId: string;
  readonly inserted: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

export async function handleDrift(
  args: HandleDriftArgs,
  deps: ReplanEngineDeps,
): Promise<ReplanReport> {
  const mission = await deps.repository.readMission({
    tenantId: args.tenantId,
    missionId: args.missionId,
  });
  if (!mission) {
    return {
      action: 'no-op',
      driftEventId: '',
      inserted: [],
      skipped: [],
    };
  }

  const driftKind = mapSignalToKind(args.signal.kind);
  if (!driftKind) {
    return {
      action: 'no-op',
      driftEventId: '',
      inserted: [],
      skipped: [],
    };
  }

  const autoApprove =
    args.forceApprovedByUserId !== undefined ||
    canAutoApply(mission, driftKind);

  const steps = await deps.repository.readAllSteps({
    tenantId: args.tenantId,
    missionId: args.missionId,
  });

  const driftEventId = deps.ids.nextId('drf');
  const nowIso = deps.clock.nowIso();

  if (!autoApprove) {
    // Park drift event without mutating plan; assigner reviews.
    await deps.repository.insertDriftEvent({
      id: driftEventId,
      tenantId: args.tenantId,
      missionId: args.missionId,
      driftKind,
      description: args.signal.message,
      beforeJsonb: snapshotBefore(mission, steps, driftKind),
      afterJsonb: null,
      detectedBy: 'self',
      approvedByUserId: null,
      approvedAt: null,
    });
    return {
      action: 'queued-for-hitl',
      driftEventId,
      inserted: [],
      skipped: [],
    };
  }

  // Apply the deterministic recipe.
  const recipe = composeRecipe({
    driftKind,
    mission,
    steps,
    signal: args.signal,
    ids: deps.ids,
    nowIso,
  });

  await deps.repository.applyReplan({
    tenantId: args.tenantId,
    missionId: args.missionId,
    insertSteps: recipe.insertSteps,
    skipStepIds: recipe.skipStepIds,
    newExpectedCompletionDate: recipe.newExpectedCompletionDate,
    newStatus: recipe.newStatus,
  });

  await deps.repository.insertDriftEvent({
    id: driftEventId,
    tenantId: args.tenantId,
    missionId: args.missionId,
    driftKind,
    description: args.signal.message,
    beforeJsonb: snapshotBefore(mission, steps, driftKind),
    afterJsonb: snapshotAfter(recipe),
    detectedBy: 'self',
    approvedByUserId: args.forceApprovedByUserId ?? null,
    approvedAt: args.forceApprovedByUserId !== undefined ? nowIso : nowIso,
  });

  return {
    action: 'auto-applied',
    driftEventId,
    inserted: recipe.insertSteps.map((s) => s.id),
    skipped: [...recipe.skipStepIds],
  };
}

/**
 * Map a `DriftSignal.kind` string to a `DriftKind` enum value. Returns
 * null for unsupported kinds (forwards-compat — the detector may emit
 * new kinds the engine doesn't know yet).
 */
function mapSignalToKind(kind: string): DriftKind | null {
  switch (kind) {
    case 'deadline_slip':
      return 'deadline_slip';
    case 'budget_overrun':
      return 'budget_overrun';
    case 'step_replan':
      return 'step_replan';
    case 'external_blocker':
      return 'external_blocker';
    case 'goal_shift':
      return 'goal_shift';
    default:
      return null;
  }
}

/**
 * Decide whether the engine can auto-apply this drift kind given the
 * mission's autonomy tier. Pure — exported for tests.
 */
export function canAutoApply(
  mission: AgencyMission,
  driftKind: DriftKind,
): boolean {
  // goal_shift is HITL-only — period.
  if (driftKind === 'goal_shift') return false;

  // Budget mutations are not the engine's job — emit a drift event but
  // never silently adjust the budget. The assigner intervenes.
  if (driftKind === 'budget_overrun') return false;

  // SOVEREIGN-risk missions always need HITL.
  if (mission.riskTier === 'SOVEREIGN') return false;

  switch (mission.autonomyTier) {
    case 'HITL_HIGH':
      return false;
    case 'HITL_MEDIUM':
      return false;
    case 'HITL_LOW':
      // Only step_replan auto-applies; everything else is HITL.
      return driftKind === 'step_replan';
    case 'AUTONOMOUS':
      // External blockers still need a human to unblock, but the engine
      // can pause the mission autonomously.
      return mission.riskTier === 'LOW';
  }
}

interface ReplanRecipe {
  readonly insertSteps: ReadonlyArray<Omit<MissionStep, 'createdAt'>>;
  readonly skipStepIds: ReadonlyArray<string>;
  readonly newExpectedCompletionDate: string | null;
  readonly newStatus: AgencyMission['status'] | null;
}

interface ComposeRecipeArgs {
  readonly driftKind: DriftKind;
  readonly mission: AgencyMission;
  readonly steps: ReadonlyArray<MissionStep>;
  readonly signal: DriftSignal;
  readonly ids: IdGeneratorPort;
  readonly nowIso: string;
}

/**
 * Pure recipe composer — returns the planned mutation given the drift
 * kind. Exported for tests.
 */
export function composeRecipe(args: ComposeRecipeArgs): ReplanRecipe {
  switch (args.driftKind) {
    case 'step_replan': {
      const stuckStepId =
        typeof args.signal.details['stepId'] === 'string'
          ? (args.signal.details['stepId'] as string)
          : null;
      if (!stuckStepId) {
        return emptyRecipe();
      }
      const stuck = args.steps.find((s) => s.id === stuckStepId);
      if (!stuck) return emptyRecipe();

      const insertOrdinal = stuck.ordinal;
      const reflectStep: Omit<MissionStep, 'createdAt'> = {
        id: args.ids.nextId('mst'),
        tenantId: stuck.tenantId,
        missionId: stuck.missionId,
        ordinal: insertOrdinal,
        title: `Reflect on stuck step: ${stuck.title}`,
        description: `Auto-inserted by replan engine after ${stuck.attempts} attempts.`,
        stepKind: 'reflect',
        actionPlanId: null,
        status: 'pending',
        scheduledFor: null,
        attempts: 0,
        resultJsonb: null,
        startedAt: null,
        completedAt: null,
      };
      const newPlanStep: Omit<MissionStep, 'createdAt'> = {
        id: args.ids.nextId('mst'),
        tenantId: stuck.tenantId,
        missionId: stuck.missionId,
        ordinal: insertOrdinal + 1,
        title: `Re-plan from drift: ${stuck.title}`,
        description: 'Compose a fresh approach to the original objective.',
        stepKind: 'plan',
        actionPlanId: null,
        status: 'pending',
        scheduledFor: null,
        attempts: 0,
        resultJsonb: null,
        startedAt: null,
        completedAt: null,
      };
      return {
        insertSteps: [reflectStep, newPlanStep],
        skipStepIds: [stuck.id],
        newExpectedCompletionDate: null,
        newStatus: null,
      };
    }
    case 'deadline_slip': {
      const remainingDays = args.steps.filter(
        (s) => s.status === 'pending' || s.status === 'in_progress',
      ).length;
      if (remainingDays === 0) {
        return emptyRecipe();
      }
      const base = args.mission.expectedCompletionDate
        ? new Date(args.mission.expectedCompletionDate)
        : new Date(args.nowIso);
      // Push out by remainingDays * 1 day from "max(now, base)".
      const now = new Date(args.nowIso);
      const reference = base.getTime() > now.getTime() ? base : now;
      const shifted = new Date(reference);
      shifted.setUTCDate(shifted.getUTCDate() + remainingDays);
      const newDateIso = shifted.toISOString().slice(0, 10);
      return {
        insertSteps: [],
        skipStepIds: [],
        newExpectedCompletionDate: newDateIso,
        newStatus: null,
      };
    }
    case 'budget_overrun': {
      // Never auto-applied; canAutoApply returns false. Kept for
      // exhaustiveness so future autonomy tiers can change the policy.
      return emptyRecipe();
    }
    case 'external_blocker': {
      return {
        insertSteps: [],
        skipStepIds: [],
        newExpectedCompletionDate: null,
        newStatus: 'paused',
      };
    }
    case 'goal_shift': {
      return emptyRecipe();
    }
  }
}

function emptyRecipe(): ReplanRecipe {
  return {
    insertSteps: [],
    skipStepIds: [],
    newExpectedCompletionDate: null,
    newStatus: null,
  };
}

function snapshotBefore(
  mission: AgencyMission,
  steps: ReadonlyArray<MissionStep>,
  driftKind: DriftKind,
): Record<string, unknown> {
  if (driftKind === 'step_replan') {
    return {
      steps: steps.map((s) => ({
        id: s.id,
        ordinal: s.ordinal,
        title: s.title,
        status: s.status,
        attempts: s.attempts,
      })),
    };
  }
  if (driftKind === 'deadline_slip') {
    return {
      expectedCompletionDate: mission.expectedCompletionDate,
    };
  }
  if (driftKind === 'budget_overrun') {
    return {
      budget: mission.budgetMinorUnits,
      spent: mission.spentMinorUnits,
    };
  }
  if (driftKind === 'external_blocker') {
    return {
      status: mission.status,
    };
  }
  return {};
}

function snapshotAfter(recipe: ReplanRecipe): Record<string, unknown> {
  return {
    insertedStepCount: recipe.insertSteps.length,
    skippedStepIds: recipe.skipStepIds,
    newExpectedCompletionDate: recipe.newExpectedCompletionDate,
    newStatus: recipe.newStatus,
  };
}

/**
 * Helper that the cron uses to convert a planner output into the
 * replan engine's PlannedStep shape — kept here so cron stays thin.
 */
export function plannedStepsToInsertSteps(
  planned: ReadonlyArray<PlannedStep>,
  ctx: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly ids: IdGeneratorPort;
  },
): ReadonlyArray<Omit<MissionStep, 'createdAt'>> {
  return planned.map((p) => ({
    id: ctx.ids.nextId('mst'),
    tenantId: ctx.tenantId,
    missionId: ctx.missionId,
    ordinal: p.ordinal,
    title: p.title,
    description: p.description,
    stepKind: p.stepKind,
    actionPlanId: p.actionPlanId,
    status: 'pending' as const,
    scheduledFor: p.scheduledFor,
    attempts: 0,
    resultJsonb: null,
    startedAt: null,
    completedAt: null,
  }));
}
