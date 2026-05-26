/**
 * Improve-decision module.
 *
 * Per spec §4, the improvement loop fires whenever the 14-day window
 * surfaces any failing signal AND the recipe is not currently
 * `locked`. Unlike the lock decision, no sustained-day requirement —
 * a fresh proposal can be generated as soon as the data supports it.
 *
 * However, two anti-pattern guards apply:
 *
 *   1. Don't propose the same change twice in a row. If there's
 *      already a `pending` proposal for the same (tab_recipe_id,
 *      current_version), skip — the owner has homework already.
 *   2. Don't propose against a `locked` recipe. The whole point of
 *      lock is to stop variant testing. Locked recipes can only be
 *      changed by an owner who first manually unlocks (a Phase 2
 *      owner-portal action).
 */

import type { FitnessReport, ImproveDecision } from '../types.js';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Existing-proposal check — supplied by the storage tier. */
export interface PendingProposalProbe {
  hasPendingProposalFor(args: {
    readonly tenantId: string;
    readonly tabRecipeId: string;
    readonly currentVersion: number;
  }): Promise<boolean>;
}

/** Recipe lock check — supplied by the recipe repository. */
export interface RecipeLockProbe {
  isLocked(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
  }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface ImproveDecisionArgs {
  readonly tenantId: string;
  readonly shortReport: FitnessReport;
  readonly pendingProbe: PendingProposalProbe;
  readonly lockProbe: RecipeLockProbe;
}

/**
 * Decide whether to spin a proposal for one recipe-version.
 *
 * The short report's failing signals carry the rationale into the
 * proposal generator.
 */
export async function decideImprove(
  args: ImproveDecisionArgs,
): Promise<ImproveDecision> {
  const { tenantId, shortReport, pendingProbe, lockProbe } = args;

  if (shortReport.decision !== 'improve_candidate') {
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'noop',
      reason: 'No improve-candidate signals in the 14-day window.',
      failingSignals: [],
    };
  }

  const locked = await lockProbe.isLocked({
    tabRecipeId: shortReport.tabRecipeId,
    tabRecipeVersion: shortReport.tabRecipeVersion,
  });
  if (locked) {
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'noop',
      reason: 'Recipe version is locked; improve proposals are suppressed until manual unlock.',
      failingSignals: shortReport.failingSignals,
    };
  }

  const alreadyPending = await pendingProbe.hasPendingProposalFor({
    tenantId,
    tabRecipeId: shortReport.tabRecipeId,
    currentVersion: shortReport.tabRecipeVersion,
  });
  if (alreadyPending) {
    return {
      tabRecipeId: shortReport.tabRecipeId,
      tabRecipeVersion: shortReport.tabRecipeVersion,
      action: 'noop',
      reason: 'A pending owner-review proposal already exists for this version — not double-proposing.',
      failingSignals: shortReport.failingSignals,
    };
  }

  return {
    tabRecipeId: shortReport.tabRecipeId,
    tabRecipeVersion: shortReport.tabRecipeVersion,
    action: 'propose_improvement',
    reason: 'Failing telemetry signals justify proposing a Tier-1 improvement.',
    failingSignals: shortReport.failingSignals,
  };
}
