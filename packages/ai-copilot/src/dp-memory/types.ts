/**
 * DP-Memory — Wave 28 Agent DP-MEMORY.
 *
 * Types for the differential-privacy cross-tenant pattern-memory layer.
 *
 * Motivation:
 *   - Today BORJIE is strictly per-tenant isolated. Patterns learned
 *     from tenant A (e.g. "2BR units in Westlands lease within 14 days
 *     on average") cannot inform defaults for tenant B, even though doing
 *     so would materially reduce cold-start pain for new operators.
 *   - Differential privacy (Dwork & Roth, 2014, "The Algorithmic
 *     Foundations of Differential Privacy") gives us a rigorous framework
 *     for releasing aggregates that provably do not leak individual-row
 *     facts from the source tenants.
 *   - This module defines the *narrow* shapes the DP pipeline speaks:
 *     queries (what is asked), results (the noisy answer + confidence),
 *     budgets (how much epsilon each tenant has spent), and shared
 *     defaults (the DP-protected industry benchmark table).
 *
 * Design principles:
 *   - Immutable data only. Every returned object is a fresh shape with
 *     `readonly` fields. Callers must never mutate.
 *   - Pre-aggregated inputs only. The aggregator and DP layers NEVER see
 *     per-row records — sources feed in already-bucketed counts / means /
 *     quantiles, and the consent manager gates the contribution set.
 *   - Transparent sample-size + epsilon reporting. Any published default
 *     carries the epsilon spent and the underlying sample size so
 *     consumers can weight the signal themselves.
 */

/** Filter spec for cross-tenant benchmark queries. */
export interface FilterSpec {
  /** Geographic / jurisdiction key (e.g. "KE-NBO-Westlands"). */
  readonly jurisdiction?: string;
  /** Property / unit type (e.g. "2BR", "studio"). */
  readonly unitType?: string;
  /** Bedroom count bucket. */
  readonly bedrooms?: number;
  /** Optional arbitrary string-valued bucket. */
  readonly bucket?: string;
}

export type DPAggregation = 'mean' | 'count' | 'histogram' | 'quantile';

/**
 * A DP-protected query. `sensitivity` is the L1 global sensitivity of
 * the underlying function — i.e. the largest absolute change in output
 * that a single source-row change could produce. Callers are responsible
 * for bounding their pre-aggregation so this number is honest.
 */
export interface DPQuery {
  readonly id: string;
  readonly description: string;
  readonly domain: string;
  readonly aggregation: DPAggregation;
  readonly filters: FilterSpec;
  readonly sensitivity: number;
}

/** Result of a DP-protected query. Always noisy, always carries a CI. */
export interface DPQueryResult {
  readonly queryId: string;
  readonly value: number;
  readonly noisy: true;
  readonly epsilonUsed: number;
  readonly confidence: readonly [number, number];
  /**
   * Sample size the query ran over. Never includes personally-identifiable
   * cardinality — this is the count of *contributing tenants* or
   * *pre-aggregated buckets*, not raw records.
   */
  readonly sampleSize: number;
  readonly generatedAt: string;
}

/**
 * Per-tenant privacy budget. `totalEpsilon` is the cap for the window,
 * `usedEpsilon` accumulates as queries are answered. The window resets
 * at `resetsAt` (month boundary by default).
 */
export interface PrivacyBudget {
  readonly tenantId: string;
  readonly totalEpsilon: number;
  readonly usedEpsilon: number;
  readonly resetsAt: string;
}

/**
 * A shared industry default published by the aggregator. The `value` is
 * already DP-noised; `epsilonUsed` and `sampleSize` let downstream
 * consumers weight it.
 */
export interface SharedDefault {
  readonly key: string;
  readonly value: number;
  readonly unit: string;
  readonly jurisdiction?: string | undefined;
  readonly sampleSize: number;
  readonly epsilonUsed: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
}

/**
 * A single tenant's pre-aggregated, rounded contribution to the cross-
 * tenant pool. The aggregator rejects any contribution that fails the
 * anonymisation contract (checked structurally in `pattern-aggregator.ts`).
 */
export interface TenantContribution {
  readonly tenantId: string;
  readonly domain: string;
  readonly feature: string;
  readonly value: number;
  /** Number of pre-aggregated source rows the value summarises. */
  readonly sampleSize: number;
  readonly filters: FilterSpec;
  readonly contributedAt: string;
}

/** Aggregated pool entry returned by the pattern aggregator. */
export interface AggregatedPattern {
  readonly domain: string;
  readonly feature: string;
  readonly filters: FilterSpec;
  readonly value: number;
  readonly sampleSize: number;
  readonly contributingTenantCount: number;
}

/** Per-tenant consent record — gates inclusion in the cross-tenant pool. */
export interface ConsentRecord {
  readonly tenantId: string;
  readonly benchmarkContribution: boolean;
  readonly detailedPatternSharing: boolean;
  readonly updatedAt: string;
}

/**
 * Plan-tier knobs used by the budget ledger when a tenant is first
 * observed. Unknown tenants get the `default` bucket.
 */
export interface PlanTierBudgets {
  readonly default: number;
  readonly [planTier: string]: number;
}

/** Ports for persistence — swappable with a Postgres impl later. */
export interface PrivacyBudgetRepository {
  readAll(): Promise<readonly PrivacyBudget[]>;
  read(tenantId: string): Promise<PrivacyBudget | null>;
  write(record: PrivacyBudget): Promise<void>;
}

export interface ConsentRepository {
  read(tenantId: string): Promise<ConsentRecord | null>;
  write(record: ConsentRecord): Promise<void>;
  readAll(): Promise<readonly ConsentRecord[]>;
}

export interface SharedDefaultRepository {
  read(key: string, jurisdiction?: string): Promise<SharedDefault | null>;
  write(record: SharedDefault): Promise<void>;
  list(): Promise<readonly SharedDefault[]>;
}
