/**
 * `@borjie/brain-llm-router/prompt-budget` (LP-08) — public surface.
 *
 * Token SLO + telemetry for the prompt hot path:
 *   - estimateTokens (EN/SW-safe heuristic)
 *   - per-intent token-limit map
 *   - trim cascade (pure, never throws, drops lowest-priority layers first)
 *   - history-summarize-overflow helper
 *   - droppedLayers telemetry event hook (injected sink, no-op default)
 */

export { estimateTokens, estimateTokensOfMany } from './estimate-tokens.js';

export {
  DEFAULT_PROMPT_BUDGET,
  PROMPT_BUDGET_BY_INTENT,
  budgetForIntent,
  type PromptBudget,
} from './intent-limits.js';

export {
  trimToBudget,
  type PromptLayer,
  type TrimResult,
} from './trim-cascade.js';

export {
  summarizeOverflowHistory,
  type HistoryTurn,
  type HistorySummariser,
  type SummarizeOptions,
  type SummarizeResult,
} from './history-summarize.js';

export {
  setPromptBudgetSink,
  resetPromptBudgetSink,
  emitPromptBudgetEvent,
  type PromptBudgetEvent,
  type PromptBudgetSink,
} from './telemetry.js';
