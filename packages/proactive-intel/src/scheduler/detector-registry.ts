/**
 * Detector registry.
 *
 * Maps anomaly + opportunity *kinds* (string tags from cadence specs)
 * to the actual pure detector function. The tick-runner uses this
 * registry to dispatch; cadences declare what runs, the registry
 * declares how.
 *
 * All 7 anomaly detectors that have a real, complete source file under
 * `detectors/` are wired here: the J5 core 3 (cashflow-dip,
 * royalty-arrears-spike, churn-risk) plus the 4 that were scaffolded as
 * complete pure detectors but previously left commented out (cost-anomaly,
 * slo-breach, compliance-deadline-near, vendor-reliability-drop).
 *
 * The 3 opportunity detectors (vendor-rate-arbitrage, policy-tightening,
 * offtake-price-vs-market) are declared in cadences + the OpportunityKind
 * contract but have NO source file under `detectors/` — they are unbuilt,
 * not merely unwired. They remain commented out below so the tick-runner's
 * `if (!fn) continue;` cleanly skips them until someone builds (or prunes)
 * them. Do not register them without a real detector implementation.
 *
 * Keeping this map central makes it trivial to add a detector — drop a
 * file under `detectors/` (or `opportunities/`), import the function,
 * register it here, and add the kind to a cadence.
 */
import type { AnomalyEvent, OpportunityEvent } from '../contracts/events.js';
import type { TickContext } from './tick-context.js';

// Anomaly detectors — core 3 shipped in J5 core PR.
import { detectCashflowDip } from '../detectors/cashflow-dip.detector.js';
import { detectRoyaltyArrearsSpike } from '../detectors/royalty-arrears-spike.detector.js';
import { detectChurnRisk } from '../detectors/churn-risk.detector.js';
// Anomaly detectors — scaffolded-then-wired (real, complete pure detectors).
import { detectCostAnomaly } from '../detectors/cost-anomaly.detector.js';
import { detectSloBreach } from '../detectors/slo-breach.detector.js';
import { detectComplianceDeadlineNear } from '../detectors/compliance-deadline-near.detector.js';
import { detectVendorReliabilityDrop } from '../detectors/vendor-reliability-drop.detector.js';

export type AnomalyDetectorFn = (ctx: TickContext) => ReadonlyArray<AnomalyEvent>;
export type OpportunityDetectorFn = (
  ctx: TickContext,
) => ReadonlyArray<OpportunityEvent>;

export const ANOMALY_DETECTORS: Readonly<Record<string, AnomalyDetectorFn>> = {
  'cashflow-dip': detectCashflowDip,
  'royalty-arrears-spike': detectRoyaltyArrearsSpike,
  'churn-risk': detectChurnRisk,
  'cost-anomaly': detectCostAnomaly,
  'slo-breach': detectSloBreach,
  'compliance-deadline-near': detectComplianceDeadlineNear,
  'vendor-reliability-drop': detectVendorReliabilityDrop,
} as const;

export const OPPORTUNITY_DETECTORS: Readonly<
  Record<string, OpportunityDetectorFn>
> = {
  // Unbuilt — declared in cadences + OpportunityKind contract but NO source
  // file exists under detectors/. Build a real detector before wiring:
  //   'vendor-rate-arbitrage', 'policy-tightening', 'offtake-price-vs-market'
} as const;
