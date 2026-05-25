/**
 * pattern-aggregator.ts — cross-tenant aggregation layer.
 *
 * Anonymisation contract:
 *   Every tenant contribution that enters this layer has ALREADY been
 *   pre-aggregated and coarse-bucketed by the source tenant's pattern
 *   miner. The aggregator's job is to verify that contract, gate
 *   contributions on consent, and produce cross-tenant aggregates that
 *   the DP layer can release.
 *
 *   This module does NOT see:
 *     - raw row-level records
 *     - free-text blobs
 *     - PII fields (names, phones, emails)
 *     - per-lease or per-tenant identifiers
 *
 *   It DOES see:
 *     - domain + feature pair (e.g. "lease.time_on_market", "days")
 *     - a single numeric value per tenant (already aggregated)
 *     - coarse filter spec (jurisdiction / unitType / bedrooms / bucket)
 *     - integer sample size the tenant-side aggregate summarises
 *
 *   Contributions that fail the structural checks are REJECTED (never
 *   silently dropped): the caller gets a typed reason so consent /
 *   contract bugs surface loudly in tests.
 */

import type {
  AggregatedPattern,
  FilterSpec,
  TenantContribution,
} from './types.js';
import type { ConsentManager } from './consent-manager.js';

/** Minimum sample size a source tenant must aggregate over. */
export const MIN_CONTRIBUTION_SAMPLE_SIZE = 5;

/** Numeric rounding quantum: tenant-side values must already be rounded. */
export const CONTRIBUTION_VALUE_QUANTUM = 0.01;

export type ContributionRejectionReason =
  | 'not_opted_in'
  | 'sample_too_small'
  | 'value_not_rounded'
  | 'non_finite_value'
  | 'missing_domain_or_feature'
  | 'negative_sample_size'
  | 'malformed_filters';

export class ContributionRejectedError extends Error {
  constructor(
    readonly reason: ContributionRejectionReason,
    readonly contribution: TenantContribution,
  ) {
    super(`Contribution rejected: ${reason}`);
    this.name = 'ContributionRejectedError';
  }
}

export interface PatternAggregatorConfig {
  readonly consent: ConsentManager;
  readonly minSampleSize?: number;
  readonly valueQuantum?: number;
}

export class PatternAggregator {
  private readonly consent: ConsentManager;
  private readonly minSampleSize: number;
  private readonly valueQuantum: number;
  /**
   * Cross-tenant pool, indexed by a composite key. Each entry stores
   * one contribution per tenant — a tenant cannot stack contributions
   * on the same key and inflate their influence in a single window.
   */
  private readonly pool = new Map<string, Map<string, TenantContribution>>();

  constructor(config: PatternAggregatorConfig) {
    this.consent = config.consent;
    this.minSampleSize = config.minSampleSize ?? MIN_CONTRIBUTION_SAMPLE_SIZE;
    this.valueQuantum = config.valueQuantum ?? CONTRIBUTION_VALUE_QUANTUM;
  }

  /**
   * Accept a tenant contribution into the aggregate pool. Throws
   * `ContributionRejectedError` when the contract is not met — tests
   * rely on the throw to prove opt-out + PII guards hold.
   */
  async contribute(contribution: TenantContribution): Promise<void> {
    this.assertStructuralContract(contribution);
    const allowed = await this.consent.mayContributeBenchmark(contribution.tenantId);
    if (!allowed) {
      throw new ContributionRejectedError('not_opted_in', contribution);
    }
    const key = compositeKey(contribution.domain, contribution.feature, contribution.filters);
    const tenantBucket = this.pool.get(key) ?? new Map<string, TenantContribution>();
    tenantBucket.set(contribution.tenantId, { ...contribution, filters: { ...contribution.filters } });
    this.pool.set(key, tenantBucket);
  }

