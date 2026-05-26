/**
 * Reactive Query mode — DEEP_RESEARCH_SPEC §3.1.
 *
 * Owner asks a question in chat. Mr. Mwikila runs a 1–3 step plan,
 * cites, replies inline.
 *
 * Latency: ≤8 s shallow (corpus-only), ≤30 s medium (web fallback).
 * Cost: ≤$0.05 per query.
 *
 * UX: inline answer with evidence chips. Each chip links to the
 * source (corpus chunk highlight OR external URL).
 *
 * Steps: typically `corpus_query` → optional `web_search` → optional
 * `web_fetch` of top hit.
 *
 * @module research-orchestrator/modes/reactive-query
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
import type { ModeRunDeps } from './shared.js';
import { defaultToolContextFactory } from './shared.js';
import { RESEARCH_TOOLS } from '../types.js';

export interface ReactiveQueryInput {
  readonly tenantId: string;
  readonly query: string;
  readonly createdBy: 'mr_mwikila' | 'owner_explicit';
}

export interface ReactiveQueryOutput {
  readonly result: ResearchResult;
  readonly plan_id: string;
  readonly status: 'complete' | 'paused' | 'failed';
}

export async function runReactiveQuery(
  input: ReactiveQueryInput,
  deps: ModeRunDeps,
  logger?: OrchestratorLogger,
): Promise<ReactiveQueryOutput> {
  const budget = deps.budgets.reactive_query;
  const plan = await buildPlan({
    tenantId: input.tenantId,
    query: input.query,
    mode: 'reactive_query',
    createdBy: input.createdBy,
    budget_ms: budget.latency_ms,
    budget_usd_cents: budget.cost_usd_cents,
    availableTools: [...RESEARCH_TOOLS],
    ...(deps.llmPlan ? { llmPlan: deps.llmPlan } : {}),
  });

  const validation = validatePlan({
    plan,
    mode_budget: budget,
    available_tools: [...RESEARCH_TOOLS],
  });
  if (!validation.ok) {
    logger?.warn({ plan_id: plan.id, issues: validation.issues }, 'reactive-query: invalid plan');
    throw new Error(`reactive-query plan invalid: ${validation.issues.join('; ')}`);
  }

  await deps.repos.plan.create(plan);

  const gate = createBudgetGate({
    budget_usd_cents: plan.budget_usd_cents,
    latency_ms: plan.budget_ms,
  });

  await deps.repos.step.createBatch(plan.steps);

  const summary = await runPlan({
    plan,
    registry: deps.toolRegistry,
    budgetGate: gate,
    toolContextFactory: (step) => defaultToolContextFactory({ plan, step, deps }) as unknown as ToolContext,
    ...(logger ? { logger } : {}),
    hooks: {
      async onStepStart(step) {
        await deps.repos.step.markStarted(step.id, new Date().toISOString());
      },
      async onStepComplete(step, result) {
        await deps.repos.step.markFinished({
          step_id: step.id,
          finished_at_iso: new Date().toISOString(),
          status: result.status === 'done' ? 'done' : result.status === 'failed' ? 'failed' : 'skipped',
          cost_usd_cents: result.cost_usd_cents,
          duration_ms: result.duration_ms,
          ...(result.error ? { error: result.error } : {}),
        });
        await deps.repos.artifact.createBatch(result.artifacts);
        await deps.repos.plan.incrementSpent(plan.id, result.cost_usd_cents);
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
  await deps.repos.plan.setStatus(plan.id, summary.status === 'paused' ? 'paused' : 'complete');

  await deps.audit.emit(result, input.tenantId);

  logger?.info(
    {
      plan_id: plan.id,
      result_id: result.id,
      confidence: result.confidence,
      cost_cents: summary.total_cost_usd_cents,
      duration_ms: summary.total_duration_ms,
      status: summary.status,
    },
    'reactive-query: complete',
  );

  return { result, plan_id: plan.id, status: summary.status };
}
