/**
 * Mr. Mwikila autonomous-MD framework — kernel slice public surface.
 *
 * `agency/` covers the long-horizon think-and-act loop; this slice is
 * narrower — it formalises the owner-facing delegation tiers + the
 * inviolable safety rails the autonomous handlers must clear.
 *
 * Composition:
 *
 *   import { autonomy } from '@borjie/central-intelligence';
 *
 *   const delegation = autonomy.resolveDelegation(prefRow, 'shifts');
 *   if (delegation.tier === 'T0' || delegation.tier === 'T1') {
 *     // propose-only — queue an inbox row, do not execute.
 *   }
 *   const verdict = autonomy.checkAutonomyInviolable({
 *     category: 'shifts',
 *     amountTzs: 0,
 *     currency: 'TZS',
 *     envelopeThresholdTzs: delegation.envelopeThresholdTzs,
 *     killSwitchOpen,
 *   });
 *   if (verdict.status === 'block') {
 *     // queue inbox row with status='blocked_by_inviolable'.
 *   }
 */

export {
  DELEGATION_CATEGORIES,
  DELEGATION_TIERS,
  ACTION_STATUSES,
  CATEGORY_DEFAULT_TIER,
  CATEGORY_DEFAULT_REVERSAL_HOURS,
  tierRank,
  effectiveTier,
  resolveDelegation,
  tierAllowsImmediateExecution,
  tierAllowsReversal,
  type DelegationCategory,
  type DelegationTier,
  type ActionStatus,
  type DelegationPref,
  type ResolvedDelegation,
} from './types.js';

export {
  DEFAULT_MONTHLY_ENVELOPE_TZS,
  INVIOLABLE_REASONS,
  checkAutonomyInviolable,
  type InviolableReason,
  type InviolableVerdictAutonomy,
  type AutonomyActionDescriptor,
} from './inviolable-rails.js';
