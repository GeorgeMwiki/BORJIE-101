/**
 * `@borjie/llm-budget-governor/billing` — platform-billing domain core.
 *
 * Pure, testable domain modules mirroring the Claude-Code billing model
 * (Docs/research/billing-claude-code-model.md). NO Stripe, NO UI, NO HTTP,
 * NO live money — this is the self-contained accounting/limit core the
 * Stripe + UI + gateway waves consume.
 *
 *   tiers          — typed tier catalog (Free/Pro/Max5x/Max20x/Enterprise)
 *                    + tierToCaps() projection onto tenant_llm_budget_caps.
 *   metering       — cost-weighted token metering (Opus 5/25, Sonnet 3/15,
 *                    Haiku 1/5 per-M).
 *   session-window — 5h rolling-session window computed from spend records.
 *   billing-state  — honest 3-state (included | paid-overage | stopped),
 *                    surfaced economy mode, resetAt always present.
 */

export {
  PLATFORM_TIERS,
  PLATFORM_TIER_CATALOG,
  SESSION_WINDOW_HOURS as TIER_SESSION_WINDOW_HOURS,
  DEFAULT_DOWNGRADE_AT_FRACTION,
  getTierSpec,
  isPlatformTier,
  tierToCaps,
  type PlatformTier,
  type PlatformTierSpec,
  type TierCaps,
} from './tiers.js';

export {
  MODEL_PRICE_CARD,
  callCostCents,
  costWeightedTokens,
  modelCostWeight,
  type ModelPrice,
} from './metering.js';

export {
  SESSION_WINDOW_HOURS,
  SESSION_WINDOW_MS,
  computeSessionWindow,
  sessionRemainingTokens,
  hasSessionRolledOver,
  type SessionSpendRecord,
  type SessionWindow,
} from './session-window.js';

export {
  billingState,
  type BillingState,
  type BillingStateKind,
  type BillingCaps,
  type BillingUsage,
} from './billing-state.js';
