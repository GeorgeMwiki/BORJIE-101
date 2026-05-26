/**
 * Deep Dive mode — DEEP_RESEARCH_SPEC §3.4.
 *
 * Owner says "research X deeply." Multi-hour, multi-step, may span days.
 * Maintains an explicit research plan + progress ledger. Owner can
 * pause / resume / re-prompt mid-run.
 *
 * Budget: ≤$25 per dive with owner re-confirm at $5 and $15 spent.
 * Latency: multi-hour to multi-day, checkpointed every step.
 *
 * Key behaviour:
 *   - Plan + session are persisted before the first step runs.
 *   - Every step writes its artifacts immediately (§10).
 *   - Budget gate raises owner-confirm at the [$5, $15] thresholds.
 *   - When the gate fires, the dive PAUSES (status='paused'); the
 *     orchestrator emits a `deep_dive_gate_reached` notification, the
 *     owner clicks "continue", the API marks the gate acknowledged,
 *     and a follow-up call to `resumeDeepDive` re-runs from the next
 *     uncompleted step.
 *
 * @module research-orchestrator/modes/deep-dive
 */

import { randomUUID } from 'node:crypto';
import { buildPlan } from '../planner/plan-builder.js';
import { validatePlan } from '../planner/plan-validator.js';
import { runPlan } from '../executor/plan-runner.js';
import { synthesizeAnswer } from '../synthesizer/answer-synthesizer.js';
import { createBudgetGate } from '../budgets/budget-gate.js';
import type {
  OrchestratorLogger,
  ResearchPlan,
  ResearchResult,
  ToolContext,
} from '../types.js';
import { RESEARCH_TOOLS } from '../types.js';
import type { ModeRunDeps } from './shared.js';
import { defaultToolContextFactory } from './shared.js';

export interface DeepDiveInput {
  readonly tenantId: string;
  readonly query: string;
  readonly topic: string;
  readonly createdBy: 'owner_explicit';
  /** Previously-acknowledged budget gates (USD). */
  readonly acknowledgedGatesUsd?: ReadonlyArray<number>;
}

export interface DeepDiveOutput {
  readonly plan_id: string;
  readonly session_id: string;
  readonly result?: ResearchResult;
  readonly status: 'complete' | 'paused' | 'failed';
  readonly paused_reason?: 'budget_exhausted' | 'latency_exceeded' | 'owner_confirm';
}

export async function runDeepDive(
  input: DeepDiveInput,
  deps: ModeRunDeps,
  logger?: OrchestratorLogger,
): Promise<DeepDiveOutput> {
  const budget = deps.budgets.deep_dive;

  const plan = await buildPlan({
    tenantId: input.tenantId,
    query: input.query,
    mode: 'deep_dive',
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
    throw new Error(`deep-dive plan invalid: ${validation.issues.join('; ')}`);
  }

  await deps.repos.plan.create(plan);
  await deps.repos.step.createBatch(plan.steps);

  // Create the session row — survives worker restart.
  const sessionId = randomUUID();
  await deps.repos.session.create({
    id: sessionId,
    tenant_id: input.tenantId,
    topic: input.topic,
    active_plan_id: plan.id,
    state: {
      last_completed_seq: -1,
      spent_usd_cents: 0,
      acked_gates_usd: input.acknowledgedGatesUsd ?? [],
    },
    status: 'running',
    owner_sign_off_required_at_usd: budget.owner_confirm_gates_usd,
    last_progress_at: new Date().toISOString(),
  });

  const gate = createBudgetGate({
    budget_usd_cents: plan.budget_usd_cents,
    latency_ms: plan.budget_ms,
    owner_confirm_gates_usd: budget.owner_confirm_gates_usd,
    ...(input.acknowledgedGatesUsd && input.acknowledgedGatesUsd.length > 0
      ? { acknowledged_gates_usd: input.acknowledgedGatesUsd }
      : {}),
  });

  const summary = await runPlan({
    plan,
    registry: deps.toolRegistry,
    budgetGate: gate,
    toolContextFactory: (step) =>
      defaultToolContextFactory({ plan, step, deps, ownerConfirm: gate.ownerConfirm }) as unknown as ToolContext,
    ...(logger ? { logger } : {}),
    hooks: {
      async onStepStart(step) {
        await deps.repos.step.markStarted(step.id, new Date().toISOString());
      },
      async onStepComplete(step, stepResult) {
        await deps.repos.step.markFinished({
          step_id: step.id,
          finished_at_iso: new Date().toISOString(),
          status:
            stepResult.status === 'done'
              ? 'done'
              : stepResult.status === 'failed'
                ? 'failed'
                : 'skipped',
          cost_usd_cents: stepResult.cost_usd_cents,
          duration_ms: stepResult.duration_ms,
          ...(stepResult.error ? { error: stepResult.error } : {}),
        });
        await deps.repos.artifact.createBatch(stepResult.artifacts);
        await deps.repos.plan.incrementSpent(plan.id, stepResult.cost_usd_cents);

        // Checkpoint session state after every step (§10).
        const spent = await gate.tracker.spent();
        await deps.repos.session.checkpoint({
          id: sessionId,
          state: {
            last_completed_seq: step.seq,
            spent_usd_cents: spent,
            acked_gates_usd: input.acknowledgedGatesUsd ?? [],
          },
          progress_at_iso: new Date().toISOString(),
        });
      },
    },
  });

  // Pause path: gate fired or latency exceeded.
  if (summary.status === 'paused') {
    await deps.repos.plan.setStatus(plan.id, 'paused');
    await deps.repos.session.setStatus(sessionId, 'paused');

    if (summary.paused_reason === 'owner_confirm') {
      await deps.notifications.emit({
        kind: 'deep_dive_gate_reached',
        tenant_id: input.tenantId,
        plan_id: plan.id,
        payload: {
          spent_usd_cents: await gate.tracker.spent(),
          gates_usd: budget.owner_confirm_gates_usd as ReadonlyArray<number>,
        },
      });
    }

    logger?.info(
      {
        tenant_id: input.tenantId,
        plan_id: plan.id,
        session_id: sessionId,
        paused_reason: summary.paused_reason,
        spent_cents: summary.total_cost_usd_cents,
      },
      'deep-dive: paused',
    );

    return {
      plan_id: plan.id,
      session_id: sessionId,
      status: 'paused',
      ...(summary.paused_reason ? { paused_reason: summary.paused_reason } : {}),
    };
  }

  // Synthesize the final answer.
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
  await deps.repos.session.setStatus(sessionId, 'complete');
  await deps.audit.emit(result, input.tenantId);

  logger?.info(
    {
      tenant_id: input.tenantId,
      plan_id: plan.id,
      session_id: sessionId,
      result_id: result.id,
      cost_cents: summary.total_cost_usd_cents,
      duration_ms: summary.total_duration_ms,
    },
    'deep-dive: complete',
  );

  return {
    plan_id: plan.id,
    session_id: sessionId,
    result,
    status: 'complete',
  };
}

// Helper for plan-completion paths that surface the same `ResearchPlan`
// shape the repository persists — used by the resume entrypoint
// (not exposed in this commit; see PHASE 2 follow-up in the spec §13.4).
export function _placeholderPlanShape(): ResearchPlan {
  return {
    id: '',
    tenant_id: '',
    mode: 'deep_dive',
    query: '',
    created_by: 'owner_explicit',
    created_at: '',
    budget_ms: 1,
    budget_usd_cents: 0,
    steps: Object.freeze([]),
    status: 'planned',
    result_id: null,
  };
}
