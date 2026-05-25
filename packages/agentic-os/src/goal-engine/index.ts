/**
 * goal-engine — user intent → goal → subgoals → outcomes.
 *
 * The engine sequences:
 *
 *   1. parseIntent      — brain classifies the envelope
 *   2. composeGoal      — brain produces a structured Goal
 *   3. decomposeIntoSubgoals — brain partitions across capable agents
 *   4. executeGoal      — orchestrator runs subgoals + collects outcomes
 *
 * Each step is pure (no side-effects beyond brain calls and ports the
 * caller injects). Observations are emitted at every transition so the
 * loop in `observation-loop` can feed back into trust calibration and
 * reflection.
 */

import type {
  AgentMatch,
  BrainPort,
  CapabilityRegistryPort,
  Goal,
  GoalResult,
  IntentClassification,
  Observation,
  ObservationStorePort,
  RequestEnvelope,
  SubGoal,
  SubGoalResult,
} from '../types.js';
import {
  GoalDecompositionError,
  nowIso,
} from '../types.js';

// ============================================================================
// parseIntent
// ============================================================================

export interface ParseIntentArgs {
  readonly envelope: RequestEnvelope;
  readonly brain: BrainPort;
}

export async function parseIntent(
  args: ParseIntentArgs,
): Promise<IntentClassification> {
  return await args.brain.classifyIntent({ envelope: args.envelope });
}

// ============================================================================
// composeGoal
// ============================================================================

export interface ComposeGoalArgs {
  readonly envelope: RequestEnvelope;
  readonly intent: IntentClassification;
  readonly brain: BrainPort;
}

export async function composeGoal(args: ComposeGoalArgs): Promise<Goal> {
  return await args.brain.composeGoal({
    envelope: args.envelope,
    intent: args.intent,
  });
}

// ============================================================================
// decomposeIntoSubgoals
// ============================================================================

export interface DecomposeArgs {
  readonly goal: Goal;
  readonly brain: BrainPort;
  readonly capabilities: CapabilityRegistryPort;
  readonly candidates: ReadonlyArray<AgentMatch>;
}

export async function decomposeIntoSubgoals(
  args: DecomposeArgs,
): Promise<ReadonlyArray<SubGoal>> {
  if (args.candidates.length === 0) {
    throw new GoalDecompositionError(
      `goal ${args.goal.id} has no candidate agents`,
    );
  }
  const subGoals = await args.brain.decomposeGoal({
    goal: args.goal,
    candidates: args.candidates,
  });
  // Validate: every subGoal references an actual candidate + capability
  const candidateAgentIds = new Set(args.candidates.map((c) => c.agentId));
  for (const sg of subGoals) {
    if (!candidateAgentIds.has(sg.assignedAgentId)) {
      throw new GoalDecompositionError(
        `subgoal ${sg.id} assigned to unknown agent ${sg.assignedAgentId}`,
      );
    }
  }
  return subGoals;
}

// ============================================================================
// executeGoal
// ============================================================================

/**
 * Minimal duck-typed orchestrator the engine drives. Caller injects an
 * adapter wrapping `packages/agent-orchestrator` (or any other runner).
 */
export interface OrchestratorPort {
  runSubGoal(args: { readonly subGoal: SubGoal }): Promise<SubGoalResult>;
}

export interface ExecuteGoalArgs {
  readonly goal: Goal;
  readonly subGoals: ReadonlyArray<SubGoal>;
  readonly orchestrator: OrchestratorPort;
  readonly observations?: ObservationStorePort;
}

/**
 * Pure goal execution. Respects subGoal `dependsOn` edges (topological
 * waves) — independent subgoals run in parallel within a wave.
 */
