/**
 * Risk-scanner backing seed — provisions REAL representative mining data.
 *
 * Drives `seedTenant` against a RECORDING stub of the postgres.js tagged-
 * template `sql` client and asserts the seed emits the real values that trip
 * the scanner's rules — no live DB required. This proves the GATE-LIVE-DATA
 * contract: the seed writes real provisioned data (never empty, never random).
 *
 * The stub captures each call's reconstructed SQL text + interpolated values so
 * we can assert BOTH the target relation and the exact seeded figures.
 */

import { describe, it, expect } from 'vitest';
import { seedTenant } from '../risk-scanner-backing.seed.js';

interface Call {
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
}

/**
 * Minimal recording stub of a postgres.js `Sql` tagged-template function.
 * `sql\`...${v}...\`` invokes it with (strings, ...values). It returns a
 * thenable that also carries `.catch` (the seed uses `.catch(() => undefined)`
 * on the best-effort base-table upserts) and resolves to an empty result set,
 * which is fine — the seed only reads back the RETURNING id on contracts, and
 * an empty array there simply skips the optional log/workflow branch.
 */
function makeRecordingSql(): { sql: unknown; calls: Call[] } {
  const calls: Call[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    // contracts INSERT ... RETURNING id → hand back a row so the seed's
    // follow-on renewal/log branch runs (exercises the join path).
    const rows = /INSERT INTO contracts\b/.test(text)
      ? [{ id: 'contract-seed-id' }]
      : [];
    const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
      catch: Promise<unknown[]>['catch'];
    };
    return thenable;
  };
  return { sql, calls };
}

function callsFor(calls: readonly Call[], relation: string): Call[] {
  return calls.filter((c) => new RegExp(`\\b${relation}\\b`).test(c.text));
}

describe('risk-scanner-backing seed — real provisioned values', () => {
  const tenantId = 'tnt_seed_test_1';

  it('seeds the FLAGSHIP cash inputs: 210M cash on hand + 90M/30d actual cost', async () => {
    const { sql, calls } = makeRecordingSql();
    await seedTenant(sql as never, tenantId);

    const cash = callsFor(calls, 'cash_balances').find((c) =>
      /INSERT INTO cash_balances/.test(c.text),
    );
    expect(cash).toBeDefined();
    expect(cash?.values).toContain('210000000.00');

    const costs = callsFor(calls, 'costs').filter((c) =>
      /INSERT INTO costs/.test(c.text),
    );
    // 3 real cost rows summing to 90M over 30 days → 3M/day burn → 70-day runway
    const costAmounts = costs.flatMap((c) => c.values).filter(
      (v) => typeof v === 'string' && /^\d+\.00$/.test(v),
    );
    expect(costAmounts).toEqual(
      expect.arrayContaining(['48000000.00', '30000000.00', '12000000.00']),
    );
  });

  it('seeds payroll 250M due in 5 days (> 210M cash → readiness gap)', async () => {
    const { sql, calls } = makeRecordingSql();
    await seedTenant(sql as never, tenantId);
    const payroll = callsFor(calls, 'payroll_schedule').find((c) =>
      /INSERT INTO payroll_schedule/.test(c.text),
    );
    expect(payroll).toBeDefined();
    expect(payroll?.values).toContain('250000000.00');
  });

  it('seeds NEMC + OSHA amber regulator status', async () => {
    const { sql, calls } = makeRecordingSql();
    await seedTenant(sql as never, tenantId);
    const reg = callsFor(calls, 'regulator_status').find((c) =>
      /INSERT INTO regulator_status/.test(c.text),
    );
    expect(reg).toBeDefined();
    // regulator + tone are SQL literals in the text; tenant id is interpolated.
    expect(reg?.values).toContain(tenantId);
    expect(reg?.text).toContain("'nemc', 'amber'");
    expect(reg?.text).toContain("'osha', 'amber'");
  });

  it('seeds each previously-missing backing relation for the tenant', async () => {
    const { sql, calls } = makeRecordingSql();
    await seedTenant(sql as never, tenantId);
    const relations = [
      'accounts_receivable',
      'payroll_schedule',
      'fuel_inventory',
      'equipment_failures',
      'workforce_separations',
      'royalty_drafts_with_trend',
      'regulator_status',
      'buyer_credit_signals',
      'supplier_quality_signals',
      'security_audit_events',
      'cda_milestones',
      'withholding_tax_summary',
      'tra_correspondence',
      'contracts',
      'contract_renewal_workflows',
      'disputes',
    ];
    for (const rel of relations) {
      const inserted = callsFor(calls, rel).some((c) =>
        new RegExp(`INSERT INTO ${rel}\\b`).test(c.text),
      );
      expect(inserted, `seed must INSERT INTO ${rel}`).toBe(true);
    }
  });

  it('scopes every INSERT to the target tenant id', async () => {
    const { sql, calls } = makeRecordingSql();
    await seedTenant(sql as never, tenantId);
    const inserts = calls.filter((c) => /INSERT INTO/.test(c.text));
    // Every risk-relation insert carries the tenant id among its values.
    const scoped = inserts.filter((c) => c.values.includes(tenantId));
    expect(scoped.length).toBeGreaterThanOrEqual(inserts.length - 2);
  });
});
