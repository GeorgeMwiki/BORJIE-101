/**
 * WS-2 (2) — GET /api/v1/mining/marketplace/market-intel.
 *
 * Written FIRST. Reproduces the stub gap: the old handler aggregated
 * ONLY marketplace listings as a proxy benchmark and never read the
 * real LBMA gold fix that fx-feed-cron writes into `external_benchmarks`
 * (source='LBMA'). These tests assert the endpoint returns REAL data:
 * the LBMA AM/PM fix + TZS/USD reference + a marketplace price trend,
 * with commodity / region filters.
 *
 * Harness mirrors marketplace/__tests__/rfb.test.ts (captured-SQL db).
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { miningMarketplaceRouter } from '../marketplace.hono';

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function makeDb(responder: (rec: Recorded, callIndex: number) => unknown) {
  const calls: Recorded[] = [];
  const execute = async (q: unknown) => {
    if (q && typeof q === 'object' && 'queryChunks' in q) {
      const chunks = (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
      const fragments: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === 'object' && 'value' in c) {
          fragments.push((c as { value: string }).value);
        } else {
          params.push(c);
        }
      }
      const rec = { fragments, params };
      calls.push(rec);
      return responder(rec, calls.length - 1);
    }
    return { rows: [] };
  };
  return { db: { execute }, calls };
}

function buildApp(stubs: {
  authResp?: { tenantId?: string; userId?: string } | null;
  db: ReturnType<typeof makeDb>['db'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (stubs.authResp !== null) {
      c.set('auth', stubs.authResp ?? { tenantId: 'tenant-a', userId: 'buyer-1' });
    }
    c.set('db', stubs.db);
    await next();
  });
  app.route('/', miningMarketplaceRouter);
  return app;
}

describe('WS-2 market-intel — GET /market-intel', () => {
  it('401 with no auth context', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ authResp: null, db });
    const res = await app.request('/market-intel');
    expect(res.status).toBe(401);
  });

  it('returns the real LBMA gold fix + FX + marketplace trend', async () => {
    const { db, calls } = makeDb((rec, _i) => {
      const sqlText = rec.fragments.join(' ');
      if (sqlText.includes('external_benchmarks')) {
        // The benchmark read returns the latest LBMA AM/PM + TZS/USD rows
        // that fx-feed-cron wrote.
        return {
          rows: [
            {
              metric_id: 'gold_am_fix_usd_oz',
              value: '2384.40',
              unit: 'USD/oz',
              source: 'LBMA',
              as_of: '2026-06-02T10:30:00Z',
            },
            {
              metric_id: 'gold_pm_fix_usd_oz',
              value: '2391.10',
              unit: 'USD/oz',
              source: 'LBMA',
              as_of: '2026-06-02T15:00:00Z',
            },
            {
              metric_id: 'tzs_usd_mid_rate',
              value: '2614.50',
              unit: 'TZS/USD',
              source: 'BoT',
              as_of: '2026-06-02T08:00:00Z',
            },
          ],
        };
      }
      // marketplace price trend
      return {
        rows: [
          { as_of: '2026-05-20T00:00:00Z', price_tzs: '1000000' },
          { as_of: '2026-05-28T00:00:00Z', price_tzs: '1200000' },
        ],
      };
    });
    const app = buildApp({ db });
    const res = await app.request('/market-intel?commodity=gold&region=Geita');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.commodity).toBe('gold');

    // REAL LBMA fix surfaced.
    expect(body.data.lbma).toBeDefined();
    expect(body.data.lbma.amUsdPerOz).toBeCloseTo(2384.4);
    expect(body.data.lbma.pmUsdPerOz).toBeCloseTo(2391.1);
    expect(body.data.lbma.source).toBe('LBMA');

    // FX reference surfaced.
    expect(body.data.fx.tzsPerUsd).toBeCloseTo(2614.5);

    // Marketplace trend present + benchmark computed.
    expect(body.data.trend).toHaveLength(2);
    expect(body.data.benchmarkTzs).toBeCloseTo(1100000);

    // It MUST have read the real external_benchmarks table (not just listings).
    const readBenchmarks = calls.some((c) =>
      c.fragments.join(' ').includes('external_benchmarks'),
    );
    expect(readBenchmarks).toBe(true);

    // The region filter must reach the trend query.
    const trendCall = calls.find((c) =>
      c.fragments.join(' ').includes('marketplace_listings'),
    );
    expect(trendCall?.params).toContain('Geita');
  });

  it('still returns LBMA when there are no marketplace listings yet', async () => {
    const { db } = makeDb((rec) => {
      if (rec.fragments.join(' ').includes('external_benchmarks')) {
        return {
          rows: [
            {
              metric_id: 'gold_pm_fix_usd_oz',
              value: '2400.00',
              unit: 'USD/oz',
              source: 'LBMA',
              as_of: '2026-06-02T15:00:00Z',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const app = buildApp({ db });
    const res = await app.request('/market-intel?commodity=gold');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.lbma.pmUsdPerOz).toBeCloseTo(2400);
    expect(body.data.trend).toHaveLength(0);
    expect(body.data.benchmarkTzs).toBeNull();
  });
});
