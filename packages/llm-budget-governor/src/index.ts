/**
 * `@borjie/llm-budget-governor` — public surface.
 *
 * Per-tenant LLM budget cap with auto-downgrade (opus → sonnet → haiku).
 */

export * from './types.js';
export { createInMemoryBudgetStore } from './budget-store/index.js';
export {
  createPostgresBudgetStore,
  type CreatePostgresBudgetStoreArgs,
  type SqlClient as BudgetStoreSqlClient,
} from './postgres-store.js';
export {
  nextAllowedTier,
  projectCallCostCents,
} from './auto-downgrade/index.js';
export {
  createLLMBudgetGovernor,
  type EvaluateCallArgs,
  type LLMBudgetGovernor,
} from './governor.js';
export {
  adjustCeiling,
  emergencyUnlock,
  seedBudget,
  type AdjustCeilingArgs,
  type SeedBudgetArgs,
} from './admin-overrides.js';

// Platform-billing domain core (Claude-Code model): tier catalog +
// cost-weighted metering + 5h rolling-session window + honest 3-state
// limit computation. Pure domain — NO Stripe / UI / HTTP / live money.
export * from './billing/index.js';
