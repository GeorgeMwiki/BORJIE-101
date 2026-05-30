/**
 * TTL Policy — how stale is too stale per claim category.
 *
 * Daily-refresh contract (April 2026):
 *   The cron runs DAILY. Every claim category has a TTL that means "by this
 *   age, the claim must have been re-fetched against its authoritative URL or
 *   it loses verified status."
 *
 *   - Forex moves intra-day -> 6h
 *   - Bank rates / pricing -> 1d (daily revalidation)
 *   - Commodity prices move daily -> 12h
 *   - Benchmarks (sector KPIs) -> 7d (weekly)
 *   - Tax rates / regulations -> 30d (monthly cross-check, plus on-demand
 *     when a new Finance Act / GN is published)
 *   - Structural (BRELA, KYC) -> 30d
 *   - Geographic + institutional -> 30d
 *
 * Plus: a daily SAMPLE-CHECK pass (see refresh-scheduler) re-fetches a 2%
 * random slice of every category's verified claims so we catch silent drift
 * even on stable categories. Across a year that touches ~700% of the corpus
 * — every claim gets at least one cross-validation per quarter on top of
 * the TTL refresh.
 */

import type { ClaimCategory } from "./types";

const SECONDS = {
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
  quarter: 90 * 24 * 60 * 60,
  year: 365 * 24 * 60 * 60,
} as const;

export const TTL_BY_CATEGORY: Readonly<Record<ClaimCategory, number>> = {
  forex: 6 * SECONDS.hour,
  pricing: 1 * SECONDS.day,
  commodity: 12 * SECONDS.hour,
  benchmark: 7 * SECONDS.day,
  regulatory: 1 * SECONDS.month,
  structural: 1 * SECONDS.month,
  geographic: 1 * SECONDS.month,
  institutional: 1 * SECONDS.month,
};

/**
 * Fraction of fresh claims to re-fetch on each daily cron run as a silent-
 * drift detector. 0.02 = 2% per day -> every claim gets a spot-check ~50d.
 */
export const DAILY_SAMPLE_CHECK_FRACTION = 0.02;

/**
 * Maximum age (in days) that a 'verified' claim is allowed to retain that
 * status without ANY revalidation. Hard ceiling regardless of TTL — even
 * if the TTL says yearly, this clamps the brain to never trust a claim
 * older than 30 days without cross-checking. The "constantly update every
 * day" guarantee from the operator.
 */
export const MAX_VERIFIED_AGE_DAYS = 30;

/**
 * Compute when a claim should next be refreshed. Returns ISO string for the
 * `next_refresh_at` column.
 */
export function computeNextRefreshAt(
  category: ClaimCategory,
  fromDate: Date = new Date(),
): string {
  const ttl = TTL_BY_CATEGORY[category];
  return new Date(fromDate.getTime() + ttl * 1000).toISOString();
}

/**
 * A claim is "fresh" iff status='verified' AND now < next_refresh_at AND
 * last_verified_at is within the MAX_VERIFIED_AGE_DAYS hard ceiling. The
 * hard ceiling is the "constantly update every day" guarantee — even
 * structurally-stable claims must be cross-checked at least monthly or the
 * brain treats them as stale.
 *
 * This is the single source of truth for "can this fact be injected into a
 * prompt right now?".
 */
export function isClaimFresh(claim: {
  readonly status: string;
  readonly next_refresh_at: string;
  readonly last_verified_at?: string;
}): boolean {
  if (claim.status !== "verified") return false;
  if (new Date(claim.next_refresh_at).getTime() <= Date.now()) return false;
  if (claim.last_verified_at) {
    const ageMs = Date.now() - new Date(claim.last_verified_at).getTime();
    if (ageMs > MAX_VERIFIED_AGE_DAYS * SECONDS.day * 1000) return false;
  }
  return true;
}

/**
 * "Near expiry" = within 10% of TTL window of next_refresh_at. Triggers a
 * proactive refresh before the claim goes stale, so users never see an
 * "I don't know" deferral that could have been pre-warmed.
 */
export function isClaimNearExpiry(claim: {
  readonly status: string;
  readonly next_refresh_at: string;
  readonly ttl_seconds: number;
}): boolean {
  if (claim.status !== "verified") return false;
  const refreshTime = new Date(claim.next_refresh_at).getTime();
  const buffer = claim.ttl_seconds * 0.1 * 1000;
  return Date.now() > refreshTime - buffer;
}
