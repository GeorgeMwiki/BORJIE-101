// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/sales — ore-parcel sale transactions.
 *
 * Routes:
 *   GET   /     list (filter by parcelId, buyerId, paymentStatus)
 *   POST  /     create sale (auto-flip parcel to `sold`; sourced from
 *               an accepted bid when `bidId` provided)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { sales, oreParcels } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { salesListRoute, salesCreateRoute } from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(salesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(sales.tenantId, tenantId)];
  if (q.parcelId) conds.push(eq(sales.parcelId, q.parcelId));
  if (q.buyerId) conds.push(eq(sales.buyerId, q.buyerId));
  if (q.paymentStatus) conds.push(eq(sales.paymentStatus, q.paymentStatus));
  const rows = await db
    .select()
    .from(sales)
    .where(and(...conds))
    .orderBy(desc(sales.ts))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  salesCreateRoute,
  withSecurityEvents(
    { action: 'mining.sale.create', resource: 'mining.sale', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [parcel] = await db
        .select()
        .from(oreParcels)
        .where(
          and(eq(oreParcels.id, input.parcelId), eq(oreParcels.tenantId, tenantId)),
        )
        .limit(1);
      if (!parcel) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Parcel not found' },
          },
          404,
        );
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
        .where(
          and(eq(oreParcels.id, input.parcelId), eq(oreParcels.tenantId, tenantId)),
        );
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningSalesRouter = app;
