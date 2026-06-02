/**
 * /api/v1/mining/marketplace — public listings discovery.
 *
 * Routes:
 *   GET  /listings          search (filter by mineral, region, grade,
 *                           category, visibility)
 *   GET  /listings/:id      fetch one
 *
 * Migrated to `@hono/zod-openapi` (issue #19).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, sql } from 'drizzle-orm';
import { marketplaceListings } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  marketplaceListListingsRoute,
  marketplaceGetListingRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(marketplaceListListingsRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const conds = [eq(marketplaceListings.status, 'active')];
  // Tenant scope is permissive — buyers from other tenants can see
  // `tanzania` / `regional` / `global` visibility listings.
  if (q.visibility === 'private') conds.push(eq(marketplaceListings.tenantId, tenantId));
  if (q.category) conds.push(eq(marketplaceListings.category, q.category));
  if (q.visibility) conds.push(eq(marketplaceListings.visibility, q.visibility));
  // mineral + grade live inside the attributes JSON
  if (q.mineral) {
    conds.push(sql`${marketplaceListings.attributes}->>'mineral' = ${q.mineral}`);
  }
  if (q.grade) {
    conds.push(sql`${marketplaceListings.attributes}->>'grade' = ${q.grade}`);
  }
  if (q.region) {
    conds.push(sql`${marketplaceListings.attributes}->>'region' = ${q.region}`);
  }
  const rows = await db
    .select()
    .from(marketplaceListings)
    .where(and(...conds))
    .orderBy(desc(marketplaceListings.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(marketplaceGetListingRoute, async (c) => {
  const db = c.get('db');
  const { id } = c.req.valid('param');
  const [row] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, id))
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Listing not found' },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: row }, 200);
});

// ---------------------------------------------------------------------------
// GET /market-intel — REAL market intelligence (WS-2 (2)).
//
// Backs the buyer persona-tool `mining.marketplace.market-intel`. Returns
// a bounded read-only summary built from THREE real sources:
//
//   1. LBMA gold AM/PM fix — the live values fx-feed-cron
//      (services/api-gateway/src/workers/fx-feed-cron.ts) appends to
//      `external_benchmarks` (source='LBMA', metric_id IN
//      ('gold_am_fix_usd_oz','gold_pm_fix_usd_oz'), unit='USD/oz').
//   2. TZS/USD reference — same feed, source='BoT',
//      metric_id='tzs_usd_mid_rate'.
//   3. Marketplace price trend — the tenant-visible `marketplace_listings`
//      price points over the window (commodity + region filtered), with a
//      simple average benchmark.
//
// Optional `commodity` + `region` filters; bounded by `windowDays`
// (default 30, max 180). All reads go through `db.execute(sql)` so the
// route is unit-testable without a live Postgres and uses parameterised
// SQL (no interpolation). NEVER hard-codes a currency code.
// ---------------------------------------------------------------------------

interface MarketIntelDb {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/market-intel', async (c: any) => {
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db') as MarketIntelDb | null;
  const commodity = (c.req.query('commodity') as string | undefined) ?? 'gold';
  const region = (c.req.query('region') as string | undefined) ?? null;
  const windowDaysRaw = Number(c.req.query('windowDays') ?? 30);
  const windowDays = Math.max(1, Math.min(180, Math.floor(windowDaysRaw || 30)));

  if (!db) {
    return c.json(
      {
        success: true as const,
        data: {
          commodity,
          lbma: null,
          fx: null,
          trend: [] as const,
          benchmarkTzs: null,
          windowDays,
          asOf: new Date().toISOString(),
        },
      },
      200,
    );
  }

  // ---- 1+2: latest external benchmarks (LBMA fix + TZS/USD) -------------
  // DISTINCT ON keeps only the most-recent row per metric. fx-feed-cron is
  // append-only, so "latest as_of" is the live fix.
  const benchRows = rowsOf(
    await db.execute(sql`
      SELECT DISTINCT ON (metric_id)
        metric_id,
        value::text  AS value,
        unit,
        source,
        as_of
        FROM external_benchmarks
       WHERE metric_id IN (
         'gold_am_fix_usd_oz', 'gold_pm_fix_usd_oz', 'tzs_usd_mid_rate'
       )
       ORDER BY metric_id, as_of DESC
    `),
  );
  const byMetric = new Map<string, Record<string, unknown>>();
  for (const r of benchRows) byMetric.set(String(r.metric_id), r);

  const am = byMetric.get('gold_am_fix_usd_oz');
  const pm = byMetric.get('gold_pm_fix_usd_oz');
  const fxRow = byMetric.get('tzs_usd_mid_rate');

  const lbma =
    am || pm
      ? {
          amUsdPerOz: toNum(am?.value),
          pmUsdPerOz: toNum(pm?.value),
          unit: 'USD/oz' as const,
          source: 'LBMA' as const,
          asOf: (pm?.as_of ?? am?.as_of) ?? null,
        }
      : null;

  const fx = fxRow
    ? {
        pair: 'TZS_USD' as const,
        tzsPerUsd: toNum(fxRow.value),
        source: String(fxRow.source ?? 'BoT'),
        asOf: fxRow.as_of ?? null,
      }
    : null;

  // ---- 3: marketplace price trend (commodity + region filtered) ---------
  const trendRows = rowsOf(
    await db.execute(sql`
      SELECT
        created_at      AS as_of,
        price_tzs::text AS price_tzs
        FROM marketplace_listings
       WHERE status = 'active'
         AND created_at >= NOW() - (${windowDays}::int * INTERVAL '1 day')
         AND (${commodity}::text = 'any' OR attributes->>'mineral' = ${commodity})
         AND (${region}::text IS NULL OR attributes->>'region' = ${region})
       ORDER BY created_at ASC
       LIMIT 500
    `),
  );
  const trend = trendRows.map((r) => ({
    asOf: r.as_of,
    priceTzs: toNum(r.price_tzs) ?? 0,
  }));
  const benchmarkTzs =
    trend.length > 0
      ? trend.reduce((s, t) => s + t.priceTzs, 0) / trend.length
      : null;

  return c.json(
    {
      success: true as const,
      data: {
        commodity,
        region,
        lbma,
        fx,
        trend,
        benchmarkTzs,
        windowDays,
        asOf: new Date().toISOString(),
      },
    },
    200,
  );
});

export const miningMarketplaceRouter = app;
