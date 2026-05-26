/**
 * Anticipatory Sweep mode — DEEP_RESEARCH_SPEC §3.2.
 *
 * Mr. Mwikila detects an intent and pre-researches the next 3
 * questions the owner is likely to ask. Runs in parallel with the chat
 * response; output cached for instant follow-up.
 *
 * Latency: ≤30 s (runs in background, never blocks owner).
 * Cost: ≤$0.10 per sweep.
 *
 * UX: pre-cached. When the owner asks the predicted follow-up, the
 * answer is served from cache with a "researched ahead" badge.
 *
 * Steps: 3 parallel plans, each capped at 3 steps.
 *
 * @module research-orchestrator/modes/anticipatory-sweep
 */

import { buildPlan } from '../planner/plan-builder.js';
import { validatePlan } from '../planner/plan-validator.js';
import { runPlan } from '../executor/plan-runner.js';
import { synthesizeAnswer } from '../synthesizer/answer-synthesizer.js';
import { createBudgetGate } from '../budgets/budget-gate.js';
import type {
  ResearchResult,
  OrchestratorLogger,
  ToolContext,
} from '../types.js';
import { RESEARCH_TOOLS } from '../types.js';
import type { ModeRunDeps } from './shared.js';
import { defaultToolContextFactory } from './shared.js';

export interface AnticipatorySweepInput {
  readonly tenantId: string;
  readonly seedQuery: string;
  readonly predictedFollowUps: ReadonlyArray<string>;
}

export interface AnticipatorySweepOutput {
  readonly results: ReadonlyArray<ResearchResult>;
  readonly plan_ids: ReadonlyArray<string>;
}

export async function runAnticipatorySweep(
  input: AnticipatorySweepInput,
  deps: ModeRunDeps,
  logger?: OrchestratorLogger,
): Promise<AnticipatorySweepOutput> {
  const budget = deps.budgets.anticipatory_sweep;
  // Cap to 3 sweeps. Spec §3.2.
  const followUps = input.predictedFollowUps.slice(0, 3);
  if (followUps.length === 0) {
    return { results: Object.freeze([]), plan_ids: Object.freeze([]) };
  }

  const perPlanBudgetCents = Math.max(1, Math.floor(budget.cost_usd_cents / followUps.length));

  const results: Array<ResearchResult> = [];
  const planIds: Array<string> = [];

  // 3 parallel plans — Promise.all.
  await Promise.all(
    followUps.map(async (followUp) => {
      const plan = await buildPlan({
        tenantId: input.tenantId,
        query: followUp,
        mode: 'anticipatory_sweep',
        createdBy: 'mr_mwikila',
        budget_ms: budget.latency_ms,
        budget_usd_cents: perPlanBudgetCents,
        availableTools: [...RESEARCH_TOOLS],
        ...(deps.llmPlan ? { llmPlan: deps.llmPlan } : {}),
      });
      planIds.push(plan.id);

      const validation = validatePlan({
        plan,
        mode_budget: budget,
        available_tools: [...RESEARCH_TOOLS],
      });
      if (!validation.ok) {
        logger?.warn({ plan_id: plan.id, issues: validation.issues }, 'anticipatory-sweep: invalid plan');
        return;
      }

      await deps.repos.plan.create(plan);
      await deps.repos.step.createBatch(plan.steps);

      const gate = createBudgetGate({
        budget_usd_cents: plan.budget_usd_cents,
        latency_ms: plan.budget_ms,
      });

      const summary = await runPlan({
        plan,
        registry: deps.toolRegistry,
        budgetGate: gate,
        toolContextFactory: (step) => defaultToolContextFactory({ plan, step, deps }) as unknown as ToolContext,
        ...(logger ? { logger } : {}),
        parallel: true,
        hooks: {
          async onStepStart(step) {
            await deps.repos.step.markStarted(step.id, new Date().toISOString());
          },
          async onStepComplete(step, stepResult) {
            await deps.repos.step.markFinished({
              step_id: step.id,
              finished_at_iso: new Date().toISOString(),
              status: stepResult.status === 'done' ? 'done' : stepResult.status === 'failed' ? 'failed' : 'skipped',
              cost_usd_cents: stepResult.cost_usd_cents,
              duration_ms: stepResult.duration_ms,
              ...(stepResult.error ? { error: stepResult.error } : {}),
            });
            await deps.repos.artifact.createBatch(stepResult.artifacts);
            await deps.repos.plan.incrementSpent(plan.id, stepResult.cost_usd_cents);
          },
        },
      });

      const result = await synthesizeAnswer({
        plan,
        artifacts: summary.artifacts,
        total_cost_usd_cents: summary.total_cost_usd_cents,
        total_duration_ms: summary.total_duration_ms,
        ...(deps.llmSynthesize ? { llmSynthesize: deps.llmSynthesize } : {}),
      });

      await deps.repos.result.create(result);
      await deps.repos.plan.setResultId(plan.id, result.id);
      await deps.repos.plan.setAuditHash(plan.id, result.audit_hash);
      await deps.repos.plan.setStatus(plan.id, 'complete');
      await deps.audit.emit(result, input.tenantId);

      // Cache the pre-research output under a deterministic key —
      // when the owner asks the predicted follow-up, the chat layer
      // hits this key first.
      await deps.cache.set(
        cacheKey(input.tenantId, followUp),
        JSON.stringify({ result_id: result.id, plan_id: plan.id }),
        60 * 60, // 1h TTL
      );

      results.push(result);
    }),
  );

  logger?.info(
    {
      tenant_id: input.tenantId,
      seed_query: input.seedQuery,
      sweeps: followUps.length,
      plans: planIds.length,
    },
    'anticipatory-sweep: complete',
  );

  return { results: Object.freeze(results), plan_ids: Object.freeze(planIds) };
}

function cacheKey(tenantId: string, query: string): string {
  // Match the Reactive Query lookup key shape so the chat layer can
  // probe both surfaces with the same key.
  const norm = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return `anticipatory:${tenantId}:${norm}`;
}
