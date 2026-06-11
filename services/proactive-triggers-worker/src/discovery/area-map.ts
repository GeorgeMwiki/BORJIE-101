/**
 * Anomaly-kind → DiscoveryArea mapping.
 *
 * The proactive-intel detectors emit `AnomalyKind`s; the
 * scientific-discovery seed library is organised by `DiscoveryArea`.
 * This pure map bridges the two so a *recurring* anomaly can seed a
 * Co-Scientist round on the matching area:
 *
 *   cashflow-dip / cost-anomaly        -> pricing
 *   royalty-arrears-spike              -> outstanding_royalties
 *   churn-risk                         -> churn
 *   vendor-reliability-drop /          -> maintenance
 *     (maintenance-class anomalies)
 *   slo-breach / compliance-*          -> (no discovery area; skipped)
 *
 * `available_capacity` has no 1:1 anomaly kind today — it is reached via
 * opportunity events, out of scope for this anomaly-driven trigger.
 *
 * Pure data + a lookup. No I/O.
 */
import type { AnomalyKind } from '@borjie/proactive-intel';
import type { DiscoveryArea } from '@borjie/scientific-discovery';

const KIND_TO_AREA: Readonly<Partial<Record<AnomalyKind, DiscoveryArea>>> = {
  'cashflow-dip': 'pricing',
  'cost-anomaly': 'pricing',
  'royalty-arrears-spike': 'outstanding_royalties',
  'churn-risk': 'churn',
  'vendor-reliability-drop': 'maintenance',
};

/**
 * Map an anomaly kind to its discovery area, or `undefined` when the
 * kind has no causal-discovery analogue (slo-breach,
 * compliance-deadline-near).
 */
export function mapAnomalyKindToDiscoveryArea(
  kind: AnomalyKind,
): DiscoveryArea | undefined {
  return KIND_TO_AREA[kind];
}