export async function executeGoal(
  args: ExecuteGoalArgs,
): Promise<GoalResult> {
  const waves = topologicalWaves(args.subGoals);
  const results: SubGoalResult[] = [];

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (sg) => {
        await emit(args.observations, {
          kind: 'subgoal-assigned',
          tenantId: args.goal.tenantId,
          agentId: sg.assignedAgentId,
          goalId: args.goal.id,
          subGoalId: sg.id,
          detail: sg.description,
        });
        const r = await args.orchestrator.runSubGoal({ subGoal: sg });
        await emit(args.observations, {
          kind: 'capability-result',
          tenantId: args.goal.tenantId,
          agentId: sg.assignedAgentId,
          goalId: args.goal.id,
          subGoalId: sg.id,
          outcome: r.outcome,
          detail: r.reason,
        });
        return r;
      }),
    );
    results.push(...waveResults);
  }

  const successCriteriaMet = computeMetCriteria(args.goal, results);
  const successCriteriaMissed = args.goal.successCriteria
    .map((c) => c.id)
    .filter((id) => !successCriteriaMet.includes(id));

  const overall = aggregateOutcome(results, successCriteriaMissed);
  const totalLatencyMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  const totalCostUsdCents = results.reduce((acc, r) => acc + r.costUsdCents, 0);

  const result = Object.freeze<GoalResult>({
    goalId: args.goal.id,
    outcome: overall,
    subGoalResults: Object.freeze(results),
    successCriteriaMet,
    successCriteriaMissed,
    totalLatencyMs,
    totalCostUsdCents,
    completedAt: nowIso(),
  });

  await emit(args.observations, {
    kind: 'goal-completed',
    tenantId: args.goal.tenantId,
    goalId: args.goal.id,
    outcome: overall,
    detail: `met=${successCriteriaMet.length} missed=${successCriteriaMissed.length}`,
  });

  return result;
}

// ============================================================================
// internal helpers
// ============================================================================

function topologicalWaves(
  subGoals: ReadonlyArray<SubGoal>,
): ReadonlyArray<ReadonlyArray<SubGoal>> {
  const byId = new Map(subGoals.map((sg) => [sg.id, sg]));
  const done = new Set<string>();
  const waves: SubGoal[][] = [];
  let remaining = subGoals.slice();
  while (remaining.length > 0) {
    const wave = remaining.filter((sg) =>
      sg.dependsOn.every((d) => done.has(d) || !byId.has(d)),
    );
    if (wave.length === 0) {
      throw new GoalDecompositionError(
        `subgoal dependency cycle: ${remaining.map((r) => r.id).join(', ')}`,
      );
    }
    waves.push(wave);
    for (const sg of wave) done.add(sg.id);
    remaining = remaining.filter((sg) => !wave.includes(sg));
  }
  return waves;
}

function computeMetCriteria(
  goal: Goal,
  results: ReadonlyArray<SubGoalResult>,
): ReadonlyArray<string> {
  // Default: a criterion is met if no subgoal failed and at least one succeeded
  const anyFailed = results.some((r) => r.outcome === 'failure');
  const anySucceeded = results.some((r) => r.outcome === 'success');
  if (!anyFailed && anySucceeded) {
    return goal.successCriteria.map((c) => c.id);
  }
  return [];
}

function aggregateOutcome(
  results: ReadonlyArray<SubGoalResult>,
  missed: ReadonlyArray<string>,
): 'success' | 'partial' | 'failure' | 'escalated' {
  if (results.some((r) => r.outcome === 'escalated')) return 'escalated';
  if (results.every((r) => r.outcome === 'success') && missed.length === 0) {
    return 'success';
  }
  if (results.some((r) => r.outcome === 'failure')) return 'failure';
  return 'partial';
}

async function emit(
  store: ObservationStorePort | undefined,
  partial: Omit<Observation, 'id' | 'at'>,
): Promise<void> {
  if (!store) return;
  const observation: Observation = Object.freeze({
    id: `obs-${cryptoRandom()}`,
    at: nowIso(),
    ...partial,
  });
  await store.emit(observation);
}

function cryptoRandom(): string {
  // Avoid pulling crypto for tests — Math.random + timestamp is fine for ids
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
