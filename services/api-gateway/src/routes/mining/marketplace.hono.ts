// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/marketplace — public listings discovery.
 *
 * Routes:
 *   GET  /listings          search (filter by mineral, region, grade,
 *                           category, visibility)
 *   GET  /listings/:id      fetch one
 */

import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { marketplaceListings } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/listings', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const mineral = c.req.query('mineral');
  const region = c.req.query('region');
  const grade = c.req.query('grade');
  const category = c.req.query('category');
  const visibility = c.req.query('visibility');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const conds = [eq(marketplaceListings.status, 'active')];
  // Tenant scope is permissive — buyers from other tenants can see
  // `tanzania` / `regional` / `global` visibility listings.
  if (visibility === 'private') conds.push(eq(marketplaceListings.tenantId, tenantId));
  if (category) conds.push(eq(marketplaceListings.category, category));
  if (visibility) conds.push(eq(marketplaceListings.visibility, visibility));
  // mineral + grade live inside the attributes JSON
  if (mineral) {
    conds.push(sql`${marketplaceListings.attributes}->>'mineral' = ${mineral}`);
  }
  if (grade) {
    conds.push(sql`${marketplaceListings.attributes}->>'grade' = ${grade}`);
  }
  if (region) {
    conds.push(sql`${marketplaceListings.attributes}->>'region' = ${region}`);
  }
  const rows = await db
    .select()
    .from(marketplaceListings)
    .where(and(...conds))
    .orderBy(desc(marketplaceListings.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.get('/listings/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, id))
    .limit(1);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Listing not found' } }, 404);
  }
  return c.json({ success: true, data: row });
});

export const miningMarketplaceRouter = app;
