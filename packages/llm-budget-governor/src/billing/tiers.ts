/**
 * `@borjie/llm-budget-governor` — platform tier catalog (BSCHEMA-1).
 *
 * Borjie bills the OWNER for brain/agent compute *exactly like Anthropic
 * bills Claude / Claude Code*: subscription TIERS, each carrying a
 * per-period usage budget (cost-weighted token + cent budget), a 5-hour
 * rolling-session window, a weekly cap, an allowed model-tier set, and an
 * overage policy. Full powers are DEFAULT-ON inside each tier's budget —
 * the limit is a *usage cap*, never a *feature gate*.
 *
 * This module is a PURE, code-materialized catalog. It owns NO Stripe, NO
 * HTTP, NO live money. It exists so the catalog DRIVES the existing
 * `tenant_llm_budget_caps` substrate (migration 0272) rather than running
 * a parallel cap system: `tierToCaps()` projects a catalog row onto the
 * exact `{ allowed_tiers, cap_cents, cap_tokens, downgrade_at_fraction }`
 * shape the Postgres `BudgetStore` reads.
 *
 * NUMBERS — every constant cites its source in
 * Docs/research/billing-claude-code-model.md (§1.2 / §1.5). The doc's
 * per-5h-window token budgets (post-May-2026 doubling) are:
 *   Pro ≈ 44,000 · Max 5x ≈ 88,000 · Max 20x ≈ 220,000 tokens / 5h window.
 * Those are COST-WEIGHTED token units (the meter is cost-weighted, §1.3),
 * which is why we express the included budget in the same unit the meter
 * emits (see ./metering.ts). Free / Enterprise are reasonable values the
 * doc leaves to Borjie (§3.1) — Free is a small rolling allowance, no
 * Opus, no overage; Enterprise is custom (base seat-fee + metered usage),
 * encoded here as a large headroom default with overage on.
 */

import type { ModelTier } from '../types.js';

/** The five platform subscription tiers (per ORG). */
export const PLATFORM_TIERS = [
  'free',
  'pro',
  'max5x',
  'max20x',
  'enterprise',
] as const;

export type PlatformTier = (typeof PLATFORM_TIERS)[number];

/**
 * The 5-hour rolling-session window is the PRIMARY limit in the
 * Claude-Code model (billing-claude-code-model.md §1.2). It is the same
 * width for every tier — what scales per tier is the *budget consumed
 * inside* the window, not the window length.
 */
export const SESSION_WINDOW_HOURS = 5 as const;

// ---------------------------------------------------------------------------
// Per-5h-window cost-weighted TOKEN budgets.
// Source: billing-claude-code-model.md §1.2 (post-May-2026 doubling).
//   Pro ≈ 44,000 · Max 5x ≈ 88,000 · Max 20x ≈ 220,000 tokens / 5h window.
// Free / Enterprise per §3.1 (Borjie's reasonable choice): Free is a small
// rolling allowance; Enterprise is large headroom (real cap is the metered
// overage + custom contract, not this ceiling).
// ---------------------------------------------------------------------------
const SESSION_TOKENS_FREE = 5_000 as const;
const SESSION_TOKENS_PRO = 44_000 as const; // doc §1.2
const SESSION_TOKENS_MAX5X = 88_000 as const; // doc §1.2 (~2× Pro)
const SESSION_TOKENS_MAX20X = 220_000 as const; // doc §1.2 (~5× Pro)
const SESSION_TOKENS_ENTERPRISE = 1_000_000 as const; // §3.1 large headroom

// ---------------------------------------------------------------------------
// Per-tier WEEKLY cost-weighted token caps (Claude added weekly limits
// 28-Aug-2025; they sit ON TOP of the 5h window — doc §1.2 point 2).
// The doc gives weekly *hours*, not tokens; we derive a weekly token cap as
// a multiple of the session budget that approximates "many sessions/week
// without account-sharing-scale abuse". This is the one weak axis the task
// permits — encoded as a named multiplier so it is auditable.
// ---------------------------------------------------------------------------
const WEEKLY_SESSIONS_MULTIPLIER = 30 as const; // ~ a heavy week of 5h sessions

// ---------------------------------------------------------------------------
// Monthly INCLUDED cents budget (the "credit pool" the doc anchors to the
// subscription price — Pro=$20, Max5x=$100, Max20x=$200; doc §1.5
// "Effective 15 Jun 2026" separate monthly credit pool). Stored in CENTS.
// Free has no paid pool ($0). Enterprise is custom; encode a large default.
// ---------------------------------------------------------------------------
const INCLUDED_CENTS_FREE = 0 as const; // §1.1 Free = $0
const INCLUDED_CENTS_PRO = 2_000 as const; // $20  · doc §1.5
const INCLUDED_CENTS_MAX5X = 10_000 as const; // $100 · doc §1.5
const INCLUDED_CENTS_MAX20X = 20_000 as const; // $200 · doc §1.5
const INCLUDED_CENTS_ENTERPRISE = 100_000 as const; // $1000 default headroom

