/**
 * Licences — mining titles sub-area resolver.
 *
 * Backed by `licences` (PL / PML / ML / SML rows). Surfaces:
 *
 *   - activeCount       → licences whose expiry is in the future
 *   - expiringSoonCount → licences expiring within the next 90 days
 *   - expiredCount      → licences already expired (still on file)
 *   - nextExpiryDate    → earliest future expiry across the tenant
 *
 * Status tone:
 *   green   → activeCount > 0 AND zero expired AND zero expiring-soon
 *   amber   → expiringSoonCount >= 1 OR expiredCount BETWEEN 1 AND 2
 *   red     → activeCount == 0 OR expiredCount >= 3
 *   unknown → DB unavailable
 *
 * Filters on the mining-title `kind` only (PL/PML/ML/SML) so the
 * sub-area aligns with the catalog. Other licence kinds (DEALER /
 * BROKER / etc) are surfaced by separate sub-areas as they ship.
 */

import { sql } from 'drizzle-orm';
import type { SubAreaStatus } from '../types';
import type { ResolverDeps } from './types.js';
import { asIso, asNumber, execute } from './utils.js';

export interface LicencesMiningTitlesSummary {
  readonly status: SubAreaStatus['status'];
  readonly activeCount: number;
  readonly expiringSoonCount: number;
  readonly expiredCount: number;
  readonly nextExpiryDate: string | null;
}

/**
 * Tanzanian mining-title kinds we surface under
 * `licences.mining_titles`. Kept inline in the SQL string so PostgreSQL
 * can parameterise the IN-list directly without driver-specific binders.
 */
export const MINING_TITLE_KINDS = ['PL', 'PML', 'ML', 'SML'] as const;

export async function resolveLicencesMiningTitles(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<SubAreaStatus> {
  const summary = await summariseLicencesMiningTitles({ db }, scope);
  const status: SubAreaStatus = {
    status: summary.status,
    note:
      summary.status === 'unknown'
        ? 'database unavailable'
        : summary.activeCount === 0
          ? 'no active mining-title licences'
          : summary.expiringSoonCount > 0
            ? `${summary.activeCount} active; ${summary.expiringSoonCount} expiring within 90 days`
            : summary.expiredCount > 0
              ? `${summary.activeCount} active; ${summary.expiredCount} expired (cleanup)`
              : `${summary.activeCount} active mining-title licence(s)`,
  };
  if (summary.nextExpiryDate) {
    return { ...status, nextExpiryDate: summary.nextExpiryDate };
  }
  return status;
}

export async function summariseLicencesMiningTitles(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<LicencesMiningTitlesSummary> {
  if (!db) {
    return {
      status: 'unknown',
      activeCount: 0,
      expiringSoonCount: 0,
      expiredCount: 0,
      nextExpiryDate: null,
    };
  }
  // The kinds list is a static literal — no user input — but we
  // bind tenantId as a parameter so the GUC + statement-cache path
  // stays clean. `execute()` is failure-tolerant per resolver contract.
  const rows = await execute(
    db,
    sql`
      SELECT
        COUNT(*) FILTER (
          WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE
        )::int AS active_count,
        COUNT(*) FILTER (
          WHERE expiry_date IS NOT NULL
            AND expiry_date >= CURRENT_DATE
            AND expiry_date <  (CURRENT_DATE + INTERVAL '90 days')
        )::int AS expiring_soon_count,
        COUNT(*) FILTER (
          WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
        )::int AS expired_count,
        MIN(expiry_date) FILTER (
          WHERE expiry_date IS NOT NULL AND expiry_date >= CURRENT_DATE
        ) AS next_expiry_date
      FROM licences
      WHERE tenant_id = ${scope.tenantId}
        AND kind IN ('PL', 'PML', 'ML', 'SML')
    `,
  );
  if (rows.length === 0) {
    return {
      status: 'unknown',
      activeCount: 0,
      expiringSoonCount: 0,
      expiredCount: 0,
      nextExpiryDate: null,
    };
  }
  const row = rows[0];
  const activeCount = asNumber(row?.active_count);
  const expiringSoonCount = asNumber(row?.expiring_soon_count);
  const expiredCount = asNumber(row?.expired_count);
  const nextExpiryDate = asIso(row?.next_expiry_date);
  return {
    status: deriveTone({ activeCount, expiringSoonCount, expiredCount }),
    activeCount,
    expiringSoonCount,
    expiredCount,
    nextExpiryDate,
  };
}

function deriveTone(input: {
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
}): SubAreaStatus['status'] {
  if (input.activeCount === 0) return 'red';
  if (input.expiredCount >= 3) return 'red';
  if (input.expiringSoonCount >= 1 || input.expiredCount >= 1) return 'amber';
  return 'green';
}
