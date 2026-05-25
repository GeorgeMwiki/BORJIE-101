// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/ore-parcels — physical saleable stockpiles.
 *
 * Routes:
 *   GET   /                       list (filter by siteId, status)
 *   POST  /                       create parcel
 *   POST  /:id/list-for-sale      flip status + create marketplace listing
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { oreParcels, marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const StatusEnum = z.enum(['in_stockpile', 'in_transit', 'at_buyer', 'sold', 'spoiled']);

const CreateParcelSchema = z.object({
  siteId: z.string().min(1),
  massKg: z.string().optional(),
  grade: z.record(z.union([z.number(), z.string()])).optional(),
  storageLocation: z.string().optional(),
  photos: z.array(z.string()).optional(),
  attributes: z.record(z.unknown()).optional(),
});

const ListForSaleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  priceTzs: z.string().min(1),
  priceUnit: z.string().default('per_kg'),
  visibility: z.enum(['private', 'tanzania', 'regional', 'global']).default('tanzania'),
  expiresAt: z.string().datetime().optional(),
  location: z.string().optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(oreParcels.tenantId, tenantId)];
  if (siteId) conds.push(eq(oreParcels.siteId, siteId));
  if (status) conds.push(eq(oreParcels.status, status));
  const rows = await db
    .select()
    .from(oreParcels)
    .where(and(...conds))
    .orderBy(desc(oreParcels.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateParcelSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.post(
  '/:id/list-for-sale',
  zValidator('json', ListForSaleSchema),
  withSecurityEvents(
    { action: 'mining.ore_parcel.list', resource: 'mining.ore_parcel', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const parcelId = c.req.param('id');
      const input = c.req.valid('json');
      const [parcel] = await db
        .select()
        .from(oreParcels)
        .where(and(eq(oreParcels.id, parcelId), eq(oreParcels.tenantId, tenantId)))
        .limit(1);
      if (!parcel) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Parcel not found' } }, 404);
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
          attributes: { parcelId, mineralGrade: parcel.grade ?? {}, massKg: parcel.massKg },
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return c.json({ success: true, data: { parcel, listing } }, 201);
    },
  ),
);

export const miningOreParcelsRouter = app;
