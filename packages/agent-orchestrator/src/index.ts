/**
 * @borjie/agent-orchestrator — public barrel.
 *
 * Stable surface for application code. Sub-paths
 * (`./single-agent`, `./multi-agent`, etc.) expose the per-subsystem
 * APIs when you need only one slice.
 */

export * from './types.js';
export * as singleAgent from './single-agent/index.js';
export * as multiAgent from './multi-agent/index.js';
export * as stateMachine from './state-machine/index.js';
export * as costOptimization from './cost-optimization/index.js';
export * as durableExecution from './durable-execution/index.js';
export * as toolCalling from './tool-calling/index.js';
export * as judgeJury from './judge-jury/index.js';

import type {
  AgentSpec,
  BrainPort,
  BudgetSpec,
} from './types.js';
import {
  wrapWithBudget,
  type BudgetedBrain,
} from './cost-optimization/budget.js';
import {
  wrapAsDurable,
  createInMemoryDurableStore,
  type DurableStore,
} from './durable-execution/index.js';
import {
  createJudgePanel,
  type Judge,
  type JudgeRubricCriterion,
  type JudgeRuntime,
} from './judge-jury/judge-panel.js';

export interface CreateOrchestratorInput {
  readonly brain: BrainPort;
  readonly agents?: ReadonlyArray<AgentSpec>;
  readonly costPolicy?: { readonly budget?: Partial<BudgetSpec> };
  readonly durable?: { readonly enabled: boolean; readonly store?: DurableStore<unknown> };
  readonly judges?: { readonly judges: ReadonlyArray<Judge>; readonly rubric: ReadonlyArray<JudgeRubricCriterion> };
}

export interface Orchestrator {
  readonly brain: BrainPort;
  readonly budgeted: BudgetedBrain | null;
  readonly agentMap: ReadonlyMap<string, AgentSpec>;
  readonly judgePanel: JudgeRuntime | null;
  readonly durableStore: DurableStore<unknown> | null;
}

/**
 * Compose the orchestrator's runtime ports. Convenience facade; for
 * fine-grained control, import the per-subsystem factories directly.
 */
export function createOrchestrator(input: CreateOrchestratorInput): Orchestrator {
  const budgeted = input.costPolicy?.budget
    ? wrapWithBudget({ brain: input.brain, budget: input.costPolicy.budget })
    : null;
  const brain = budgeted?.brain ?? input.brain;
  const agentMap = new Map((input.agents ?? []).map((a) => [a.id, a]));
  const judgePanel = input.judges
    ? createJudgePanel({
        brain,
        judges: input.judges.judges,
        rubric: input.judges.rubric,
      })
    : null;
  const durableStore = input.durable?.enabled
    ? input.durable.store ?? createInMemoryDurableStore<unknown>()
    : null;
  return Object.freeze({
    brain,
    budgeted,
    agentMap,
    judgePanel,
    durableStore,
  });
}

export { wrapAsDurable };
