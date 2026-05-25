/**
 * Mission planner — Piece Q.
 *
 * Decomposes a high-level goal into an ordered array of mission_steps.
 * In production the kernel's plan-decomposer (ToT) + LATS search drives
 * the decomposition; here we accept a port so callers can wire either:
 *
 *   - The kernel's real `decomposePlan({objective, context, availableTools})`,
 *     wrapped by the api-gateway composition root.
 *   - A test fake / fixture that returns canned steps.
 *
 * Returns the persisted mission + steps via the supplied repository.
 * Both writes happen in a single repository.createMission call so the
 * adapter can transact them.
 */

import {
  planMissionInputSchema,
  type AgencyMission,
  type MissionStep,
  type PlannedStep,
  type PlanMissionInput,
  type PlanMissionOutput,
} from './types.js';

/**
 * Single planner port — wraps the kernel's plan-decomposer in production.
 * The decomposer must return at least one step; the planner enforces a
 * floor of one "plan" step so a goal that confuses the decomposer still
 * gets a reflective entry the assigning persona can review.
 */
export interface MissionPlannerPort {
  decompose(args: {
    readonly goal: string;
    readonly context: Readonly<Record<string, unknown>>;
    readonly tenantId: string;
  }): Promise<ReadonlyArray<PlannedStep>>;
}

/**
 * Persistence port — implemented by `packages/database` adapters.
 * Atomically writes the mission header + steps; raises on RLS denial.
 */
export interface MissionRepositoryPort {
  createMission(args: {
    readonly mission: Omit<AgencyMission, 'createdAt' | 'updatedAt' | 'completedAt'> & {
      readonly completedAt: string | null;
    };
    readonly steps: ReadonlyArray<Omit<MissionStep, 'createdAt'>>;
  }): Promise<PlanMissionOutput>;
}

/**
 * ID generator port — composition root injects the project's stable
 * id-factory (`cuid2` / `nanoid` etc). Defaulted in tests.
 */
export interface IdGeneratorPort {
  nextId(prefix: string): string;
}

/**
 * Clock port — wall clock injection so tests can advance time.
 */
export interface ClockPort {
  nowIso(): string;
}

export interface MissionPlannerDeps {
  readonly planner: MissionPlannerPort;
  readonly repository: MissionRepositoryPort;
  readonly ids: IdGeneratorPort;
  readonly clock: ClockPort;
}

/**
 * Lower bound on decomposed steps. If the planner returns fewer than
 * this many concrete steps we add a reflective "plan" step so the
 * dispatcher has something to record progress against.
 */
const MIN_STEPS = 1;

/**
 * Upper bound on decomposed steps. Above this the planner's output is
 * truncated — long missions are intentionally re-decomposable at each
 * checkpoint (the replan engine handles growing the plan back out).
 */
const MAX_STEPS = 32;

export async function planMission(
  rawInput: PlanMissionInput,
  deps: MissionPlannerDeps,
): Promise<PlanMissionOutput> {
  // Validate at the boundary — defensive against api-gateway callers.
  const input = planMissionInputSchema.parse(rawInput);

  const rawPlannedSteps = await deps.planner.decompose({
    goal: input.goal,
    context: input.context,
    tenantId: input.tenantId,
  });

  const plannedSteps = normalisePlannedSteps(rawPlannedSteps, input.goal);

  const now = deps.clock.nowIso();
  const missionId = deps.ids.nextId('mis');

  const mission: Omit<
    AgencyMission,
    'createdAt' | 'updatedAt' | 'completedAt'
  > & {
    readonly completedAt: string | null;
  } = {
    id: missionId,
    tenantId: input.tenantId,
    assignedByUserId: input.assignedByUserId,
    ownerPersonaId: input.ownerPersonaId,
    title: input.title,
    goal: input.goal,
    contextJsonb: input.context,
    expectedCompletionDate: input.constraints.expectedCompletionDate,
    riskTier: input.constraints.riskTier,
    autonomyTier: input.constraints.autonomyTier,
    status: 'planning',
    budgetMinorUnits: input.constraints.budgetMinorUnits,
    spentMinorUnits: 0,
    assetRefs: input.constraints.assetRefs,
    auditChainId: null,
    completedAt: null,
  };

  const steps: ReadonlyArray<Omit<MissionStep, 'createdAt'>> = plannedSteps.map(
    (planned) => ({
      id: deps.ids.nextId('mst'),
      tenantId: input.tenantId,
      missionId,
      ordinal: planned.ordinal,
      title: planned.title,
      description: planned.description,
      stepKind: planned.stepKind,
      actionPlanId: planned.actionPlanId,
      status: 'pending' as const,
      scheduledFor: planned.scheduledFor,
      attempts: 0,
      resultJsonb: null,
      startedAt: null,
      completedAt: null,
    }),
  );

  // Single composite write — adapter implementations transact these.
  const result = await deps.repository.createMission({
    mission: { ...mission },
    steps,
  });
  // Persist takes its own createdAt / updatedAt; we just relay the
  // returned mission shape to the caller.
  void now;
  return result;
}

/**
 * Enforce ordering, dedupe, truncation, minimum-step floor.
 *
 * Pure — exported for tests.
 */
export function normalisePlannedSteps(
  raw: ReadonlyArray<PlannedStep>,
  goal: string,
): ReadonlyArray<PlannedStep> {
  if (raw.length === 0) {
    return [
      {
        ordinal: 0,
        title: `Plan approach for: ${goal.slice(0, 60)}`,
        description:
          'Decomposer returned no concrete steps; placeholder reflective step inserted so the dispatcher can record progress.',
        stepKind: 'plan',
        actionPlanId: null,
        scheduledFor: null,
      },
    ];
  }

  // Sort by caller-supplied ordinal, then dedupe identical (title, kind)
  // pairs that the decomposer sometimes emits, then renumber 0..N-1.
  const sorted = [...raw].sort((a, b) => a.ordinal - b.ordinal);
  const seen = new Set<string>();
  const deduped: PlannedStep[] = [];
  for (const step of sorted) {
    const key = `${step.stepKind}::${step.title.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(step);
  }

  const truncated = deduped.slice(0, MAX_STEPS);

  // Renumber so ordinals are dense + zero-based regardless of decomposer
  // output.
  const renumbered = truncated.map((step, index) => ({
    ...step,
    ordinal: index,
  }));

  if (renumbered.length < MIN_STEPS) {
    // Should be unreachable given the rawLength===0 branch but defensive.
    return [
      {
        ordinal: 0,
        title: `Plan approach for: ${goal.slice(0, 60)}`,
        description: null,
        stepKind: 'plan',
        actionPlanId: null,
        scheduledFor: null,
      },
    ];
  }

  return renumbered;
}
