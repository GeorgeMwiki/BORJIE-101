/**
 * Opportunity-scanner — DEGRADED self-report (Tier-1 scanner robustness).
 *
 * The false-green this pins: each slice resolver wrapped its reads in one
 * try/catch that degraded to `null` on ANY error, so a MISSING backing table
 * (undefined_table / undefined_column) was indistinguishable from a slice that
 * legitimately has no data. The scanner silently skipped every dependent rule.
 *
 * These tests prove:
 *   (a) a missing relation (SQLSTATE 42P01/42703) surfaces as a DEGRADED
 *       signal (`unavailable: true` + the relation name), NOT a silent null.
 *   (b) a genuine empty slice (no error) stays no-signal (`unavailable: false`).
 *   (c) a non-relation error does NOT mark degraded.
 */

import { describe, expect, it } from 'vitest';
import { resolveScanStateReport } from '../resolver';
import type { ScanStateResolverDb } from '../resolver';

const tenantId = 'tenant-opp-degraded-1';

class PgError extends Error {
  code: string;
  table?: string;
  constructor(code: string, message: string, table?: string) {
    super(message);
    this.code = code;
    if (table !== undefined) this.table = table;
  }
}

function missingTableDb(relation: string): ScanStateResolverDb {
  return {
    execute: async () => {
      throw new PgError(
        '42P01',
        `relation "${relation}" does not exist`,
        relation,
      );
    },
  };
}

function emptyDb(): ScanStateResolverDb {
  return { execute: async () => ({ rows: [] }) };
}

function timeoutDb(): ScanStateResolverDb {
  return {
    execute: async () => {
      throw new PgError('57014', 'canceling statement due to statement timeout');
    },
  };
}

describe('opportunity-scanner — DEGRADED self-report', () => {
  it('surfaces a DEGRADED signal (not a silent null) when a backing relation is missing', async () => {
    const report = await resolveScanStateReport(
      missingTableDb('tra_royalty_election_state'),
      tenantId,
    );
    expect(report.unavailable).toBe(true);
    expect(report.degradedRelations).toContain('tra_royalty_election_state');
    // Every slice degraded — state carries only nulls, but the report is honest.
    expect(report.state.tax).toBeNull();
  });

  it('keeps a genuine empty slice as an honest all-clear (unavailable: false)', async () => {
    const report = await resolveScanStateReport(emptyDb(), tenantId);
    expect(report.unavailable).toBe(false);
    expect(report.degradedRelations).toEqual([]);
  });

  it('does NOT mark degraded on a non-relation error (timeout stays a quiet degrade)', async () => {
    const report = await resolveScanStateReport(timeoutDb(), tenantId);
    expect(report.unavailable).toBe(false);
    expect(report.degradedRelations).toEqual([]);
  });

  it('extracts the relation name from an undefined_column message', async () => {
    const db: ScanStateResolverDb = {
      execute: async () => {
        throw new PgError('42703', 'column "premium_over_fix_pct" does not exist');
      },
    };
    const report = await resolveScanStateReport(db, tenantId);
    expect(report.unavailable).toBe(true);
    expect(report.degradedRelations).toContain('premium_over_fix_pct');
  });
});
