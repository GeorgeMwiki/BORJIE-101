/**
 * Detector registry.
 *
 * Maps anomaly + opportunity *kinds* (string tags from cadence specs)
 * to the actual pure detector function. The tick-runner uses this
 * registry to dispatch; cadences declare what runs, the registry
 * declares how.
 *
 * J5 core PR wires the 3 anomaly detectors that ship in this PR
 * (cashflow-dip, arrears-spike, churn-risk). The other 4 anomaly
 * detectors are already scaffolded under detectors/ but are wired in a
 * follow-up to keep the surface tight. Opportunity detectors land in a
 * separate PR — registry is intentionally empty until then so the
 * tick-runner's `if (!fn) continue;` cleanly skips kinds we declare
 * in cadences but haven't shipped yet.
 *
 * Keeping this map central makes it trivial to add a detector — drop a
 * file under `detectors/` (or `opportunities/`), import the function,
 * register it here, and add the kind to a cadence.
 */
import type { AnomalyEvent, OpportunityEvent } from '../contracts/events.js';
import type { TickContext } from './tick-context.js';

// Anomaly detectors — core 3 shipped in J5 core PR.
import { detectCashflowDip } from '../detectors/cashflow-dip.detector.js';
import { detectArrearsSpike } from '../detectors/arrears-spike.detector.js';
import { detectChurnRisk } from '../detectors/churn-risk.detector.js';

export type AnomalyDetectorFn = (ctx: TickContext) => ReadonlyArray<AnomalyEvent>;
export type OpportunityDetectorFn = (
  ctx: TickContext,
) => ReadonlyArray<OpportunityEvent>;

export const ANOMALY_DETECTORS: Readonly<Record<string, AnomalyDetectorFn>> = {
  'cashflow-dip': detectCashflowDip,
  'arrears-spike': detectArrearsSpike,
  'churn-risk': detectChurnRisk,
  // Deferred to follow-up PR (already scaffolded under detectors/):
  //   'cost-anomaly', 'slo-breach', 'compliance-deadline-near',
  //   'vendor-reliability-drop'
} as const;

export const OPPORTUNITY_DETECTORS: Readonly<
  Record<string, OpportunityDetectorFn>
> = {
  // Deferred to follow-up PR:
  //   'vendor-rate-arbitrage', 'policy-tightening', 'rent-vs-market'
} as const;
