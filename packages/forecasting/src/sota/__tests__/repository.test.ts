/**
 * forecast_runs repository — in-memory + SQL adapter tests.
 *
 * Pins:
 *  - first insert per tenant uses GENESIS_HASH as prev_hash
 *  - chain head advances on each subsequent insert
 *  - findById is tenant-scoped (no cross-tenant leakage)
 *  - listForTenant filters by target/model and sorts desc by ranAt
 *  - SQL adapter uses parameterised driver query (we capture calls)
 *
 * Wave SOTA-FORECAST.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryForecastRunRepository,
  createSqlForecastRunRepository,
  type SqlForecastRunDriver,
} from '../repositories/forecast-runs-repository.js';
import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import type { ForecastRunInsert } from '../types.js';

function sampleInsert(overrides: Partial<ForecastRunInsert> = {}): ForecastRunInsert {
  return {
    tenantId: 'tenant-A',
    target: 'gold_price',
    horizon: 5,
    model: 'naive-last',
    pointForecast: [1, 2, 3, 4, 5],
    intervals80: Array.from({ length: 5 }, (_, i) => ({
      step: i + 1,
      lower: i,
      upper: i + 2,
    })),
    intervals95: Array.from({ length: 5 }, (_, i) => ({
      step: i + 1,
      lower: i - 1,
      upper: i + 3,
    })),
    metrics: { mae: 0.5 },
    ...overrides,
  };
}

describe('in-memory forecast_runs repository', () => {
  it('first insert uses GENESIS_HASH as prev_hash', async () => {
    const repo = createInMemoryForecastRunRepository();
    const row = await repo.insert(sampleInsert());
    expect(row.prevHash).toBe(GENESIS_HASH);
    expect(row.auditHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.target).toBe('gold_price');
  });

  it('chain head advances on each subsequent insert', async () => {
    const repo = createInMemoryForecastRunRepository();
    const a = await repo.insert(sampleInsert());
    const b = await repo.insert(sampleInsert({ target: 'production_volume' }));
    expect(b.prevHash).toBe(a.auditHash);
    expect(b.auditHash).not.toBe(a.auditHash);
  });

  it('findById is tenant-scoped — no cross-tenant leakage', async () => {
    const repo = createInMemoryForecastRunRepository();
    const a = await repo.insert(sampleInsert({ tenantId: 'tenant-A' }));
    const found = await repo.findById('tenant-B', a.id);
    expect(found).toBeNull();
    const sameTenant = await repo.findById('tenant-A', a.id);
    expect(sameTenant?.id).toBe(a.id);
  });

  it('listForTenant filters by target + sorts desc by ranAt', async () => {
    let clock = 1_700_000_000_000;
    const repo = createInMemoryForecastRunRepository({
      now: () => new Date((clock += 1000)),
    });
    await repo.insert(sampleInsert({ target: 'gold_price' }));
    await repo.insert(sampleInsert({ target: 'production_volume' }));
    await repo.insert(sampleInsert({ target: 'gold_price' }));
    const all = await repo.listForTenant('tenant-A');
    expect(all).toHaveLength(3);
    expect(all[0]!.ranAt.getTime()).toBeGreaterThanOrEqual(
      all[1]!.ranAt.getTime(),
    );
    const goldOnly = await repo.listForTenant('tenant-A', {
      target: 'gold_price',
    });
    expect(goldOnly).toHaveLength(2);
    for (const row of goldOnly) {
      expect(row.target).toBe('gold_price');
    }
  });

  it('persisted rows are deeply frozen (immutability invariant)', async () => {
    const repo = createInMemoryForecastRunRepository();
    const row = await repo.insert(sampleInsert());
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.pointForecast)).toBe(true);
    expect(Object.isFrozen(row.intervals80)).toBe(true);
  });
});

describe('SQL forecast_runs repository', () => {
  it('inserts via parameterised driver query and returns parsed row', async () => {
    const calls: Array<{ text: string; values: ReadonlyArray<unknown> }> = [];
    const driver: SqlForecastRunDriver = {
      async query(args) {
        calls.push({ text: args.text, values: args.values });
        // 1st call: SELECT for chain head → empty
        if (args.text.includes('SELECT audit_hash')) {
          return [];
        }
        // 2nd call: INSERT ... RETURNING
        return [
          {
            id: 'row-1',
            tenant_id: 'tenant-A',
            target: 'gold_price',
            horizon: 5,
            model: 'naive-last',
            point_forecast: [1, 2, 3, 4, 5],
            intervals_80: [
              { step: 1, lower: 0, upper: 2 },
              { step: 2, lower: 1, upper: 3 },
              { step: 3, lower: 2, upper: 4 },
              { step: 4, lower: 3, upper: 5 },
              { step: 5, lower: 4, upper: 6 },
            ],
            intervals_95: [],
            metrics: { mae: 0.5 },
            ran_at: new Date('2026-05-27T00:00:00.000Z'),
            prev_hash: GENESIS_HASH,
            audit_hash: 'a'.repeat(64),
          },
        ];
      },
    };
    const repo = createSqlForecastRunRepository({ driver });
    const row = await repo.insert(sampleInsert());
    expect(row.id).toBe('row-1');
    expect(calls).toHaveLength(2);
    // The INSERT call uses positional parameters $1..$12.
    expect(calls[1]!.text).toMatch(/\$1, \$2, \$3/);
    expect(calls[1]!.values).toHaveLength(12);
  });

  it('listForTenant builds WHERE clause from optional filter', async () => {
    const captured: Array<{ text: string; values: ReadonlyArray<unknown> }> = [];
    const driver: SqlForecastRunDriver = {
      async query(args) {
        captured.push({ text: args.text, values: args.values });
        return [];
      },
    };
    const repo = createSqlForecastRunRepository({ driver });
    await repo.listForTenant('tenant-A', { target: 'gold_price', model: 'naive-last' });
    expect(captured[0]!.text).toMatch(/tenant_id = \$1/);
    expect(captured[0]!.text).toMatch(/target = \$2/);
    expect(captured[0]!.text).toMatch(/model = \$3/);
    expect(captured[0]!.values).toEqual(['tenant-A', 'gold_price', 'naive-last']);
  });
});
