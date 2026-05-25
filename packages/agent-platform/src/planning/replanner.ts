/**
 * Re-planner — given the original plan, completed records, and the
 * verifier's unmet deltas, asks the multi-LLM for a REVISED plan that
 * resolves the deltas. Increments the plan generation.
 *
 * Re-uses the planner's parsing + validation surface by composing
 * `buildPlan` with a delta-aware system prompt.
 */

import { buildPlan, type PlannerResult } from './planner.js';
import type {
  ExecutionRecord,
  MultiLlmSynthesizer,
  Plan,
  VerificationResult,
} from './types.js';

export interface ReplannerInput {
  readonly previousPlan: Plan;
  readonly records: ReadonlyArray<ExecutionRecord>;
  readonly verification: VerificationResult;
  readonly toolDirectory: ReadonlyArray<{ readonly name: string; readonly description: string }>;
}

export async function rebuildPlan(
  input: ReplannerInput,
  synthesizer: MultiLlmSynthesizer,
): Promise<PlannerResult> {
  const previousSummary = input.records
    .map((r) => `[${r.status}] ${r.toolName} (step=${r.stepId})`)
    .join('\n');
  const deltaSummary = input.verification.deltas
    .map((d) => `- ${d.description}` + (d.criterion ? ` (criterion: ${d.criterion})` : ''))
    .join('\n');

  const enrichedGoal =
    `${input.previousPlan.goal}\n\n` +
    `Previously executed:\n${previousSummary}\n\n` +
    `Unmet deltas to resolve:\n${deltaSummary}`;

  return buildPlan(
    {
      goal: enrichedGoal,
      toolDirectory: input.toolDirectory,
      knownCitations: input.previousPlan.planCitations,
      generation: input.previousPlan.generation + 1,
    },
    synthesizer,
  );
}
