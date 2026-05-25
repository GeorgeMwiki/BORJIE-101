/**
 * Synthetic policy simulator.
 *
 * Input: a proposed policy change (e.g. "raise rent 5% at next renewal on
 * all Nairobi units"). Runs a stochastic simulation — for each affected
 * lease, samples predicted-renewal-probability from the predictive-
 * intervention engine, compounds over N Monte Carlo paths, produces an
 * NPV distribution + churn distribution + KPI delta.
 *
 * WHY AI-NATIVE: human owners can't run 1,000 Monte Carlo scenarios across
 * thousands of leases. This exposes that as a single API call.
 */

import { newId, clamp01 } from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyChangeKind =
  | 'rent_increase_pct'
  | 'rent_decrease_pct'
  | 'fee_add'
  | 'fee_remove'
  | 'policy_custom';

export interface PolicyScope {
  readonly propertyIds?: readonly string[];
  readonly countryCode?: string;
  readonly region?: string; // free text
  readonly tags?: readonly string[];
}

export interface PolicyChange {
  readonly kind: PolicyChangeKind;
  readonly magnitude?: number; // e.g. 0.05 for 5% rent increase
  readonly description: string;
}

export interface LeaseSimInput {
  readonly leaseId: string;
  readonly customerId: string;
  readonly currencyCode: string; // ISO-4217
  readonly currentRentMinor: number;
  readonly remainingMonths: number;
  readonly baselineRenewalProb: number; // 0..1
  readonly churnSensitivityToRent: number; // elasticity
}

export interface SimulationRequest {
  readonly tenantId: string;
  readonly change: PolicyChange;
  readonly scope: PolicyScope;
  readonly leases: readonly LeaseSimInput[];
  readonly monthlyDiscountRate?: number; // default 0.008 (~10% annual)
  readonly paths?: number; // default 1000
  readonly seed?: number; // optional PRNG seed for reproducibility
}

export interface DistributionStats {
  readonly mean: number;
  readonly p5: number;
  readonly p50: number;
  readonly p95: number;
  readonly stddev: number;
}

export interface SimulationResult {
  readonly id: string;
  readonly tenantId: string;
  readonly change: PolicyChange;
  readonly scope: PolicyScope;
  readonly paths: number;
  readonly leasesAffected: number;
  readonly npvDistribution: DistributionStats;
  readonly churnDistribution: DistributionStats;
  readonly kpiDelta: {
    readonly avgRevenuePerLeaseMinor: number;
    readonly churnRate: number;
    readonly totalNpvMinor: number;
  };
  readonly currencyCode: string; // assumed homogeneous within a simulation
  readonly computedAt: string;
}

// ---------------------------------------------------------------------------
// Pure Monte-Carlo
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32) so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stats(values: readonly number[]): DistributionStats {
  if (values.length === 0) {
    return { mean: 0, p5: 0, p50: 0, p95: 0, stddev: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance =
    sorted.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sorted.length;
  const p = (q: number) =>
    sorted[
      Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))
    ] ?? 0;
  return {
    mean,
    stddev: Math.sqrt(variance),
    p5: p(0.05),
    p50: p(0.5),
    p95: p(0.95),
  };
}

function rentMultiplier(change: PolicyChange): number {
  if (change.kind === 'rent_increase_pct') return 1 + (change.magnitude ?? 0);
  if (change.kind === 'rent_decrease_pct') return 1 - (change.magnitude ?? 0);
  return 1;
}

/**
 * Pure simulation — given leases + change, returns paths arrays. Extracted so
 * tests can exercise the maths deterministically.
 */
export function runSimulationPure(req: SimulationRequest): SimulationResult {
  const paths = req.paths ?? 1000;
  const rate = req.monthlyDiscountRate ?? 0.008;
  const rand = mulberry32(req.seed ?? 1);
  const multiplier = rentMultiplier(req.change);

  const npvPerPath: number[] = [];
  const churnPerPath: number[] = [];

  for (let p = 0; p < paths; p += 1) {
    let npv = 0;
    let churned = 0;
    for (const lease of req.leases) {
      // Adjusted renewal prob: higher rent => lower prob (elasticity)
      const delta = multiplier - 1;
      const adjProb = clamp01(
        lease.baselineRenewalProb - lease.churnSensitivityToRent * delta,
      );
      const renews = rand() < adjProb;
      if (!renews) {
        churned += 1;
      }
      const rentAfter = lease.currentRentMinor * multiplier;
      const months = renews ? lease.remainingMonths : Math.max(0, Math.min(lease.remainingMonths, 1));
      for (let m = 1; m <= months; m += 1) {
        npv += rentAfter / Math.pow(1 + rate, m);
      }
    }
    npvPerPath.push(npv);
    churnPerPath.push(req.leases.length === 0 ? 0 : churned / req.leases.length);
  }

  const npvStats = stats(npvPerPath);
  const churnStats = stats(churnPerPath);
  const firstCurrency = req.leases[0]?.currencyCode ?? 'USD';

  const totalRentPerLease = req.leases.reduce(
    (a, l) => a + l.currentRentMinor * multiplier * l.remainingMonths,
    0,
  );
  const avgRevenuePerLease =
    req.leases.length === 0 ? 0 : totalRentPerLease / req.leases.length;

  return {
    id: newId('sim'),
    tenantId: req.tenantId,
    change: req.change,
    scope: req.scope,
    paths,
    leasesAffected: req.leases.length,
    npvDistribution: npvStats,
    churnDistribution: churnStats,
    kpiDelta: {
      avgRevenuePerLeaseMinor: Math.round(avgRevenuePerLease),
      churnRate: churnStats.mean,
      totalNpvMinor: Math.round(npvStats.mean),
    },
    currencyCode: firstCurrency,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PolicySimulatorDeps {
  /**
   * Hook to load leases matching the scope. Implementations typically join
   * properties + leases + predictions to populate baselineRenewalProb. The
   * returned LeaseSimInput carries everything the pure simulator needs.
   */
  readonly loadLeases: (
    tenantId: string,
    scope: PolicyScope,
  ) => Promise<readonly LeaseSimInput[]>;
}

export interface PolicySimulator {
  simulate(
    req: Omit<SimulationRequest, 'leases'> & { leases?: readonly LeaseSimInput[] },
  ): Promise<SimulationResult>;
}

export function createPolicySimulator(deps: PolicySimulatorDeps): PolicySimulator {
  return {
    async simulate(req) {
      const leases =
        req.leases ?? (await deps.loadLeases(req.tenantId, req.scope));
      return runSimulationPure({ ...req, leases });
    },
  };
}