  /**
   * Aggregate the pool into `{domain, feature, filters, value,
   * sampleSize, contributingTenantCount}` tuples. `value` is the
   * sample-weighted mean of contributions; `sampleSize` is the sum.
   */
  aggregate(domain: string, feature: string, filters: FilterSpec = {}): AggregatedPattern | null {
    const key = compositeKey(domain, feature, filters);
    const bucket = this.pool.get(key);
    if (!bucket || bucket.size === 0) return null;
    let weightedSum = 0;
    let totalSamples = 0;
    for (const entry of bucket.values()) {
      weightedSum += entry.value * entry.sampleSize;
      totalSamples += entry.sampleSize;
    }
    if (totalSamples === 0) return null;
    return {
      domain,
      feature,
      filters: { ...filters },
      value: weightedSum / totalSamples,
      sampleSize: totalSamples,
      contributingTenantCount: bucket.size,
    };
  }

  /** Enumerate all known `(domain, feature, filters)` triples. */
  listKeys(): readonly { domain: string; feature: string; filters: FilterSpec }[] {
    return Array.from(this.pool.keys()).map(parseCompositeKey);
  }

  /** Drop every pool entry contributed by a given tenant (opt-out flow). */
  purgeTenant(tenantId: string): void {
    for (const bucket of this.pool.values()) {
      bucket.delete(tenantId);
    }
  }

  // -------------------------------------------------------------------
  // Structural guards
  // -------------------------------------------------------------------

  private assertStructuralContract(contribution: TenantContribution): void {
    if (!contribution.tenantId) {
      throw new ContributionRejectedError('missing_domain_or_feature', contribution);
    }
    if (!contribution.domain || !contribution.feature) {
      throw new ContributionRejectedError('missing_domain_or_feature', contribution);
    }
    if (!Number.isFinite(contribution.value)) {
      throw new ContributionRejectedError('non_finite_value', contribution);
    }
    if (!Number.isInteger(contribution.sampleSize) || contribution.sampleSize < 0) {
      throw new ContributionRejectedError('negative_sample_size', contribution);
    }
    if (contribution.sampleSize < this.minSampleSize) {
      throw new ContributionRejectedError('sample_too_small', contribution);
    }
    if (!isRoundedTo(contribution.value, this.valueQuantum)) {
      throw new ContributionRejectedError('value_not_rounded', contribution);
    }
    if (!filtersAreCoarse(contribution.filters)) {
      throw new ContributionRejectedError('malformed_filters', contribution);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compositeKey(domain: string, feature: string, filters: FilterSpec): string {
  return [
    domain,
    feature,
    filters.jurisdiction ?? '',
    filters.unitType ?? '',
    filters.bedrooms ?? '',
    filters.bucket ?? '',
  ].join('||');
}

function parseCompositeKey(key: string): { domain: string; feature: string; filters: FilterSpec } {
  const [domain, feature, jurisdiction, unitType, bedrooms, bucket] = key.split('||');
  const filters: Record<string, unknown> = {};
  if (jurisdiction) filters.jurisdiction = jurisdiction;
  if (unitType) filters.unitType = unitType;
  if (bedrooms) filters.bedrooms = Number(bedrooms);
  if (bucket) filters.bucket = bucket;
  return { domain, feature, filters: filters as FilterSpec };
}

/**
 * Reject anything that looks like a per-row identifier. Filters must be
 * short enums / strings — no free-text blobs, no UUIDs, no emails.
 */
function filtersAreCoarse(filters: FilterSpec): boolean {
  if (!filters || typeof filters !== 'object') return false;
  const allowedKeys = new Set(['jurisdiction', 'unitType', 'bedrooms', 'bucket']);
  for (const key of Object.keys(filters)) {
    if (!allowedKeys.has(key)) return false;
  }
  for (const value of [filters.jurisdiction, filters.unitType, filters.bucket]) {
    if (value == null) continue;
    if (typeof value !== 'string') return false;
    if (value.length > 64) return false;
    if (/@/.test(value)) return false; // bans emails
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return false; // bans UUIDs
    }
  }
  if (filters.bedrooms != null && (!Number.isFinite(filters.bedrooms) || filters.bedrooms > 20)) {
    return false;
  }
  return true;
}

/** Is `v` an integer multiple of `q` (within floating-point slack)? */
function isRoundedTo(v: number, q: number): boolean {
  if (q <= 0) return true;
  const quotient = v / q;
  return Math.abs(quotient - Math.round(quotient)) < 1e-6;
}
