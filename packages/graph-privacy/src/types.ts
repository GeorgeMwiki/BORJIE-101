/**
 * @borjie/graph-privacy — public types.
 *
 * This package produces PLATFORM-level graph statistics from every
 * tenant's per-org graph under a differential-privacy guarantee. No
 * per-tenant raw data ever crosses the boundary. Every query
 * consumes privacy budget, which is tracked against the tenant's
 * composition ledger (re-using the proven `dp-memory` primitives).
 *
 * Contracts here; implementations in `./aggregators/*` and
 * `./federated/*`. Invariants enforced at the type boundary:
 *
 *   1. A query scoped to a tenant produces a private-value output
 *      that consumes the tenant's budget.
 *   2. A query aggregated across tenants consumes the PLATFORM's
 *      budget; no tenant's budget is debited. The output never
 *      includes a tenant identifier.
 *   3. Minimum participating tenants `k_min` is enforced before any
 *      aggregate is emitted. If fewer than k_min tenants match the
 *      slice, the response is a structured refusal, not a zero or
 *      a suppressed error.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Slice — defines WHICH subset of the platform graph a query spans.
// Slices are coarse-grained (jurisdiction, property class, time
// bucket) so k-anonymity is achievable without destroying signal.
// ─────────────────────────────────────────────────────────────────────

export interface PlatformSlice {
  /** ISO-3166-1 alpha-2 country codes, e.g. ['KE','TZ']. */
  readonly jurisdictions: ReadonlyArray<string>;
  /** Property classes, e.g. ['A','B']. Empty = all. */
  readonly propertyClasses: ReadonlyArray<string>;
  /** Time window as ISO timestamps (half-open). */
  readonly from: string;
  readonly to: string;
}

export const PlatformSliceSchema: z.ZodType<PlatformSlice> = z.object({
  jurisdictions: z.array(z.string().length(2)).readonly(),
  propertyClasses: z.array(z.string()).readonly(),
  from: z.string(),
  to: z.string(),
});

// ─────────────────────────────────────────────────────────────────────
// DP mechanism — Laplace or Gaussian. Each carries its privacy
// parameters and the global sensitivity expected for the statistic.
// ─────────────────────────────────────────────────────────────────────

export type DPMechanism =
  | { readonly kind: 'laplace';  readonly epsilon: number;             readonly sensitivity: number }
  | { readonly kind: 'gaussian'; readonly epsilon: number; readonly delta: number; readonly sensitivity: number };

export const DPMechanismSchema: z.ZodType<DPMechanism> = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('laplace'),
      epsilon: z.number().positive(),
      sensitivity: z.number().positive(),
    }),
    z.object({
      kind: z.literal('gaussian'),
      epsilon: z.number().positive(),
      delta: z.number().positive().max(0.01),
      sensitivity: z.number().positive(),
    }),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Aggregate statistics — the menu of graph-level statistics we
// publish. Kept deliberately small; each statistic has a proven
// sensitivity bound so the DP mechanism is mathematically justified.
// ─────────────────────────────────────────────────────────────────────

export const AGGREGATE_STATS = [
  'arrears_rate',              // share of tenants ≥30 days late
  'collection_rate',           // share of invoiced rent collected on time
  'vacancy_days_mean',         // mean days a unit sits empty between tenants
  'noi_growth',                // YoY change in net-operating-income
  'renewal_rate',              // share of leases renewed at term-end
  'maintenance_ttc_mean',      // mean time-to-complete work orders (hours)
  'vendor_reopen_rate',        // share of work orders re-opened ≤30 days
  'tenant_sentiment_mean',     // mean sentiment score across active chats
  'autonomous_action_rate',    // share of actions executed without a human
  'escalation_density',        // escalations per 1,000 units per month
] as const;

export type AggregateStat = (typeof AGGREGATE_STATS)[number];

export const AggregateStatSchema = z.enum(AGGREGATE_STATS);

// ─────────────────────────────────────────────────────────────────────
// AggregateQuery & AggregateResult — one query, one DP-protected
// result. The result's `noisedValue` is safe to publish; `rawValue`
// is never persisted past the aggregator's memory.
// ─────────────────────────────────────────────────────────────────────

export interface AggregateQuery {
  readonly statistic: AggregateStat;
  readonly slice: PlatformSlice;
  readonly mechanism: DPMechanism;
  /** Minimum distinct tenants that must match the slice. Default 5. */
  readonly kMin: number;
}

export interface AggregateResult {
  readonly statistic: AggregateStat;
  readonly slice: PlatformSlice;
  /** The value with DP noise applied. Safe to publish / store / show. */
  readonly noisedValue: number;
  /** How many tenants contributed. Reported only when ≥ kMin. */
  readonly contributingTenants: number;
  /** Epsilon consumed by this query against the platform budget. */
  readonly privacyCost: number;
  /** Optional delta (Gaussian only). */
  readonly privacyDelta: number | null;
  /** ISO timestamp this result was computed. */
  readonly generatedAt: string;
}

export interface AggregateRefusal {
  readonly kind: 'refused';
  readonly reason:
    | 'k_anonymity_not_met'
    | 'platform_budget_exhausted'
    | 'insufficient_mechanism_calibration'
    | 'slice_empty';
  readonly detail: string;
}

export type AggregateOutcome =
  | ({ readonly kind: 'published' } & AggregateResult)
  | AggregateRefusal;

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

export interface TenantAggregateSource {
  /** Return the PER-TENANT contribution to the aggregate for the
   *  given slice. The aggregator then combines contributions. MUST
   *  enforce tenant isolation; return value must NOT include
   *  identifiable data. */
  contributionsFor(args: {
    readonly tenantId: string;
    readonly statistic: AggregateStat;
    readonly slice: PlatformSlice;
  }): Promise<ReadonlyArray<number>>;
  /** List the tenant IDs whose data is eligible for inclusion in
   *  the slice. The aggregator uses this list size against kMin. */
  eligibleTenants(slice: PlatformSlice): Promise<ReadonlyArray<string>>;
}

export interface PlatformBudgetLedger {
  /** Attempt to reserve epsilon (and delta). Returns the updated
   *  remaining budget, or throws `PrivacyBudgetExhaustedError` when
   *  the reserve would push remaining below zero. Atomic. */
  reserve(args: { readonly epsilon: number; readonly delta: number }): Promise<{
    readonly remainingEpsilon: number;
    readonly remainingDelta: number;
  }>;
  snapshot(): Promise<{
    readonly totalEpsilon: number;
    readonly spentEpsilon: number;
    readonly totalDelta: number;
    readonly spentDelta: number;
  }>;
}

export class PrivacyBudgetExhaustedError extends Error {
  override readonly name = 'PrivacyBudgetExhaustedError';
}

/** Noise mechanism port. Unit-testable with a seeded PRNG. */
export interface NoiseSource {
  laplace(scale: number): number;
  gaussian(sigma: number): number;
}

// ─────────────────────────────────────────────────────────────────────
// Auth — only the `platform` kind from the forecasting package can
// issue these queries. Stays symmetrical with the forecasting port.
// ─────────────────────────────────────────────────────────────────────

export interface PlatformAuthContext {
  readonly kind: 'platform';
  readonly actorUserId: string;
  readonly roles: ReadonlyArray<string>;
}
