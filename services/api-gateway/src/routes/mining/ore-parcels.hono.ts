/**
 * /api/v1/mining/ore-parcels — physical saleable stockpiles.
 *
 * Routes:
 *   GET   /                       list (filter by siteId, status)
 *   POST  /                       create parcel
 *   POST  /:id/list-for-sale      flip status + create marketplace listing
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { oreParcels, marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  oreParcelsListRoute,
  oreParcelsCreateRoute,
  oreParcelsListForSaleRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(oreParcelsListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(oreParcels.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(oreParcels.siteId, q.siteId));
  if (q.status) conds.push(eq(oreParcels.status, q.status));
  const rows = await db
    .select()
    .from(oreParcels)
    .where(and(...conds))
    .orderBy(desc(oreParcels.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  oreParcelsCreateRoute,
  withSecurityEvents(
    { action: 'mining.ore_parcel.create', resource: 'mining.ore_parcel', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(oreParcels)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId,
          massKg: input.massKg ?? null,
          grade: input.grade ?? {},
          storageLocation: input.storageLocation ?? null,
          status: 'in_stockpile',
          photos: input.photos ?? [],
          attributes: input.attributes ?? {},
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  oreParcelsListForSaleRoute,
  withSecurityEvents(
    { action: 'mining.ore_parcel.list', resource: 'mining.ore_parcel', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const { id: parcelId } = c.req.valid('param');
      const input = c.req.valid('json');
      const [parcel] = await db
        .select()
        .from(oreParcels)
        .where(and(eq(oreParcels.id, parcelId), eq(oreParcels.tenantId, tenantId)))
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
      const now = new Date();
      const [listing] = await db
        .insert(marketplaceListings)
        .values({
          id: randomUUID(),
          tenantId,
          category: 'ore_parcel',
          title: input.title,
          description: input.description ?? null,
          priceTzs: input.priceTzs,
          priceUnit: input.priceUnit,
          location: input.location ?? null,
          contactUserId: userId,
          visibility: input.visibility,
          status: 'active',
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          photos: parcel.photos ?? [],
          attributes: {
            parcelId,
            mineralGrade: parcel.grade ?? {},
            massKg: parcel.massKg,
          },
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return c.json({ success: true as const, data: { parcel, listing } }, 201);
    },
  ),
);

export const miningOreParcelsRouter = app;
