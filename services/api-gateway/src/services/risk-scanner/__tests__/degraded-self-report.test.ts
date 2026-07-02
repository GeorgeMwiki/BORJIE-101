/**
 * Risk-scanner — DEGRADED self-report (Tier-1 scanner robustness).
 *
 * The false-green this pins: `safeExecute` used to swallow EVERY error into
 * `[]`, so a MISSING backing table (undefined_table / undefined_column — a
 * deploy/wiring defect) was indistinguishable from a genuine no-rows result.
 * The scanner reported an all-clear over infra that could not even be read.
 *
 * These tests prove:
 *   (a) a missing relation (SQLSTATE 42P01/42703) surfaces as a DEGRADED
 *       signal (`unavailable: true` + the relation name) — NOT a silent [].
 *   (b) a genuine empty result set (no error) stays no-signal
 *       (`unavailable: false`) — the honest all-clear is preserved.
 *   (c) a non-relation error (e.g. a timeout) does NOT mark degraded — only a
 *       missing relation is self-reportable.
 */

import { describe, expect, it } from 'vitest';
import { scanRisksReport } from '../scanner';
import type { RiskScannerDeps } from '../scanner';

const tenantId = 'tenant-degraded-1';
const now = () => new Date('2026-07-02T00:00:00.000Z');

class PgError extends Error {
  code: string;
  table?: string;
  constructor(code: string, message: string, table?: string) {
    super(message);
    this.code = code;
    if (table !== undefined) this.table = table;
  }
}

/** DB whose reads all throw an undefined_table error for one named relation. */
function missingTableDb(relation: string): RiskScannerDeps['db'] {
  const execute = async (): Promise<unknown> => {
    throw new PgError(
      '42P01',
      `relation "${relation}" does not exist`,
      relation,
    );
  };
  return { execute } as RiskScannerDeps['db'];
}

/** DB that returns a genuine empty result set for every read (no error). */
function emptyDb(): RiskScannerDeps['db'] {
  const execute = async (): Promise<unknown> => ({ rows: [] });
  return { execute } as RiskScannerDeps['db'];
}

/** DB whose reads throw a NON-relation error (timeout class). */
function timeoutDb(): RiskScannerDeps['db'] {
  const execute = async (): Promise<unknown> => {
    throw new PgError('57014', 'canceling statement due to statement timeout');
  };
  return { execute } as RiskScannerDeps['db'];
}

describe('risk-scanner — DEGRADED self-report', () => {
  it('surfaces a DEGRADED signal (not a silent []) when a backing relation is missing', async () => {
    const report = await scanRisksReport(tenantId, {
      db: missingTableDb('accounts_receivable'),
      now,
    });
    // The scan could NOT read its backing data — this must self-report, not
    // masquerade as an all-clear.
    expect(report.unavailable).toBe(true);
    expect(report.degradedRelations).toContain('accounts_receivable');
    // No risks are fabricated from unreadable state.
    expect(report.risks.length).toBe(0);
  });

  it('keeps a genuine no-rows result as an honest all-clear (unavailable: false)', async () => {
    const report = await scanRisksReport(tenantId, { db: emptyDb(), now });
    expect(report.unavailable).toBe(false);
    expect(report.degradedRelations).toEqual([]);
    expect(report.risks.length).toBe(0);
  });

  it('does NOT mark degraded on a non-relation error (timeout stays a quiet degrade)', async () => {
    const report = await scanRisksReport(tenantId, { db: timeoutDb(), now });
    expect(report.unavailable).toBe(false);
    expect(report.degradedRelations).toEqual([]);
  });

  it('extracts the relation name from the message when the driver omits the table field', async () => {
    const execute = async (): Promise<unknown> => {
      // No structured `table` field — only the message carries the name.
      throw new PgError('42P01', 'relation "payroll_schedule" does not exist');
    };
    const report = await scanRisksReport(tenantId, {
      db: { execute } as RiskScannerDeps['db'],
      now,
    });
    expect(report.unavailable).toBe(true);
    expect(report.degradedRelations).toContain('payroll_schedule');
  });
});
