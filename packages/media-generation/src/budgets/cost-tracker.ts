/**
 * Cost tracker — per-recipe spend ledger with per-class budget gates.
 *
 * Adapters MUST reserve cost BEFORE the network call and commit / release
 * after (mirrors the research-tools pattern). Per-class envelopes from
 * MEDIA_GENERATION_SPEC §9:
 *
 *   briefing_thumbnail            ≤ $0.10
 *   marketplace_listing_hero      ≤ $0.15
 *   social_post_still             ≤ $0.10
 *   social_post_short_video       ≤ $0.50
 *   tutorial_lipsync_video        ≤ $3.00
 *   investor_brand_video          ≤ $5.00  (Tier-2 owner-confirm)
 *   avatar_talking_head           ≤ $8.00  (Tier-2 owner-confirm)
 *
 * Pure logic — caller persists the ledger if needed.
 *
 * @module @borjie/media-generation/budgets/cost-tracker
 */

import type { CostTracker, MediaClass } from '../types.js';

// ---------------------------------------------------------------------------
// Per-class budgets (USD cents) — single source of truth
// ===========================================================================

export const MEDIA_CLASS_BUDGET_CENTS: Readonly<
  Record<MediaClass, number>
> = Object.freeze({
  briefing_thumbnail: 10,
  marketplace_listing_hero: 15,
  social_post_still: 10,
  social_post_short_video: 50,
  tutorial_lipsync_video: 300,
  investor_brand_video: 500,
  avatar_talking_head: 800,
  marketing_still: 15,
  site_visualisation: 20,
});

/**
 * Latency budget (milliseconds) per class — used by the dispatcher to
 * pick a provider whose typical latency fits the envelope.
 */
export const MEDIA_CLASS_LATENCY_MS: Readonly<
  Record<MediaClass, number>
> = Object.freeze({
  briefing_thumbnail: 15_000,
  marketplace_listing_hero: 30_000,
  social_post_still: 20_000,
  social_post_short_video: 300_000,
  tutorial_lipsync_video: 600_000,
  investor_brand_video: 900_000,
  avatar_talking_head: 1_200_000,
  marketing_still: 30_000,
  site_visualisation: 30_000,
});

/**
 * Look up the spending envelope for a media class. Defaults to the
 * marketplace_listing_hero ceiling when a class is unknown.
 */
export function budgetForClass(cls: MediaClass): number {
  return (
    MEDIA_CLASS_BUDGET_CENTS[cls] ?? MEDIA_CLASS_BUDGET_CENTS.marketplace_listing_hero
  );
}

/**
 * Look up the latency envelope for a media class.
 */
export function latencyMsForClass(cls: MediaClass): number {
  return (
    MEDIA_CLASS_LATENCY_MS[cls] ?? MEDIA_CLASS_LATENCY_MS.marketplace_listing_hero
  );
}

// ---------------------------------------------------------------------------
// CostTracker factory
// ===========================================================================

export interface CostTrackerOptions {
  readonly budget_usd_cents: number;
  /** Optional initial spend (for resumed plans). Default 0. */
  readonly initial_spent_cents?: number;
}

interface MutableLedger {
  reserved: number;
  committed: number;
}

/**
 * Build a fresh tracker. The returned value is a `CostTracker` whose
 * `tryReserve`, `commit`, `release` calls update a closed-over ledger.
 * The semantics mirror research-tools' `createCostTracker`.
 */
export function createCostTracker(options: CostTrackerOptions): CostTracker {
  const budget = Math.max(0, Math.floor(options.budget_usd_cents));
  const ledger: MutableLedger = {
    reserved: 0,
    committed: Math.max(0, options.initial_spent_cents ?? 0),
  };

  return {
    async tryReserve(estimated_cents: number): Promise<boolean> {
      const est = Math.max(0, Math.ceil(estimated_cents));
      if (ledger.committed + ledger.reserved + est > budget) {
        return false;
      }
      ledger.reserved += est;
      return true;
    },
    async commit(measured_cents: number): Promise<void> {
      const measured = Math.max(0, Math.ceil(measured_cents));
      ledger.committed += measured;
      ledger.reserved = 0;
    },
    async release(reserved_cents: number): Promise<void> {
      const r = Math.max(0, Math.ceil(reserved_cents));
      ledger.reserved = Math.max(0, ledger.reserved - r);
    },
    async spent(): Promise<number> {
      return ledger.committed;
    },
    budget(): number {
      return budget;
    },
  };
}

/**
 * Convenience: build a tracker pre-sized to a media class's budget.
 */
export function createClassBudgetTracker(cls: MediaClass): CostTracker {
  return createCostTracker({ budget_usd_cents: budgetForClass(cls) });
}
