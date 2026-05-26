/**
 * Plan validator — pre-flight invariants on a built ResearchPlan.
 *
 * The Planner emits a candidate plan. Before the Executor picks it up,
 * the validator enforces:
 *
 *   - Budget envelope is positive and within per-mode caps.
 *   - Steps are non-empty.
 *   - Tools are within the whitelist the caller declared.
 *   - Step seq numbers are unique + zero-indexed contiguous.
 *
 * Pure function. Returns a `Result` discriminator; the caller decides
 * whether to abort or rebuild.
 *
 * @module research-orchestrator/planner/plan-validator
 */

import type { ResearchPlan, ResearchTool, ModeBudget } from '../types.js';

export type ValidatePlanResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: ReadonlyArray<string> };

export interface ValidatePlanInput {
  readonly plan: ResearchPlan;
  readonly mode_budget: ModeBudget;
  readonly available_tools: ReadonlyArray<ResearchTool>;
  /** Maximum steps the executor allows per plan (defaults: spec budgets). */
  readonly max_steps?: number;
}

export function validatePlan(input: ValidatePlanInput): ValidatePlanResult {
  const issues: Array<string> = [];
  const { plan, mode_budget, available_tools } = input;

  if (plan.steps.length === 0) {
    issues.push('plan has zero steps');
  }

  const maxSteps = input.max_steps ?? defaultMaxSteps(plan.mode);
  if (plan.steps.length > maxSteps) {
    issues.push(
      `plan exceeds max_steps: ${plan.steps.length} > ${maxSteps} for mode ${plan.mode}`,
    );
  }

  if (plan.budget_ms <= 0 || plan.budget_ms > mode_budget.latency_ms) {
    issues.push(
      `budget_ms out of bounds: ${plan.budget_ms} (mode ceiling ${mode_budget.latency_ms})`,
    );
  }
  if (
    plan.budget_usd_cents < 0 ||
    plan.budget_usd_cents > mode_budget.cost_usd_cents
  ) {
    issues.push(
      `budget_usd_cents out of bounds: ${plan.budget_usd_cents} (mode ceiling ${mode_budget.cost_usd_cents})`,
    );
  }

  const seqSeen = new Set<number>();
  for (const step of plan.steps) {
    if (seqSeen.has(step.seq)) {
      issues.push(`duplicate step seq: ${step.seq}`);
    }
    seqSeen.add(step.seq);
    if (!available_tools.includes(step.tool)) {
      issues.push(`step ${step.seq} uses disallowed tool: ${step.tool}`);
    }
    if (step.plan_id !== plan.id) {
      issues.push(
        `step ${step.seq} plan_id mismatch: ${step.plan_id} ≠ ${plan.id}`,
      );
    }
  }

  // Seq numbers must be 0..N-1 — contiguous, zero-indexed.
  for (let i = 0; i < plan.steps.length; i += 1) {
    if (!seqSeen.has(i)) {
      issues.push(`missing step seq ${i}; expected contiguous 0..${plan.steps.length - 1}`);
    }
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues: Object.freeze(issues) };
}

function defaultMaxSteps(mode: ResearchPlan['mode']): number {
  switch (mode) {
    case 'reactive_query':
      return 3;
    case 'anticipatory_sweep':
      return 9; // 3 follow-ups × 3 steps each
    case 'daily_briefing':
      return 30;
    case 'deep_dive':
      return 100;
    case 'continuous_watch':
      return 5;
    default: {
      const _never: never = mode;
      return _never;
    }
  }
}
