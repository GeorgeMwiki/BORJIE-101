/**
 * @borjie/autonomy-governance/routing — barrel.
 *
 * Pure confidence-band routing primitive. See `confidence-band.ts` for
 * spec citations.
 */

export type { Band, RouteDecision, TenantTier, TierThresholds } from './types.js';
export {
  TIER_DEFAULTS,
  SPEC_DEFAULT_THRESHOLDS,
  route,
} from './confidence-band.js';
