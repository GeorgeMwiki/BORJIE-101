// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
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

export const miningMarketplaceRouter = app;
