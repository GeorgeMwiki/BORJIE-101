/**
 * Per-step kind budget defaults (in micro-USD).
 *
 * The numbers are intentionally conservative — high enough that a typical
 * plan fits well within a tenant's daily quota, low enough that a runaway
 * automation can't drain the budget unseen.
 *
 * 1 USD = 1_000_000 micro-USD. The DSL evaluator uses the same factor.
 */

import { type StepKind } from './types.js';

export const MICRO_USD_PER_USD = 1_000_000;

/**
 * Default per-step cost. Adjustable per-tenant via the `action_quotas`
 * row but tests / dev defaults to these baseline numbers.
 *
 * Rough rationale:
 *   - LLM-heavy steps (DRAFT_LETTER) cost more.
 *   - Network / external API calls cost a flat $0.02–$0.05.
 *   - Pure DB / internal compute steps are practically free.
 */
export const STEP_BUDGET_DEFAULTS_MICROS: Readonly<Record<StepKind, number>> = {
  DRAFT_LETTER: 50_000, // $0.05 — LLM completion
  ROUTE_APPROVAL: 1_000, // $0.001 — DB insert + notifications
  POST_LEDGER: 5_000, // $0.005 — DB + event publish
  FILE_GEPG: 30_000, // $0.03 — external API roundtrip
  SEND_WHATSAPP: 20_000, // $0.02 — provider per-message
  SEND_SMS: 25_000, // $0.025 — operator metered
  SEND_EMAIL: 5_000, // $0.005 — SES baseline
  SCHEDULE_FIELD_VISIT: 2_000, // $0.002 — calendar + notify
  MUTATE_ENTITY: 1_000, // $0.001 — DB write
  CALL_EXTERNAL_API: 30_000, // $0.03 — generic outbound
  EMIT_WEBHOOK: 5_000, // $0.005 — outbound + retry budget
  NOTIFY: 1_000, // $0.001 — in-app push
  VERIFY: 1_000, // $0.001 — DB read
  COMPENSATE: 5_000, // $0.005 — typically a reverse-ledger
};

export function defaultBudgetForPlan(stepKinds: ReadonlyArray<StepKind>): number {
  let total = 0;
  for (const kind of stepKinds) {
    total += STEP_BUDGET_DEFAULTS_MICROS[kind];
  }
  return total;
}

/**
 * Default daily-plan limit per tenant when no autonomy cap is set.
 *
 * 10 plans/day = enough for the pilot, not so many that a runaway
 * automation can drain the budget unseen.
 */
export const DEFAULT_DAILY_PLAN_LIMIT = 10;

/**
 * Default daily money cap (micro-USD). 100 USD baseline — meaningful
 * for the pilot but easily widened per-tenant.
 */
export const DEFAULT_DAILY_MONEY_CAP_MICROS = 100 * MICRO_USD_PER_USD;
