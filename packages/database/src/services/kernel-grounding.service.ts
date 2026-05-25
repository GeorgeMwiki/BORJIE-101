/**
 * Kernel grounding service — Drizzle-backed
 * `GroundingFactsProvider` implementation.
 *
 * TODO(borjie-hard-fork): the original implementation read occupancy,
 * vacant unit count, active leases, open work-orders, and lease-
 * expiring counts from property-domain tables (properties, units,
 * leases, work_orders, customers) that were deleted in migration
 * 0003_mining_domain.sql. This file is a no-op shim that returns an
 * empty fact set so the kernel composition root keeps booting. Restore
 * mining-domain equivalents (production-sales tonnage, fleet
 * utilisation, open licences, etc.) before re-enabling grounding.
 */

import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

// Duck-typed copy of the kernel's port — keep in sync with
// @borjie/central-intelligence/kernel/kernel-types.ts.
export interface GroundingFactShape {
  readonly id: string;
  readonly label: string;
  readonly value: string | number;
  readonly unit?: 'pct' | 'count' | 'currency-tzs' | 'currency-kes' | 'days';
  readonly source: string;
  readonly asOf: string;
}

export interface GroundingFactsProviderShape {
  fetch(args: {
    readonly userMessage: string;
    readonly tier: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<GroundingFactShape>>;
}

export type GroundingViewRole =
  | 'tenant'
  | 'manager'
  | 'owner'
  | 'org-admin'
  | 'sovereign';

export interface KernelGroundingDeps {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly role?: GroundingViewRole;
}

export function createKernelGroundingProvider(
  _db: DatabaseClient,
  deps: KernelGroundingDeps,
): GroundingFactsProviderShape {
  return {
    async fetch(): Promise<ReadonlyArray<GroundingFactShape>> {
      logger.debug(
        'kernel-grounding: stub provider returning empty facts (mining-domain rewrite pending)',
        {
          tenantId: deps.tenantId,
          role: deps.role ?? 'org-admin',
        },
      );
      return [];
    },
  };
}
