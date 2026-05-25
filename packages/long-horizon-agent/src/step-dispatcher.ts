/**
 * Step dispatcher — Piece Q.
 *
 * Picks today's pending mission_steps for a tenant + mission and runs
 * each one via the Piece E action_runtime port (or the supplied
 * stub if E hasn't landed yet). Records the result back into the
 * mission_steps row, advances mission status if every step finished,
 * and accumulates cost into agency_missions.spent_minor_units.
 *
 * HITL gating:
 *   - HITL_HIGH      — every step needs explicit approval before run
 *   - HITL_MEDIUM    — only execute / check steps need approval
 *   - HITL_LOW       — only execute steps with risk_tier=HIGH need approval
 *   - AUTONOMOUS     — no per-step approval (mission risk_tier must be LOW)
 *
 * Approval is checked via the HitlGatewayPort, also injected at the
 * composition root. In tests we pass `alwaysApprove` / `neverApprove`
 * stubs.
 */

import {
  type AgencyMission,
  type MissionStep,
  type StepDispatchResult,
} from './types.js';

export interface ActionRuntimePort {
  /**
   * Run an action plan. Returns a result shape the dispatcher can
   * persist verbatim. When `actionPlanId` is null the runtime treats
   * the step as informational (plan / reflect / check) and emits a
   * minimal "ok" record.
   */
  run(args: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly step: MissionStep;
  }): Promise<{
    readonly status: 'completed' | 'blocked' | 'failed';
    readonly result: Record<string, unknown> | null;
    readonly durationMs: number;
    readonly costMinorUnits: number;
    readonly errorMessage: string | null;
  }>;
}

export interface HitlGatewayPort {
  /**
   * Return true if the step is approved for execution. Implementations
   * consult the autonomy-governance tables and the in-flight approval
   * inbox. Pure-function stubs in tests.
   */
  isApproved(args: {
    readonly tenantId: string;
    readonly mission: AgencyMission;
    readonly step: MissionStep;
  }): Promise<boolean>;
}

export interface StepDispatcherRepositoryPort {
  /** Read the mission header so we can branch on autonomy / risk tier. */
  readMission(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<AgencyMission | null>;

  /** All pending or in_progress steps scheduled today (or earlier). */
  readDueSteps(args: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly today: string;
  }): Promise<ReadonlyArray<MissionStep>>;

  /** Every step on the mission regardless of scheduled_for. Used for
      the post-dispatch rollup to decide mission completion. */
  readAllSteps(args: {
    readonly tenantId: string;
    readonly missionId: string;
  }): Promise<ReadonlyArray<MissionStep>>;

  /** Move a step into in_progress; increments attempts. */
  markStarted(args: {
    readonly tenantId: string;
    readonly stepId: string;
    readonly startedAt: string;
  }): Promise<void>;

  /** Terminal write — status, result_jsonb, completed_at. */
  markFinished(args: {
    readonly tenantId: string;
    readonly stepId: string;
    readonly status: MissionStep['status'];
    readonly resultJsonb: Record<string, unknown> | null;
    readonly completedAt: string;
  }): Promise<void>;

  /** Accumulate cost into the mission header. */
  incrementSpent(args: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly addMinorUnits: number;
  }): Promise<void>;

  /** Transition mission status (planning → active → completed …). */
  setMissionStatus(args: {
    readonly tenantId: string;
    readonly missionId: string;
    readonly status: AgencyMission['status'];
    readonly completedAt: string | null;
  }): Promise<void>;
}

export interface ClockPort {
  nowIso(): string;
  todayIso(): string;
}

export interface StepDispatcherDeps {
  readonly actionRuntime: ActionRuntimePort;
  readonly hitl: HitlGatewayPort;
  readonly repository: StepDispatcherRepositoryPort;
  readonly clock: ClockPort;
}

export interface DispatchMissionArgs {
  readonly tenantId: string;
  readonly missionId: string;
}

export interface DispatchMissionReport {
  readonly missionId: string;
  readonly dispatched: ReadonlyArray<StepDispatchResult>;
  readonly skippedAwaitingApproval: ReadonlyArray<string>;
  readonly missionFinished: boolean;
  readonly newMissionStatus: AgencyMission['status'] | null;
}

/**
 * Run one tenant + mission's due steps. Idempotent up to the level of
 * the underlying action_runtime — re-running a half-failed dispatch
 * advances any remaining pending steps but does not retry completed
 * ones.
 */
