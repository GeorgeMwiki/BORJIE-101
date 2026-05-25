/**
 * cross-tenant-query.ts — public API for asking cross-tenant benchmark
 * questions.
 *
 * A tenant asks `queryIndustryBenchmark(query)`; the service:
 *   1. Checks + consumes the caller's privacy budget for `query.epsilon`.
 *   2. Pulls the matching aggregate from the pattern aggregator (which
 *      only contains opted-in tenants' coarse-bucketed contributions).
 *   3. Applies the Laplace mechanism to the aggregate.
 *   4. Returns a `DPQueryResult` with the noisy value, the ε spent, the
 *      95% confidence interval, and the backing sample size.
 *
 * Never returns an answer without debiting the budget. Never answers
 * when the pool has fewer than `minContributingTenants` contributors —
 * this prevents a tenant from learning the (near-)identity of another
 * tenant who is the only contributor to a narrow bucket.
 */

import {
  addLaplaceNoise,
  laplaceConfidenceInterval,
  type RandomSource,
} from './differential-privacy.js';
import type { PrivacyBudgetLedger } from './privacy-budget-ledger.js';
import type { PatternAggregator } from './pattern-aggregator.js';
import type { DPQuery, DPQueryResult } from './types.js';

export interface CrossTenantQueryServiceConfig {
  readonly ledger: PrivacyBudgetLedger;
  readonly aggregator: PatternAggregator;
  readonly now?: () => Date;
  readonly rng?: RandomSource;
  readonly minContributingTenants?: number;
}

/**
 * Minimum distinct contributing tenants before a benchmark answer is
 * returned. Below this, the service returns `InsufficientAggregationError`
 * to avoid any risk of single-tenant reidentification even with noise.
 */
export const MIN_CONTRIBUTING_TENANTS_DEFAULT = 3;

export class InsufficientAggregationError extends Error {
  constructor(readonly queryId: string, readonly actual: number, readonly required: number) {
    super(
      `Insufficient cross-tenant aggregation for query ${queryId}: ${actual} contributors, need ${required}`,
    );
    this.name = 'InsufficientAggregationError';
  }
}

export interface QueryOptions {
  readonly tenantId: string;
  readonly epsilon: number;
  /** Optional deterministic override for the feature label. */
  readonly feature?: string;
}

export class CrossTenantQueryService {
  private readonly ledger: PrivacyBudgetLedger;
  private readonly aggregator: PatternAggregator;
  private readonly now: () => Date;
  private readonly rng: RandomSource;
  private readonly minContributingTenants: number;

  constructor(config: CrossTenantQueryServiceConfig) {
    this.ledger = config.ledger;
    this.aggregator = config.aggregator;
    this.now = config.now ?? (() => new Date());
    this.rng = config.rng ?? Math.random;
    this.minContributingTenants = config.minContributingTenants ?? MIN_CONTRIBUTING_TENANTS_DEFAULT;
  }

  /**
   * Run an ad-hoc DP-protected benchmark query. Debits the caller's
   * privacy budget.
   */
  async queryIndustryBenchmark(query: DPQuery, options: QueryOptions): Promise<DPQueryResult> {
    if (!options.tenantId) throw new Error('tenantId is required');
    if (!query.id) throw new Error('query.id is required');
    if (options.epsilon <= 0) throw new Error('epsilon must be > 0');
    if (query.sensitivity <= 0) throw new Error('query.sensitivity must be > 0');

    const featureLabel = options.feature ?? featureFromQuery(query);

    // Pull aggregate BEFORE consuming budget — a missing pool is not the
    // tenant's fault and should not cost them ε.
    const aggregate = this.aggregator.aggregate(query.domain, featureLabel, query.filters);
    if (!aggregate) {
      throw new InsufficientAggregationError(query.id, 0, this.minContributingTenants);
    }
    if (aggregate.contributingTenantCount < this.minContributingTenants) {
      throw new InsufficientAggregationError(
        query.id,
        aggregate.contributingTenantCount,
        this.minContributingTenants,
      );
    }

    // Debit the caller's budget. Throws `BudgetExceededError` when the
    // caller is out of ε for the window.
    await this.ledger.consume(options.tenantId, options.epsilon);

    const noisy = addLaplaceNoise(
      aggregate.value,
      query.sensitivity,
      options.epsilon,
      this.rng,
    );
    const ci = laplaceConfidenceInterval(noisy, query.sensitivity, options.epsilon);

    return {
      queryId: query.id,
      value: noisy,
      noisy: true,
      epsilonUsed: options.epsilon,
      confidence: ci,
      sampleSize: aggregate.sampleSize,
      generatedAt: this.now().toISOString(),
    };
  }
}

/**
 * Derive a stable feature label from the query when the caller did not
 * set one explicitly. The pattern aggregator is keyed on
 * `(domain, feature, filters)`, so the label must be deterministic
 * across contribution and query sites.
 */
function featureFromQuery(query: DPQuery): string {
  return `${query.aggregation}:${query.domain}`;
}
