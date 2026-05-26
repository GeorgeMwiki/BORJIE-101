/**
 * Plan runner — iterates the steps of a ResearchPlan.
 *
 * Per DEEP_RESEARCH_SPEC §4.2 (Executor) + §10 (long-running session
 * model), the plan runner:
 *
 *   1. Marks the plan `running` via PlanRepository.
 *   2. Iterates steps in seq order (with optional within-budget
 *      parallelism for the Anticipatory Sweep mode).
 *   3. For each step: persists started_at, invokes the step-runner,
 *      persists artifacts, persists finished_at + cost + duration.
 *   4. Calls the checkpointer after every step so a crash mid-plan
 *      resumes from the last completed step (§10).
 *   5. Pauses when the budget gate hits owner-confirm or latency.
 *   6. Returns the aggregated PlanRunSummary.
 *
 * The runner is also the boundary that emits per-step structured logs
 * via the injected logger — so a tail of the worker process shows
 * exactly which step ran, how much it cost, and how long it took.
 *
 * @module research-orchestrator/executor/plan-runner
 */

import type {
  ResearchArtifact,
  ResearchPlan,
  ResearchStep,
} from '../types.js';
import type { BudgetGate } from '../budgets/budget-gate.js';
import { runStep, type StepRunResult, type ToolRegistry } from './step-runner.js';
import type { OrchestratorLogger } from '../types.js';
import { checkpointAfterStep, type StepCheckpointer } from './long-running-checkpoint.js';

export interface PlanRunSummary {
  readonly plan_id: string;
  readonly status: 'complete' | 'paused' | 'failed';
  readonly steps_completed: number;
  readonly steps_failed: number;
  readonly steps_skipped: number;
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  readonly total_cost_usd_cents: number;
  readonly total_duration_ms: number;
  readonly paused_reason?: 'budget_exhausted' | 'latency_exceeded' | 'owner_confirm';
}

export interface PlanRunHooks {
  /** Called when a step starts. */
  onStepStart?(step: ResearchStep): Promise<void> | void;
  /** Called when a step completes (success, failure, or skip). */
  onStepComplete?(step: ResearchStep, result: StepRunResult): Promise<void> | void;
  /** Called after persistence to checkpoint state. */
  checkpointer?: StepCheckpointer;
}

export interface RunPlanInput {
  readonly plan: ResearchPlan;
  readonly registry: ToolRegistry;
  readonly budgetGate: BudgetGate;
  readonly toolContextFactory: (step: ResearchStep) => Parameters<ToolRegistryAccessor>[0];
  readonly logger?: OrchestratorLogger;
  readonly hooks?: PlanRunHooks;
  /** When true, the runner emits steps in parallel for sweep mode. */
  readonly parallel?: boolean;
  /** Override the wall-clock for tests. */
  readonly now?: () => number;
}

// Helper alias for the factory return type — keeps signatures readable.
type ToolRegistryAccessor = (ctx: import('../types.js').ToolContext) => unknown;

/**
 * Execute every step in a plan, honouring the budget gate. Returns a
 * summary; the caller writes the plan's final status via
 * PlanRepository.update().
 */
export async function runPlan(input: RunPlanInput): Promise<PlanRunSummary> {
  input.budgetGate.start();
  const allArtifacts: Array<ResearchArtifact> = [];
  let stepsCompleted = 0;
  let stepsFailed = 0;
  let stepsSkipped = 0;
  let totalCost = 0;
  let pausedReason: PlanRunSummary['paused_reason'] | undefined;

  const sortedSteps = [...input.plan.steps].sort((a, b) => a.seq - b.seq);

  if (input.parallel === true) {
    const results = await Promise.all(
      sortedSteps.map((step) =>
        runOne(step, input, allArtifacts, (r) => {
          totalCost += r.cost_usd_cents;
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'done') stepsCompleted += 1;
      else if (r.status === 'failed') stepsFailed += 1;
      else if (r.status === 'skipped') stepsSkipped += 1;
    }
  } else {
    // Sequential — respect budget gate between steps and pause cleanly.
    for (const step of sortedSteps) {
      if (input.budgetGate.isLatencyExceeded()) {
        pausedReason = 'latency_exceeded';
        break;
      }
      const spent = await input.budgetGate.tracker.spent();
      if (input.budgetGate.shouldPauseForOwner(spent)) {
        pausedReason = 'owner_confirm';
        break;
      }
      if (spent >= input.budgetGate.tracker.budget()) {
        pausedReason = 'budget_exhausted';
        break;
      }
      const result = await runOne(step, input, allArtifacts, (r) => {
        totalCost += r.cost_usd_cents;
      });
      if (result.status === 'done') stepsCompleted += 1;
      else if (result.status === 'failed') stepsFailed += 1;
      else if (result.status === 'skipped') stepsSkipped += 1;
    }
  }

  return {
    plan_id: input.plan.id,
    status: pausedReason ? 'paused' : stepsFailed > 0 && stepsCompleted === 0 ? 'failed' : 'complete',
    steps_completed: stepsCompleted,
    steps_failed: stepsFailed,
    steps_skipped: stepsSkipped,
    artifacts: Object.freeze(allArtifacts),
    total_cost_usd_cents: totalCost,
    total_duration_ms: input.budgetGate.elapsedMs(),
    ...(pausedReason ? { paused_reason: pausedReason } : {}),
  };
}

async function runOne(
  step: ResearchStep,
  input: RunPlanInput,
  allArtifacts: Array<ResearchArtifact>,
  onCost: (r: StepRunResult) => void,
): Promise<StepRunResult> {
  await input.hooks?.onStepStart?.(step);
  input.logger?.info({ step_id: step.id, seq: step.seq, tool: step.tool }, 'research: step start');

  const toolCtxRaw = input.toolContextFactory(step);
  const toolCtx = toolCtxRaw as unknown as import('../types.js').ToolContext;

  const result = await runStep({
    step,
    registry: input.registry,
    toolContext: toolCtx,
    budgetGate: input.budgetGate,
    ...(input.now ? { now: input.now } : {}),
  });

  onCost(result);
  for (const a of result.artifacts) allArtifacts.push(a);

  await input.hooks?.onStepComplete?.(step, result);
  if (input.hooks?.checkpointer) {
    await checkpointAfterStep({
      checkpointer: input.hooks.checkpointer,
      plan_id: input.plan.id,
      step_id: step.id,
      step_seq: step.seq,
      result,
    });
  }

  input.logger?.info(
    {
      step_id: step.id,
      seq: step.seq,
      tool: step.tool,
      status: result.status,
      cost_cents: result.cost_usd_cents,
      duration_ms: result.duration_ms,
      artifacts: result.artifacts.length,
    },
    'research: step complete',
  );

  return result;
}
