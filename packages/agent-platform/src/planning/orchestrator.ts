/**
 * Plan-and-Execute orchestrator — composes planner → DAG batcher →
 * worker-runner → verifier → re-planner (bounded) into the public
 * `runPlanExecute(...)` entrypoint.
 *
 * Pure orchestration. All side-effecting ports (LLM, tool execution,
 * audit storage) are injected.
 *
 * Loop:
 *   1. plan
 *   2. validate DAG
 *   3. for each batch: runBatch + record
 *   4. verify
 *   5. if verified at confidence >= threshold → done
 *   6. else if maxReplans not exceeded → re-plan and goto 2
 *   7. else → abandoned
 */

import { validatePlanDag } from './dag.js';
import { buildPlan, type PlannerResult } from './planner.js';
import { rebuildPlan } from './replanner.js';
import { runBatch } from './worker-runner.js';
import { verifyGoal } from './verifier.js';
import { nextEntryId } from './audit-trail.js';
import {
  DEFAULT_PLAN_EXECUTE_CONFIG,
  type AuditSink,
  type ExecutionRecord,
  type MultiLlmSynthesizer,
  type Plan,
  type PlanExecuteConfig,
  type StepExecutor,
  type VerificationResult,
} from './types.js';

export interface RunPlanExecuteInput {
  readonly goal: string;
  readonly toolDirectory: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly synthesizer: MultiLlmSynthesizer;
  readonly executor: StepExecutor;
  readonly audit: AuditSink;
  readonly config?: Partial<PlanExecuteConfig>;
}

export type RunPlanExecuteResult =
  | {
      readonly ok: true;
      readonly outcome: 'goal-achieved';
      readonly plan: Plan;
      readonly records: ReadonlyArray<ExecutionRecord>;
      readonly verification: VerificationResult;
    }
  | {
      readonly ok: false;
      readonly outcome: 'goal-abandoned' | 'plan-invalid' | 'planner-error';
      readonly plan?: Plan;
      readonly records?: ReadonlyArray<ExecutionRecord>;
      readonly verification?: VerificationResult;
      readonly detail: string;
    };

export async function runPlanExecute(
  input: RunPlanExecuteInput,
): Promise<RunPlanExecuteResult> {
  const config: PlanExecuteConfig = { ...DEFAULT_PLAN_EXECUTE_CONFIG, ...(input.config ?? {}) };

  // 1. Initial plan.
  let plannerResult: PlannerResult = await buildPlan(
    {
      goal: input.goal,
      toolDirectory: input.toolDirectory,
      generation: 1,
    },
    input.synthesizer,
  );
  if (!plannerResult.ok) {
    return {
      ok: false,
      outcome: 'planner-error',
      detail: `planner failed: ${plannerResult.error.kind}`,
    };
  }
  let plan: Plan = plannerResult.plan;
  await input.audit.append({
    entryId: nextEntryId(),
    kind: 'plan_created',
    at: new Date().toISOString(),
    payload: { planId: plan.id, generation: plan.generation, stepCount: plan.steps.length },
  });

  const allRecords: ExecutionRecord[] = [];
  let lastVerification: VerificationResult | undefined;

  // 2. Plan-Execute-Verify loop, bounded by maxReplans.
  for (let attempt = 0; attempt <= config.maxReplans; attempt++) {
    // 2a. Validate the DAG.
    const dagResult = validatePlanDag(plan);
    if (!dagResult.ok) {
      return {
        ok: false,
        outcome: 'plan-invalid',
        plan,
        detail: `${dagResult.error.kind}: ${dagResult.error.detail}`,
      };
    }

    // 2b. Run batches sequentially; inside each batch run steps in parallel.
    const records: ExecutionRecord[] = [];
    for (const batch of dagResult.batches) {
      const batchRecords = await runBatch(batch, input.executor, input.audit, {
        maxParallelism: config.maxParallelism,
      });
      for (const r of batchRecords) records.push(r);
    }
    for (const r of records) allRecords.push(r);

    // 2c. Verify.
    const verification = await verifyGoal(plan, records, input.synthesizer);
    lastVerification = verification;
    await input.audit.append({
      entryId: nextEntryId(),
      kind: 'verification',
      at: new Date().toISOString(),
      payload: verification,
    });

    if (verification.goalAchieved && verification.confidence >= config.verifierConfidenceThreshold) {
      await input.audit.append({
        entryId: nextEntryId(),
        kind: 'goal_achieved',
        at: new Date().toISOString(),
        payload: { planId: plan.id, confidence: verification.confidence },
      });
      return {
        ok: true,
        outcome: 'goal-achieved',
        plan,
        records: Object.freeze(allRecords),
        verification,
      };
    }

    if (attempt >= config.maxReplans) break;

    // 2d. Re-plan.
    plannerResult = await rebuildPlan(
      {
        previousPlan: plan,
        records,
        verification,
        toolDirectory: input.toolDirectory,
      },
      input.synthesizer,
    );
    if (!plannerResult.ok) {
      return {
        ok: false,
        outcome: 'planner-error',
        plan,
        records: Object.freeze(allRecords),
        verification,
        detail: `re-planner failed: ${plannerResult.error.kind}`,
      };
    }
    plan = plannerResult.plan;
    await input.audit.append({
      entryId: nextEntryId(),
      kind: 'plan_replanned',
      at: new Date().toISOString(),
      payload: { planId: plan.id, generation: plan.generation, stepCount: plan.steps.length },
    });
  }

  await input.audit.append({
    entryId: nextEntryId(),
    kind: 'goal_abandoned',
    at: new Date().toISOString(),
    payload: {
      planId: plan.id,
      finalConfidence: lastVerification?.confidence ?? 0,
      finalDeltas: lastVerification?.deltas ?? [],
    },
  });

  // exactOptionalPropertyTypes: never assign `verification: undefined`;
  // omit the key entirely when no verification has run.
  return lastVerification
    ? {
        ok: false,
        outcome: 'goal-abandoned',
        plan,
        records: Object.freeze(allRecords),
        verification: lastVerification,
        detail: `goal not achieved after ${config.maxReplans} re-plans`,
      }
    : {
        ok: false,
        outcome: 'goal-abandoned',
        plan,
        records: Object.freeze(allRecords),
        detail: `goal not achieved after ${config.maxReplans} re-plans`,
      };
}
