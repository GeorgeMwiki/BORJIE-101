/**
 * `@borjie/llm-budget-governor` — honest limit-state computation (BSCHEMA-4).
 *
 * This is the Claude-Code contract, restated as a PURE function
 * (billing-claude-code-model.md §1.4 / §3.4). Given current usage, the
 * tenant's caps, the platform tier, and `now`, return EXACTLY ONE of three
 * honest states:
 *
 *   included      — inside the included budget; full powers, default-on.
 *   paid-overage  — included budget spent AND overage allowed → continuing
 *                   at a transparent metered rate, capped at the owner's cap.
 *   stopped       — included budget spent AND overage NOT allowed → a hard,
 *                   honest STOP. Never a fake answer, never a silent degrade.
 *
 * INVARIANTS (TEST=PAYING):
 *   - `resetAt` is ALWAYS returned (doc §1.4: "the reset time is always
 *     shown"). Never undefined.
 *   - There is NO silently-degraded fourth state. The substrate's
 *     `downgrade_at_fraction` (auto economy-model at 85%) is represented
 *     EXPLICITLY as `economyMode: true` + a disclosable note — a SURFACED
 *     budget-economy mode, never a hidden model swap (doc §3.4 caveat).
 *   - In `paid-overage`, the transparent rate note is always populated.
 *
 * Pure: no I/O, no global Date (caller passes `now`).
 */

import type { ModelTier } from '../types.js';
import { MODEL_PRICE_CARD } from './metering.js';
import type { TierCaps } from './tiers.js';

/** The three honest states — and only these three (doc §3.4). */
export type BillingStateKind = 'included' | 'paid-overage' | 'stopped';

/** Caps + tier policy the state computation reads. */
export interface BillingCaps extends TierCaps {
  /**
   * Whether the owner has enabled metered overage past the included budget
   * (doc §1.5 "extra usage" toggle). When false, exhaustion → `stopped`.
   */
  readonly overageAllowed: boolean;
  /**
   * The owner-controlled overage spend cap in CENTS (doc §1.5 "monthly
   * spend cap you control"). Overage stops here even when allowed.
   * Undefined → unbounded (Enterprise custom contract).
   */
  readonly overageCapCents?: number;
}

/** Current usage snapshot the state computation reads. */
export interface BillingUsage {
  /** Cost-weighted token units consumed in the period. */
  readonly usedTokens: number;
  /** Cents consumed in the period. */
  readonly usedCents: number;
}

/** The honest, fully-disclosed billing state. */
export interface BillingState {
  readonly state: BillingStateKind;
  /**
   * Remaining INCLUDED budget. In `included` this is the headroom; in
   * `paid-overage` / `stopped` it is 0 (included budget is spent).
   */
  readonly remainingTokens: number;
  readonly remainingCents: number;
  /** ALWAYS present — when the period budget resets (doc §1.4). */
  readonly resetAt: Date;
  /**
   * Disclosable rate note for `paid-overage` (doc §1.5 "continuing with
   * metered usage (≈ rate)"). Present iff state === 'paid-overage'.
   */
  readonly overageRateNote?: string;
  /** Remaining overage headroom in cents, when an overage cap is set. */
  readonly overageRemainingCents?: number;
  /**
   * SURFACED economy mode (doc §3.4 caveat). True once usage crosses
   * `downgradeAtFraction` of the included budget. NEVER a silent swap —
   * always paired with `economyNote` so the owner is told.
   */
  readonly economyMode: boolean;
  /** Disclosable note explaining the economy mode. Present iff economyMode. */
  readonly economyNote?: string;
  /**
   * Soft "approaching limit" flag (doc §1.4). True once usage crosses the
   * economy threshold but the included budget is not yet exhausted.
   */
  readonly approaching: boolean;
}

/**
 * Format a transparent overage-rate note from the price card. We surface
 * the Sonnet + Opus list rates so the owner sees the real $/M they will be
 * billed (doc §1.5: overage anchors to the API price card). This is a
 * disclosure string, not localized UI copy — surfaces re-render via i18n.
 */
function overageRateNote(): string {
  const s = MODEL_PRICE_CARD.sonnet;
  const o = MODEL_PRICE_CARD.opus;
  return (
    `Continuing on metered usage at API list rates: ` +
    `Sonnet $${s.inputPerMillionUsd}/$${s.outputPerMillionUsd} per 1M in/out, ` +
    `Opus $${o.inputPerMillionUsd}/$${o.outputPerMillionUsd} per 1M in/out.`
  );
}

