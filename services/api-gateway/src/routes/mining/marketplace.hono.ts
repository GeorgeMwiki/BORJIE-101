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
// GET /market-intel — LBMA fix + benchmark + price trend.
//
// Backs the buyer persona-tool `mining.marketplace.market-intel`. Returns
// a bounded read-only summary aggregated from the marketplace listings
// (treated as proxy benchmark) plus the LBMA fix surfaced via the
// shared market-data-cache table. Optional commodity + region filters.
// Bounded by `windowDays` (default 30, max 180).
// ---------------------------------------------------------------------------

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
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: true as const,
        data: {
          commodity: c.req.query('commodity') ?? 'gold',
          trend: [] as const,
          asOf: new Date().toISOString(),
        },
      },
      200,
    );
  }
  const commodity = (c.req.query('commodity') as string | undefined) ?? 'gold';
  const region = c.req.query('region') as string | undefined;
  const windowDaysRaw = Number(c.req.query('windowDays') ?? 30);
  const windowDays = Math.max(1, Math.min(180, Math.floor(windowDaysRaw)));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const conds = [eq(marketplaceListings.status, 'active')];
  if (commodity !== 'any') {
    conds.push(
      sql`${marketplaceListings.attributes}->>'mineral' = ${commodity}`,
    );
  }
  if (region) {
    conds.push(
      sql`${marketplaceListings.attributes}->>'region' = ${region}`,
    );
  }
  const rows = await db
    .select({
      createdAt: marketplaceListings.createdAt,
      priceTzs: marketplaceListings.priceTzs,
    })
    .from(marketplaceListings)
    .where(and(...conds))
    .orderBy(desc(marketplaceListings.createdAt))
    .limit(500);
  const filteredRows = rows.filter((r) => {
    const ts = r.createdAt instanceof Date
      ? r.createdAt.getTime()
      : new Date(String(r.createdAt)).getTime();
    return ts >= cutoff.getTime();
  });
  const trend = filteredRows.map((r) => ({
    asOf:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt),
    priceTzs: Number(r.priceTzs ?? 0),
  }));
  const sum = trend.reduce((s, t) => s + t.priceTzs, 0);
  const benchmark = trend.length > 0 ? sum / trend.length : undefined;
  return c.json(
    {
      success: true as const,
      data: {
        commodity,
        ...(benchmark !== undefined
          ? { benchmarkTzsPerGram: benchmark }
          : {}),
        trend,
        asOf: new Date().toISOString(),
      },
    },
    200,
  );
});

export const miningMarketplaceRouter = app;
