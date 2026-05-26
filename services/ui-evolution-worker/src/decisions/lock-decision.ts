/**
 * Lock-decision module.
 *
 * Per Docs/DESIGN/ANTICIPATORY_UX_SPEC.md §4:
 *
 *   "All three [completion + per-field error + per-field abandonment]
 *    met continuously for 30 days  → LOCK"
 *
 * Translated into a stateful rule the worker can apply daily:
 *
 *   - When a recipe-version is a lock candidate in the 14-day window
 *     AND in the 60-day window AND has been a lock candidate for at
 *     least 30 consecutive days according to the persistent ledger,
 *     promote the row to `locked`.
 *   - When a recipe-version is a lock candidate in the 14-day window
 *     but has NOT yet sustained for 30 days, mark it as a
 *     `mark_lock_candidate` action so the storage tier can record a
 *     dated marker.
 *   - Otherwise: `noop`.
 *
 * The "sustained 30 days" rule is implemented as a port supplied by
 * the caller — the storage tier provides `LockCandidateLedger`
 * pointing at the persistent ledger row (a row in `tab_recipes` or
 * a sibling `tab_recipes_lock_candidates` table introduced in a
 * follow-up migration). For Phase 2 we use the `tab_recipes.locked_
 * at` column null/not-null + a `first_lock_candidate_at_iso` value
 * tracked by the caller.
 */

import type { FitnessReport, LockDecision } from '../types.js';

// ---------------------------------------------------------------------------
// Ledger port
// ---------------------------------------------------------------------------

/**
 * Persistent ledger tracking when a recipe first became a lock
 * candidate. Returning `null` means the recipe has never been a
 * candidate, so today's reading is the first.
 */
export interface LockCandidateLedger {
  readFirstCandidateAt(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }): Promise<string | null>;
  /**
   * Persists the very first time the recipe became a lock candidate.
   * Idempotent — calling twice with the same args is a no-op.
   */
  writeFirstCandidateAt(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
    readonly atIso: string;
  }): Promise<void>;
  /** Clears the candidacy marker — called whenever the recipe drops
   *  out of lock_candidate. */
  clearCandidacy(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface LockDecisionArgs {
  readonly shortReport: FitnessReport;
  readonly longReport: FitnessReport;
  readonly ledger: LockCandidateLedger;
  readonly nowIso: string;
  readonly sustainDays: number;
}

/** Make the lock decision for one recipe-version. */
export async function decideLock(args: LockDecisionArgs): Promise<LockDecision> {
  const { shortReport, longReport, ledger, nowIso, sustainDays } = args;

  // If either window says NOT a lock candidate, clear any prior
  // candidacy marker and noop.
  if (
    shortReport.decision !== 'lock_candidate' ||
    longReport.decision !== 'lock_candidate'
  ) {
    await ledger.clearCandidacy({
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
    });
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'noop',
      reason: 'Recipe is not a lock candidate in both rolling windows.',
    };
  }

  // Both windows agree — recipe is a candidate. Decide whether 30
  // days have elapsed since the first candidacy.
  const firstAt = await ledger.readFirstCandidateAt({
    tabRecipeId: shortReport.tabRecipeId,
    tabRecipeVersion: shortReport.tabRecipeVersion,
  });

  if (firstAt === null) {
    // First time seeing it as a candidate — record + return
    // mark_lock_candidate.
    await ledger.writeFirstCandidateAt({
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      atIso: nowIso,
    });
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'mark_lock_candidate',
      reason: `First lock-candidate marker set at ${nowIso}. Need ${sustainDays} days sustained to LOCK.`,
    };
  }

  const daysSustained = daysBetween(firstAt, nowIso);
  if (daysSustained < sustainDays) {
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'mark_lock_candidate',
      reason: `Sustained for ${daysSustained.toFixed(1)} of required ${sustainDays} days.`,
    };
  }

  // 30+ days sustained: promote to lock.
  return {
    tabRecipeId: shortReport.tabRecipeId,
    tabRecipeVersion: shortReport.tabRecipeVersion,
    action: 'lock',
    reason: `Sustained as lock candidate for ${daysSustained.toFixed(1)} days (>= ${sustainDays}). Locking.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return 0;
  }
  return (to - from) / 86_400_000;
}