/**
 * The 85%-of-budget auto-economy threshold from the substrate
 * (`downgrade_at_fraction`, migration 0272). Per the owner's honest /
 * never-silent directive (doc §3.4 caveat) this is a SURFACED economy
 * mode, never a silent swap — see ./billing-state.ts.
 */
export const DEFAULT_DOWNGRADE_AT_FRACTION = 0.85 as const;

/**
 * A single platform tier's economics. Pure data — no behaviour.
 */
export interface PlatformTierSpec {
  readonly tier: PlatformTier;
  /** Human label for surfaces (UI owns its own i18n; this is a key, not copy). */
  readonly label: string;
  /**
   * Included monthly budget in COST-WEIGHTED token units (see ./metering.ts).
   * This is the meter's unit, so the catalog and the meter never disagree.
   */
  readonly includedTokenBudget: number;
  /** Included monthly budget in CENTS (the subscription "credit pool"). */
  readonly includedCents: number;
  /** Model tiers permitted in this plan (default-on within budget). */
  readonly allowedModelTiers: ReadonlyArray<ModelTier>;
  /** Primary rolling-session window width — always 5h (doc §1.2). */
  readonly sessionWindowHours: typeof SESSION_WINDOW_HOURS;
  /** Cost-weighted token budget consumable inside one 5h session window. */
  readonly sessionTokenBudget: number;
  /** Weekly cost-weighted token cap (sits on top of the 5h window). */
  readonly weeklyTokenCap: number;
  /** Optional max concurrent in-flight brain turns (undefined = unbounded). */
  readonly maxConcurrency?: number;
  /**
   * Whether the owner may opt into metered overage at API rates once the
   * included budget is spent (doc §1.5). When false, exhausting the budget
   * is a hard, honest STOP (doc §3.4 state 2).
   */
  readonly overageAllowed: boolean;
  /**
   * Fraction of budget (0..1) at which the SURFACED economy mode engages
   * (auto-route cheaper model to stretch budget) — disclosed, never silent.
   */
  readonly downgradeAtFraction: number;
}

function weeklyCap(sessionTokenBudget: number): number {
  return sessionTokenBudget * WEEKLY_SESSIONS_MULTIPLIER;
}

// Model-tier sets as `ModelTier[]` so `Object.freeze` below does not widen
// the literals to `string[]` (which would break the catalog's typed shape).
const TIERS_NO_OPUS: ReadonlyArray<ModelTier> = ['haiku', 'sonnet'];
const TIERS_ALL: ReadonlyArray<ModelTier> = ['haiku', 'sonnet', 'opus'];

/**
 * The code-materialized catalog. Frozen so a downstream consumer cannot
 * mutate shared tier economics (immutability rule).
 */
export const PLATFORM_TIER_CATALOG: Readonly<
  Record<PlatformTier, PlatformTierSpec>
