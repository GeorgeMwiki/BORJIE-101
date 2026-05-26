/**
 * Daily Briefing mode — DEEP_RESEARCH_SPEC §3.3.
 *
 * Overnight cron — pull commodity prices, regulatory feeds, competitor
 * licence-register diffs, FX moves; synthesize into a morning brief.
 *
 * Trigger: cron at 06:00 owner-local time (per-tenant timezone).
 * Steps: commodity-price pulls (LME, Kitco), regulatory-diff
 * (Tumemadini, NEMC, TRA gazette), news scan (GDELT), FX (BoT),
 * competitor licence-register diff.
 * Latency budget: 5–15 min off-peak.
 * Cost budget: ≤$2.00 per tenant per night.
 * UX: email + in-app banner at 06:00 owner-local. Click expands to
 * full report with citations.
 *
 * Demo flow — this mode is the highest-leverage demo:
 *   1. Cron fires at 06:00 tenant-local time.
 *   2. Calls the daily-briefing plan template ("what should the
 *      owner know this morning?").
 *   3. Synthesizes a markdown briefing.
 *   4. Writes to `master_brain_briefings`.
 *   5. Audit-chains the briefing.
 *   6. Emits a `daily_briefing_ready` notification event.
 *
 * @module research-orchestrator/modes/daily-briefing
 */

import { buildPlan, BUILT_IN_TEMPLATES } from '../planner/plan-builder.js';
import { validatePlan } from '../planner/plan-validator.js';
import { runPlan } from '../executor/plan-runner.js';
import { synthesizeAnswer } from '../synthesizer/answer-synthesizer.js';
import { createBudgetGate } from '../budgets/budget-gate.js';
import type { ResearchResult, OrchestratorLogger, ToolContext } from '../types.js';
import { RESEARCH_TOOLS } from '../types.js';
import type { ModeRunDeps } from './shared.js';
import { defaultToolContextFactory } from './shared.js';

export interface DailyBriefingInput {
  readonly tenantId: string;
  /** Mineral list to track — defaults to ['gold'] (Tanzania pilot). */
  readonly minerals?: ReadonlyArray<string>;
  /** Regulators to diff — defaults to Tumemadini/NEMC/TRA. */
  readonly regulators?: ReadonlyArray<string>;
  /** FX pairs to pull — defaults to USD/TZS. */
  readonly fxPairs?: ReadonlyArray<string>;
}

export interface DailyBriefingOutput {
  readonly briefing_id: string;
  readonly result: ResearchResult;
  readonly plan_id: string;
  readonly summary_md: string;
}

// UNIV-4: launch-beachhead defaults — TZ mining vertical. Callers pass
// jurisdiction-specific regulator/mineral/FX lists; these consts fire
// only when the input omits them. Future jurisdictions should resolve
// defaults from the vertical-profile registry (e.g. mining-tz vs
// mining-ke) rather than module-level constants. Tracked: UNIV-4
// follow-up — drive defaults from jurisdiction + vertical-profile pair.
const DEFAULT_MINERALS = ['gold'] as const;
const DEFAULT_REGULATORS = ['tumemadini', 'nemc', 'tra'] as const;
const DEFAULT_FX = ['USD/TZS'] as const;

export async function runDailyBriefing(
  input: DailyBriefingInput,
  deps: ModeRunDeps,
  logger?: OrchestratorLogger,
): Promise<DailyBriefingOutput> {
  if (!deps.briefingSink) {
    throw new Error('daily-briefing: briefingSink is required');
  }

  const budget = deps.budgets.daily_briefing;
  const minerals = input.minerals ?? DEFAULT_MINERALS;
  const regulators = input.regulators ?? DEFAULT_REGULATORS;
  const fxPairs = input.fxPairs ?? DEFAULT_FX;

  const stepTemplate = BUILT_IN_TEMPLATES.daily_briefing({
    minerals,
    regulators,
    fxPairs,
  });

  const plan = await buildPlan({
    tenantId: input.tenantId,
    query: `Daily briefing for ${input.tenantId} on ${new Date().toISOString().slice(0, 10)}`,
    mode: 'daily_briefing',
    createdBy: 'worker_cron',
    budget_ms: budget.latency_ms,
    budget_usd_cents: budget.cost_usd_cents,
    availableTools: [...RESEARCH_TOOLS],
    stepTemplate,
  });

  const validation = validatePlan({
    plan,
    mode_budget: budget,
    available_tools: [...RESEARCH_TOOLS],
  });
  if (!validation.ok) {
    throw new Error(`daily-briefing plan invalid: ${validation.issues.join('; ')}`);
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
    toolContextFactory: (step) =>
      defaultToolContextFactory({ plan, step, deps }) as unknown as ToolContext,
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
      },
    },
  });

  const result = await synthesizeAnswer({
    plan,
    artifacts: summary.artifacts,
    total_cost_usd_cents: summary.total_cost_usd_cents,
    total_duration_ms: summary.total_duration_ms,
    fast_moving_topic: true,
    ...(deps.llmSynthesize ? { llmSynthesize: deps.llmSynthesize } : {}),
  });

  await deps.repos.result.create(result);
  await deps.repos.plan.setResultId(plan.id, result.id);
  await deps.repos.plan.setAuditHash(plan.id, result.audit_hash);
  await deps.repos.plan.setStatus(plan.id, 'complete');
  await deps.audit.emit(result, input.tenantId);

  // Write the briefing row that the owner UI reads.
  const { briefing_id } = await deps.briefingSink.writeBriefing({
    tenant_id: input.tenantId,
    summary_md: result.summary_md,
    evidence_ids: result.span_citations.map((c) => c.citation_id),
    actions_proposed: [],
    status: 'final',
  });

  // Notify — services/notifications/ picks this up.
  await deps.notifications.emit({
    kind: 'daily_briefing_ready',
    tenant_id: input.tenantId,
    plan_id: plan.id,
    result_id: result.id,
    payload: {
      briefing_id,
      confidence: result.confidence,
      minerals: minerals as ReadonlyArray<string>,
      regulators: regulators as ReadonlyArray<string>,
    },
  });

  logger?.info(
    {
      tenant_id: input.tenantId,
      plan_id: plan.id,
      result_id: result.id,
      briefing_id,
      cost_cents: summary.total_cost_usd_cents,
      duration_ms: summary.total_duration_ms,
    },
    'daily-briefing: complete',
  );

  return { briefing_id, result, plan_id: plan.id, summary_md: result.summary_md };
}
