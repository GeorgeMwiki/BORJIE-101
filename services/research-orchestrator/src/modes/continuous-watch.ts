/**
 * Continuous Watch mode — DEEP_RESEARCH_SPEC §3.5.
 *
 * Once configured (e.g. "watch gold spot + Tumemadini circulars for
 * site GIA-001"), Mr. Mwikila polls per cadence and emits proactive
 * hints when thresholds cross.
 *
 * Trigger: cron poll, one entry per `continuous_watches` row.
 * Steps: poll → diff → score-threshold-check → emit notification if
 * crossed.
 * Latency: poll cadence configurable (5 min for prices, hourly for
 * regulators, daily for news).
 * Cost budget: ≤$1.00 per watch per day.
 *
 * UX: push notification on threshold cross + audit-chain entry.
 *
 * @module research-orchestrator/modes/continuous-watch
 */

import { buildPlan, BUILT_IN_TEMPLATES } from '../planner/plan-builder.js';
import { validatePlan } from '../planner/plan-validator.js';
import { runPlan } from '../executor/plan-runner.js';
import { synthesizeAnswer } from '../synthesizer/answer-synthesizer.js';
import { createBudgetGate } from '../budgets/budget-gate.js';
import type {
  OrchestratorLogger,
  ResearchArtifact,
  ResearchResult,
  ToolContext,
} from '../types.js';
import { RESEARCH_TOOLS } from '../types.js';
import type { ModeRunDeps } from './shared.js';
import { defaultToolContextFactory } from './shared.js';

export interface ContinuousWatchInput {
  readonly watchId: string;
  readonly tenantId: string;
  readonly topic: string;
  readonly thresholds: Readonly<Record<string, unknown>>;
}

export interface ContinuousWatchOutput {
  readonly plan_id: string;
  readonly result?: ResearchResult;
  readonly threshold_crossed: boolean;
  readonly crossed_threshold?: string;
}

export async function runContinuousWatch(
  input: ContinuousWatchInput,
  deps: ModeRunDeps,
  logger?: OrchestratorLogger,
): Promise<ContinuousWatchOutput> {
  const budget = deps.budgets.continuous_watch;

  const stepTemplate = BUILT_IN_TEMPLATES.continuous_watch({
    topic: input.topic,
    thresholds: input.thresholds,
  });

  const plan = await buildPlan({
    tenantId: input.tenantId,
    query: input.topic,
    mode: 'continuous_watch',
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
    throw new Error(`continuous-watch plan invalid: ${validation.issues.join('; ')}`);
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

  // Threshold evaluation — pure function over the retrieved artifacts.
  const breach = evaluateThresholds(summary.artifacts, input.thresholds);

  // Synthesize a short result regardless — the audit chain still gets
  // an entry per watch tick (DEEP_RESEARCH_SPEC §4.5).
  const result = await synthesizeAnswer({
    plan,
    artifacts: summary.artifacts,
    total_cost_usd_cents: summary.total_cost_usd_cents,
    total_duration_ms: summary.total_duration_ms,
  });

  await deps.repos.result.create(result);
  await deps.repos.plan.setResultId(plan.id, result.id);
  await deps.repos.plan.setAuditHash(plan.id, result.audit_hash);
  await deps.repos.plan.setStatus(plan.id, 'complete');
  await deps.audit.emit(result, input.tenantId);

  if (breach.crossed) {
    await deps.notifications.emit({
      kind: 'watch_threshold_crossed',
      tenant_id: input.tenantId,
      plan_id: plan.id,
      result_id: result.id,
      payload: {
        watch_id: input.watchId,
        topic: input.topic,
        threshold: breach.label,
      },
    });
  }

  logger?.info(
    {
      watch_id: input.watchId,
      tenant_id: input.tenantId,
      plan_id: plan.id,
      threshold_crossed: breach.crossed,
      cost_cents: summary.total_cost_usd_cents,
    },
    'continuous-watch: complete',
  );

  return {
    plan_id: plan.id,
    result,
    threshold_crossed: breach.crossed,
    ...(breach.label ? { crossed_threshold: breach.label } : {}),
  };
}

interface BreachResult {
  readonly crossed: boolean;
  readonly label?: string;
}

/**
 * Evaluate the supplied thresholds against the retrieved artifacts.
 * Supported keys (extend per spec §3.5):
 *   - price_pct_change_above: number (any artifact carrying a
 *     `price_pct_change` entity that exceeds the bound triggers).
 *   - regulator_circular_seen: boolean (any artifact with
 *     source_class='tz_official' triggers).
 */
function evaluateThresholds(
  artifacts: ReadonlyArray<ResearchArtifact>,
  thresholds: Readonly<Record<string, unknown>>,
): BreachResult {
  if (artifacts.length === 0) return { crossed: false };

  const pricePctBound = pickNumber(thresholds['price_pct_change_above']);
  if (pricePctBound !== null) {
    for (const a of artifacts) {
      const pct = pickNumber(
        a.extracted_entities.find((e) => e.kind === 'price_pct_change')?.value,
      );
      if (pct !== null && pct > pricePctBound) {
        return { crossed: true, label: `price_pct_change>${pricePctBound}` };
      }
    }
  }

  if (thresholds['regulator_circular_seen'] === true) {
    const seen = artifacts.some((a) => a.source_class === 'tz_official');
    if (seen) return { crossed: true, label: 'regulator_circular_seen' };
  }

  return { crossed: false };
}

function pickNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