export async function dispatchMission(
  args: DispatchMissionArgs,
  deps: StepDispatcherDeps,
): Promise<DispatchMissionReport> {
  const mission = await deps.repository.readMission({
    tenantId: args.tenantId,
    missionId: args.missionId,
  });
  if (!mission) {
    return {
      missionId: args.missionId,
      dispatched: [],
      skippedAwaitingApproval: [],
      missionFinished: false,
      newMissionStatus: null,
    };
  }

  if (
    mission.status !== 'active' &&
    mission.status !== 'planning' &&
    mission.status !== 'paused'
  ) {
    return {
      missionId: args.missionId,
      dispatched: [],
      skippedAwaitingApproval: [],
      missionFinished: mission.status === 'completed',
      newMissionStatus: null,
    };
  }

  // Auto-activate if we're starting a mission that's still in planning
  // (planner finished, dispatcher sees the first due step).
  if (mission.status === 'planning') {
    await deps.repository.setMissionStatus({
      tenantId: args.tenantId,
      missionId: args.missionId,
      status: 'active',
      completedAt: null,
    });
  }

  const today = deps.clock.todayIso();
  const dueSteps = await deps.repository.readDueSteps({
    tenantId: args.tenantId,
    missionId: args.missionId,
    today,
  });

  const dispatched: StepDispatchResult[] = [];
  const skippedAwaitingApproval: string[] = [];

  for (const step of dueSteps) {
    // Each dispatch loop iteration re-reads the mission so a mid-loop
    // pause / abandon picked up at the next step.
    const liveMission =
      dispatched.length === 0
        ? mission
        : await deps.repository.readMission({
            tenantId: args.tenantId,
            missionId: args.missionId,
          });
    if (!liveMission) break;
    if (liveMission.status === 'paused' || liveMission.status === 'abandoned') {
      break;
    }

    if (needsApproval(liveMission, step)) {
      const approved = await deps.hitl.isApproved({
        tenantId: args.tenantId,
        mission: liveMission,
        step,
      });
      if (!approved) {
        skippedAwaitingApproval.push(step.id);
        continue;
      }
    }

    const startedAt = deps.clock.nowIso();
    await deps.repository.markStarted({
      tenantId: args.tenantId,
      stepId: step.id,
      startedAt,
    });

    let result: Awaited<ReturnType<ActionRuntimePort['run']>>;
    try {
      result = await deps.actionRuntime.run({
        tenantId: args.tenantId,
        missionId: args.missionId,
        step,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Unknown action runtime error';
      result = {
        status: 'failed',
        result: null,
        durationMs: 0,
        costMinorUnits: 0,
        errorMessage,
      };
    }

    const completedAt = deps.clock.nowIso();
    await deps.repository.markFinished({
      tenantId: args.tenantId,
      stepId: step.id,
      status: result.status,
      resultJsonb: result.result,
      completedAt,
    });

    if (result.costMinorUnits > 0) {
      await deps.repository.incrementSpent({
        tenantId: args.tenantId,
        missionId: args.missionId,
        addMinorUnits: result.costMinorUnits,
      });
    }

    dispatched.push({
      stepId: step.id,
      status: result.status,
      result: result.result,
      durationMs: result.durationMs,
      costMinorUnits: result.costMinorUnits,
      errorMessage: result.errorMessage,
    });
  }

  // Final mission status pass: if every step is terminal, transition to
  // completed (or failed if any failed). Otherwise leave the status as
  // active.
  const allSteps = await deps.repository.readAllSteps({
    tenantId: args.tenantId,
    missionId: args.missionId,
  });

  const completedAllSteps = allSteps.every(
    (s) =>
      s.status === 'completed' ||
      s.status === 'skipped' ||
      s.status === 'failed',
  );
  if (completedAllSteps && allSteps.length > 0) {
    const anyFailed = allSteps.some((s) => s.status === 'failed');
    const finalStatus: AgencyMission['status'] = anyFailed
      ? 'escalated'
      : 'completed';
    const completedAt =
      finalStatus === 'completed' ? deps.clock.nowIso() : null;
    await deps.repository.setMissionStatus({
      tenantId: args.tenantId,
      missionId: args.missionId,
      status: finalStatus,
      completedAt,
    });
    return {
      missionId: args.missionId,
      dispatched,
      skippedAwaitingApproval,
      missionFinished: true,
      newMissionStatus: finalStatus,
    };
  }

  return {
    missionId: args.missionId,
    dispatched,
    skippedAwaitingApproval,
    missionFinished: false,
    newMissionStatus: null,
  };
}

/**
 * Decide whether a step requires HITL approval before it runs given the
 * mission's autonomy + risk tier. Pure — exported for tests.
 */
export function needsApproval(
  mission: AgencyMission,
  step: MissionStep,
): boolean {
  switch (mission.autonomyTier) {
    case 'HITL_HIGH':
      return true;
    case 'HITL_MEDIUM':
      return step.stepKind === 'execute' || step.stepKind === 'check';
    case 'HITL_LOW':
      return (
        step.stepKind === 'execute' &&
        (mission.riskTier === 'HIGH' || mission.riskTier === 'SOVEREIGN')
      );
    case 'AUTONOMOUS':
      // AUTONOMOUS missions still get HITL on SOVEREIGN actions.
      return mission.riskTier === 'SOVEREIGN';
  }
}