function economyNote(economyModel: ModelTier): string {
  return (
    `Now routing to the economy model (${economyModel}) to stretch your ` +
    `remaining budget. You can disable economy mode in settings.`
  );
}

/**
 * The cheapest allowed tier — the economy model surfaced when economy mode
 * engages. Returns null when the tier set is empty (defensive).
 */
function economyModelFor(allowedTiers: ReadonlyArray<ModelTier>): ModelTier | null {
  const order: ReadonlyArray<ModelTier> = ['haiku', 'sonnet', 'opus'];
  for (const tier of order) {
    if (allowedTiers.includes(tier)) return tier;
  }
  return null;
}

/**
 * Compute the honest billing state.
 *
 * @param usage   Current period usage (cost-weighted tokens + cents).
 * @param caps    Tier caps + overage policy.
 * @param resetAt When the included period budget resets (caller supplies —
 *   the session-window `resetAt` or the daily/monthly period end). ALWAYS
 *   flows through to the result so the reset time is never hidden.
 * @param now     Evaluation instant (reserved for future time-gated logic;
 *   kept in the signature to match the billingState(usage,caps,tier,now)
 *   contract and keep the function total).
 */
export function billingState(
  usage: BillingUsage,
  caps: BillingCaps,
  resetAt: Date,
  now: Date,
): BillingState {
  void now; // total function; no time-gated branch today, but contract-stable.

  const includedTokens = caps.capTokens;
  const includedCents = caps.capCents;

  const tokensExhausted = usage.usedTokens >= includedTokens;
  const centsExhausted = usage.usedCents >= includedCents;
  const includedExhausted = tokensExhausted || centsExhausted;

  const remainingTokens = Math.max(0, includedTokens - usage.usedTokens);
  const remainingCents = Math.max(0, includedCents - usage.usedCents);

  // SURFACED economy mode: usage crossed downgrade fraction of EITHER axis
  // but the included budget is not yet fully spent. Always disclosed.
  const tokenFraction = includedTokens > 0 ? usage.usedTokens / includedTokens : 1;
  const centFraction = includedCents > 0 ? usage.usedCents / includedCents : 1;
  const fraction = Math.max(tokenFraction, centFraction);
  const economyModel = economyModelFor(caps.allowedTiers);
  const economyMode =
    !includedExhausted &&
    economyModel !== null &&
    fraction >= caps.downgradeAtFraction;
  const approaching = economyMode;

  // ---- State 1: still inside the included budget. ----
  if (!includedExhausted) {
    return {
      state: 'included',
      remainingTokens,
      remainingCents,
      resetAt,
      economyMode,
      ...(economyMode && economyModel
        ? { economyNote: economyNote(economyModel) }
        : {}),
      approaching,
    };
  }

  // Included budget is spent. Branch on the owner's overage policy.

  // ---- State 3: overage NOT allowed → hard, honest STOP. ----
  if (!caps.overageAllowed) {
    return {
      state: 'stopped',
      remainingTokens: 0,
      remainingCents: 0,
      resetAt,
      economyMode: false,
      approaching: false,
    };
  }

  // ---- Overage allowed: check the owner's overage cap. ----
  const overageSpentCents = Math.max(0, usage.usedCents - includedCents);
  if (
    caps.overageCapCents !== undefined &&
    overageSpentCents >= caps.overageCapCents
  ) {
    // Overage budget exhausted too → hard, honest STOP at the owner's cap.
    return {
      state: 'stopped',
      remainingTokens: 0,
      remainingCents: 0,
      resetAt,
      overageRemainingCents: 0,
      economyMode: false,
      approaching: false,
    };
  }

  // ---- State 2: paid-overage — continuing at a transparent metered rate. ----
  return {
    state: 'paid-overage',
    remainingTokens: 0,
    remainingCents: 0,
    resetAt,
    overageRateNote: overageRateNote(),
    ...(caps.overageCapCents !== undefined
      ? {
          overageRemainingCents: Math.max(
            0,
            caps.overageCapCents - overageSpentCents,
          ),
        }
      : {}),
    economyMode: false,
    approaching: false,
  };
}
