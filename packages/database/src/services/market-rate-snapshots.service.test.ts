/**
 * Unit tests for createMarketRateSnapshotsService.
 *
 * Stubs the Drizzle DatabaseClient with an in-memory chain so we can
 * assert insert captures the right values, listRecent returns rows,
 * and DB failures degrade gracefully (insert rethrows, listRecent
 * returns []).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMarketRateSnapshotsService,
  type MarketRateSnapshotShape,
} from './market-rate-snapshots.service.js';
import type { DatabaseClient } from '../client.js';

interface InsertedRow {
  id: string;
  tenantId: string;
  unitId: string;
  ourRentAmountMinor: number;
  marketSampleSize: number;
  driftFlag: string | null;
  sourceAdapter: string;
}

interface StubOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  selectRows?: ReadonlyArray<unknown>;
}

function makeStubDb(opts: StubOptions = {}): {
  client: DatabaseClient;
  readonly rows: InsertedRow[];
} {
  const rows: InsertedRow[] = [];
  const client = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (opts.failInsert) throw new Error('insert boom');
        rows.push({
          id: String(v.id ?? ''),
          tenantId: String(v.tenantId ?? ''),
          unitId: String(v.unitId ?? ''),
          ourRentAmountMinor: Number(v.ourRentAmountMinor ?? 0),
          marketSampleSize: Number(v.marketSampleSize ?? 0),
          driftFlag: (v.driftFlag ?? null) as string | null,
          sourceAdapter: String(v.sourceAdapter ?? ''),
        });
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const orderByImpl = () => {
            if (opts.failSelect) {
              const fail = Promise.reject(new Error('select boom'));
              fail.catch(() => undefined);
              return Object.assign(fail, {
                limit: () => {
                  const innerFail = Promise.reject(new Error('select boom'));
                  innerFail.catch(() => undefined);
                  return innerFail;
                },
              });
            }
            const promise = Promise.resolve(opts.selectRows ?? []);
            return Object.assign(promise, {
              limit: () => Promise.resolve(opts.selectRows ?? []),
            });
          };
          return { orderBy: orderByImpl };
        },
      }),
    }),
  } as unknown as DatabaseClient;
  return { client, get rows() { return rows; } } as never;
}

const sampleSnapshot: MarketRateSnapshotShape = {
  id: 'mrs1',
  tenantId: 't',
  unitId: 'u1',
  propertyId: 'p1',
  currencyCode: 'TZS',
  ourRentMinor: 50000000,
  marketMedianMinor: 48000000,
  marketP25Minor: 42000000,
  marketP75Minor: 55000000,
  marketSampleSize: 12,
  deltaPct: 0.04,
  driftFlag: 'on_band',
  compRadiusKm: 2,
  sourceAdapter: 'rentometer',
  sourceMetadata: { region: 'dar' },
  modelVersion: 'v1',
  promptHash: null,
  observedAt: '2026-05-08T00:00:00Z',
};

describe('createMarketRateSnapshotsService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('insert() persists the snapshot with the right values', async () => {
    const stub = makeStubDb();
    const svc = createMarketRateSnapshotsService(stub.client);
    const out = await svc.insert(sampleSnapshot);
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.id).toBe('mrs1');
    expect(stub.rows[0]?.ourRentAmountMinor).toBe(50000000);
    expect(stub.rows[0]?.marketSampleSize).toBe(12);
    expect(stub.rows[0]?.driftFlag).toBe('on_band');
    expect(stub.rows[0]?.sourceAdapter).toBe('rentometer');
    expect(out).toEqual(sampleSnapshot);
  });

  it('insert() rethrows DB errors so the agent can record the gap', async () => {
    const stub = makeStubDb({ failInsert: true });
    const svc = createMarketRateSnapshotsService(stub.client);
    await expect(svc.insert(sampleSnapshot)).rejects.toThrow();
  });

  it('insert() validates required fields', async () => {
    const stub = makeStubDb();
    const svc = createMarketRateSnapshotsService(stub.client);
    await expect(
      svc.insert({ ...sampleSnapshot, id: '' }),
    ).rejects.toThrow(/requires/);
    await expect(
      svc.insert({ ...sampleSnapshot, tenantId: '' }),
    ).rejects.toThrow(/requires/);
    await expect(
      svc.insert({ ...sampleSnapshot, unitId: '' }),
    ).rejects.toThrow(/requires/);
  });

  it('listRecent() returns [] when tenantId missing', async () => {
    const stub = makeStubDb();
    const svc = createMarketRateSnapshotsService(stub.client);
    expect(await svc.listRecent('', { unitId: 'u1' })).toEqual([]);
  });

  it('listRecent() returns [] on DB error', async () => {
    const stub = makeStubDb({ failSelect: true });
    const svc = createMarketRateSnapshotsService(stub.client);
    expect(await svc.listRecent('t', { unitId: 'u1' })).toEqual([]);
  });

  it('listRecent() coerces minor-unit numerics and parses driftFlag', async () => {
    const stub = makeStubDb({
      selectRows: [
        {
          id: 'mrs2',
          tenantId: 't',
          unitId: 'u1',
          propertyId: null,
          currencyCode: 'TZS',
          ourRentAmountMinor: '49000000',
          marketMedianMinor: '47000000',
          marketP25Minor: null,
          marketP75Minor: null,
          marketSampleSize: 8,
          deltaPct: 0.04,
          driftFlag: 'above_market',
          compRadiusKm: 1.5,
          sourceAdapter: 'zillow',
          sourceMetadata: {},
          modelVersion: 'v1',
          promptHash: null,
          observedAt: new Date('2026-05-08T00:00:00Z'),
        },
      ],
    });
    const svc = createMarketRateSnapshotsService(stub.client);
    const rows = await svc.listRecent('t', { unitId: 'u1', limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ourRentMinor).toBe(49000000);
    expect(rows[0]?.marketMedianMinor).toBe(47000000);
    expect(rows[0]?.marketP25Minor).toBeNull();
    expect(rows[0]?.driftFlag).toBe('above_market');
    expect(typeof rows[0]?.observedAt).toBe('string');
  });
});
