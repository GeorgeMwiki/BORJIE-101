// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/sales — ore-parcel sale transactions.
 *
 * Routes:
 *   GET   /     list (filter by parcelId, buyerId, paymentStatus)
 *   POST  /     create sale (auto-flip parcel to `sold`; sourced from
 *               an accepted bid when `bidId` provided)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { sales, oreParcels } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const RouteEnum = z.enum(['BoT', 'MTC', 'export_direct', 'trader', 'domestic', 'other']);

const CreateSaleSchema = z.object({
  parcelId: z.string().min(1),
  buyerId: z.string().optional(),
  bidId: z.string().optional(),
  route: RouteEnum.default('trader'),
  weighbridgeDocId: z.string().optional(),
  vehiclePlate: z.string().optional(),
  driverUserId: z.string().optional(),
  grossPriceUsd: z.string().optional(),
  grossPriceTzs: z.string().optional(),
  fxAtSaleTzsPerUsd: z.string().optional(),
  royaltyPct: z.string().optional(),
  inspectionPct: z.string().optional(),
  vatPct: z.string().optional(),
  otherLevies: z.record(z.unknown()).optional(),
  netTzs: z.string().optional(),
  paymentStatus: z.enum(['pending', 'partial', 'paid', 'cancelled']).default('pending'),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const parcelId = c.req.query('parcelId');
  const buyerId = c.req.query('buyerId');
  const paymentStatus = c.req.query('paymentStatus');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(sales.tenantId, tenantId)];
  if (parcelId) conds.push(eq(sales.parcelId, parcelId));
  if (buyerId) conds.push(eq(sales.buyerId, buyerId));
  if (paymentStatus) conds.push(eq(sales.paymentStatus, paymentStatus));
  const rows = await db
    .select()
    .from(sales)
    .where(and(...conds))
    .orderBy(desc(sales.ts))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateSaleSchema),
  withSecurityEvents(
    { action: 'mining.sale.create', resource: 'mining.sale', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [parcel] = await db
        .select()
        .from(oreParcels)
        .where(and(eq(oreParcels.id, input.parcelId), eq(oreParcels.tenantId, tenantId)))
        .limit(1);
      if (!parcel) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Parcel not found' } }, 404);
      }
      const [row] = await db
        .insert(sales)
        .values({
          id: randomUUID(),
          tenantId,
          parcelId: input.parcelId,
          buyerId: input.buyerId ?? null,
          route: input.route,
          weighbridgeDocId: input.weighbridgeDocId ?? null,
          vehiclePlate: input.vehiclePlate ?? null,
          driverUserId: input.driverUserId ?? null,
          grossPriceUsd: input.grossPriceUsd ?? null,
          grossPriceTzs: input.grossPriceTzs ?? null,
          fxAtSaleTzsPerUsd: input.fxAtSaleTzsPerUsd ?? null,
          royaltyPct: input.royaltyPct ?? null,
          inspectionPct: input.inspectionPct ?? null,
          vatPct: input.vatPct ?? null,
          otherLevies: input.otherLevies ?? {},
          netTzs: input.netTzs ?? null,
          paymentStatus: input.paymentStatus,
          ts: new Date(),
        })
        .returning();
      await db
        .update(oreParcels)
        .set({ status: 'sold' })
        .where(and(eq(oreParcels.id, input.parcelId), eq(oreParcels.tenantId, tenantId)));
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningSalesRouter = app;
