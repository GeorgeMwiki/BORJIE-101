/**
 * `@borjie/brain-llm-router/effort` (LP-12) — public surface.
 *
 * Per-thread reasoning-effort selector: fast/standard/deep → model tier,
 * malformed input coerced to standard, env-overridable model ids.
 */

export {
  coerceEffort,
  resolveEffortModel,
  selectEffort,
  effortLabel,
  DEFAULT_EFFORT,
  type ReasoningEffort,
} from './effort.js';