> = Object.freeze({
  free: Object.freeze({
    tier: 'free',
    label: 'Free',
    includedTokenBudget: SESSION_TOKENS_FREE * 4, // ~4 small sessions/mo
    includedCents: INCLUDED_CENTS_FREE,
    allowedModelTiers: TIERS_NO_OPUS, // no Opus on Free (doc §1.1)
    sessionWindowHours: SESSION_WINDOW_HOURS,
    sessionTokenBudget: SESSION_TOKENS_FREE,
    weeklyTokenCap: weeklyCap(SESSION_TOKENS_FREE),
    maxConcurrency: 1,
    overageAllowed: false, // Free never pays overage
    downgradeAtFraction: DEFAULT_DOWNGRADE_AT_FRACTION,
  }),
  pro: Object.freeze({
    tier: 'pro',
    label: 'Pro',
    includedTokenBudget: SESSION_TOKENS_PRO * 30, // ~a month of 5h sessions
    includedCents: INCLUDED_CENTS_PRO,
    allowedModelTiers: TIERS_ALL,
    sessionWindowHours: SESSION_WINDOW_HOURS,
    sessionTokenBudget: SESSION_TOKENS_PRO, // doc §1.2 ≈ 44k
    weeklyTokenCap: weeklyCap(SESSION_TOKENS_PRO),
    maxConcurrency: 2,
    overageAllowed: true,
    downgradeAtFraction: DEFAULT_DOWNGRADE_AT_FRACTION,
  }),
  max5x: Object.freeze({
    tier: 'max5x',
    label: 'Max 5x',
    includedTokenBudget: SESSION_TOKENS_MAX5X * 30,
    includedCents: INCLUDED_CENTS_MAX5X,
    allowedModelTiers: TIERS_ALL,
    sessionWindowHours: SESSION_WINDOW_HOURS,
    sessionTokenBudget: SESSION_TOKENS_MAX5X, // doc §1.2 ≈ 88k
    weeklyTokenCap: weeklyCap(SESSION_TOKENS_MAX5X),
    maxConcurrency: 5,
    overageAllowed: true,
    downgradeAtFraction: DEFAULT_DOWNGRADE_AT_FRACTION,
  }),
  max20x: Object.freeze({
    tier: 'max20x',
    label: 'Max 20x',
    includedTokenBudget: SESSION_TOKENS_MAX20X * 30,
    includedCents: INCLUDED_CENTS_MAX20X,
    allowedModelTiers: TIERS_ALL,
    sessionWindowHours: SESSION_WINDOW_HOURS,
    sessionTokenBudget: SESSION_TOKENS_MAX20X, // doc §1.2 ≈ 220k
    weeklyTokenCap: weeklyCap(SESSION_TOKENS_MAX20X),
    maxConcurrency: 10,
    overageAllowed: true,
    downgradeAtFraction: DEFAULT_DOWNGRADE_AT_FRACTION,
  }),
  enterprise: Object.freeze({
    tier: 'enterprise',
    label: 'Enterprise',
    includedTokenBudget: SESSION_TOKENS_ENTERPRISE * 30,
    includedCents: INCLUDED_CENTS_ENTERPRISE,
    allowedModelTiers: TIERS_ALL,
    sessionWindowHours: SESSION_WINDOW_HOURS,
    sessionTokenBudget: SESSION_TOKENS_ENTERPRISE,
    weeklyTokenCap: weeklyCap(SESSION_TOKENS_ENTERPRISE),
    // maxConcurrency intentionally omitted → unbounded (custom contract).
    overageAllowed: true,
    downgradeAtFraction: DEFAULT_DOWNGRADE_AT_FRACTION,
  }),
});

/** Type guard for an unknown string against the tier set. */
export function isPlatformTier(value: unknown): value is PlatformTier {
  return (
    typeof value === 'string' &&
    (PLATFORM_TIERS as ReadonlyArray<string>).includes(value)
  );
}

/** Look up a tier spec, throwing on an unknown tier (fail-closed). */
export function getTierSpec(tier: PlatformTier): PlatformTierSpec {
  const spec = PLATFORM_TIER_CATALOG[tier];
  if (!spec) {
    throw new Error(`Unknown platform tier: ${String(tier)}`);
  }
  return spec;
}

/**
 * The cap shape that backs the `tenant_llm_budget_caps` row (migration
 * 0272). Field names mirror the SQL columns so the projection is obvious:
 *   allowed_tiers · cap_cents · cap_tokens · downgrade_at_fraction.
 */
export interface TierCaps {
  /** → `allowed_tiers text[]` */
  readonly allowedTiers: ReadonlyArray<ModelTier>;
  /** → `cap_cents bigint` (the MONTHLY included cents budget) */
  readonly capCents: number;
  /** → `cap_tokens bigint` (the MONTHLY included cost-weighted token budget) */
  readonly capTokens: number;
  /** → `downgrade_at_fraction numeric(4,3)` */
  readonly downgradeAtFraction: number;
}

/**
 * Project a platform tier onto the `tenant_llm_budget_caps` cap shape so
 * the catalog DRIVES the substrate (not a parallel system). The monthly
 * included budgets become the period caps; the allowed model tiers and
 * surfaced-economy threshold pass straight through.
 *
 * The substrate's `cap_cents` / `cap_tokens` CHECK constraints require
 * `> 0`. Free has `includedCents = 0`, so we floor the cents cap at 1 to
 * satisfy the constraint while keeping the token budget as the binding
 * limit for the free tier. This is a substrate-shape accommodation, not a
 * pricing change — Free still pays nothing (overageAllowed = false).
 */
export function tierToCaps(tier: PlatformTier): TierCaps {
  const spec = getTierSpec(tier);
  return {
    allowedTiers: spec.allowedModelTiers,
    capCents: Math.max(1, spec.includedCents),
    capTokens: Math.max(1, spec.includedTokenBudget),
    downgradeAtFraction: spec.downgradeAtFraction,
  };
}
