/**
 * Kernel cohort service — Drizzle-backed `TenantAggregateSource`
 * implementation for `@borjie/graph-privacy`'s DP aggregator.
 *
 * TODO(borjie-hard-fork): the original implementation pulled per-
 * tenant arrears, collections, renewal, and maintenance-TTC
 * contributions from property-domain tables (leases, invoices,
 * payments, arrears_cases, work_orders). Those tables were removed
 * in migration 0003_mining_domain.sql. This file now returns the
 * empty platform slice so the aggregator emits a structured
 * `slice_empty` refusal instead of throwing — restore mining-domain
 * statistics (tonnage, recovery rates, royalty payments, etc.) before
 * re-enabling the DP cohort path.
 */

import { tenants } from '../schemas/tenant.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

export interface PlatformSliceShape {
  readonly jurisdictions: ReadonlyArray<string>;
  readonly propertyClasses: ReadonlyArray<string>;
  readonly from: string;
  readonly to: string;
}

export interface ContributionsArgs {
  readonly tenantId: string;
  readonly statistic: string;
  readonly slice: PlatformSliceShape;
}

export interface TenantAggregateSourceShape {
  contributionsFor(args: ContributionsArgs): Promise<ReadonlyArray<number>>;
  eligibleTenants(slice: PlatformSliceShape): Promise<ReadonlyArray<string>>;
}

export function createPgTenantAggregateSource(
  db: DatabaseClient,
): TenantAggregateSourceShape {
  return {
    async eligibleTenants(_slice) {
      try {
        const rows = await db.select({ id: tenants.id }).from(tenants);
        return rows.map((r) => r.id);
      } catch (err) {
        logger.warn(
          'kernel-cohort: eligibleTenants read failed; returning empty slice',
          { err: err instanceof Error ? err.message : String(err) },
        );
        return [];
      }
    },
    async contributionsFor(_args) {
      // Mining-domain statistics not yet implemented — return empty so
      // the aggregator emits slice_empty rather than NaN/throw.
      return [];
    },
  };
}
