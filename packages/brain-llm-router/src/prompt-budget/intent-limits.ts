/**
 * intent-limits — per-intent prompt token budgets.
 *
 * Ported in spirit from LITFIN `speed-config.ts` (per-intent SLO tuning).
 *
 * Each intent maps to a {@link PromptBudget}: a hard `maxTokens` ceiling
 * (beyond which the trim cascade drops lowest-priority layers) and a soft
 * `warnTokens` threshold (emits telemetry when crossed but keeps the layer).
 *
 * Intents are mining-domain neutral here — they describe the *shape* of the
 * turn (chat vs long-doc vs tool-use), never a jurisdiction or currency, so
 * nothing currency-specific leaks in (per the hard rules).
 *
 * Pure module: frozen constants, no I/O.
 */

export interface PromptBudget {
  /** Hard ceiling. Beyond this the cascade trims lowest-priority layers. */
  readonly maxTokens: number;
  /** Soft warning threshold; crossing it emits telemetry without trimming. */
  readonly warnTokens: number;
}

/**
 * Default budget. Tuned for a Sonnet-class 200k input window with comfortable
 * cache-prefix headroom. Used when an intent is unknown.
 */
export const DEFAULT_PROMPT_BUDGET: PromptBudget = Object.freeze({
  maxTokens: 8_000,
  warnTokens: 6_000,
});

/**
 * Per-intent budget map. Keys are coarse turn-shape labels, not domain verbs,
 * so the same map serves every tenant and jurisdiction.
 *
 *   classify / tool-use → tight (cheap, structured, latency-sensitive)
 *   chat                → default
 *   plan / critic       → roomier (multi-step reasoning needs context)
 *   longdoc             → large (legal / policy / corpus excerpts)
 */
export const PROMPT_BUDGET_BY_INTENT: Readonly<Record<string, PromptBudget>> = Object.freeze({
  classify: Object.freeze({ maxTokens: 3_000, warnTokens: 2_400 }),
  'tool-use': Object.freeze({ maxTokens: 5_000, warnTokens: 4_000 }),
  chat: Object.freeze({ maxTokens: 8_000, warnTokens: 6_000 }),
  critic: Object.freeze({ maxTokens: 10_000, warnTokens: 8_000 }),
  plan: Object.freeze({ maxTokens: 12_000, warnTokens: 9_500 }),
  codegen: Object.freeze({ maxTokens: 16_000, warnTokens: 13_000 }),
  longdoc: Object.freeze({ maxTokens: 60_000, warnTokens: 48_000 }),
});

/**
 * Resolve the budget for an intent. Unknown intents fall back to the default.
 * Never throws.
 */
export function budgetForIntent(intent: string | null | undefined): PromptBudget {
  if (!intent) return DEFAULT_PROMPT_BUDGET;
  return PROMPT_BUDGET_BY_INTENT[intent] ?? DEFAULT_PROMPT_BUDGET;
}
