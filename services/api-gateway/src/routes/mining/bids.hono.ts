// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/bids — buyer bids on marketplace listings.
 *
 * Bids are persisted as BID_ON edges in the temporal-entity graph
 * (`temporal_relationships`) until a dedicated `marketplace_bids`
 * schema lands. The bid payload (amount, currency, message, status)
 * lives in `attributes` and the canonical bid id is the edge id.
 *
 * Routes:
 *   POST  /                       buyer places bid
 *   GET   /?listing_id=X          seller view of bids on a listing
 *   POST  /:id/accept             seller accepts
 *   POST  /:id/reject             seller rejects
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { temporalEntities, temporalRelationships, marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const PlaceBidSchema = z.object({
  listingId: z.string().min(1),
  amountTzs: z.number().int().nonnegative().optional(),
  amountUsd: z.number().int().nonnegative().optional(),
  currency: z.enum(['TZS', 'USD']).default('TZS'),
  message: z.string().max(2000).optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

async function ensureEntity(db, tenantId: string, type: string, key: string) {
  const [existing] = await db
    .select()
    .from(temporalEntities)
    .where(
      and(
        eq(temporalEntities.tenantId, tenantId),
        eq(temporalEntities.entityType, type),
        eq(temporalEntities.entityKey, key),
        isNull(temporalEntities.invalidatedAt),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(temporalEntities)
    .values({
      id: randomUUID(),
      tenantId,
      entityType: type,
      entityKey: key,
      attributes: {},
      validFrom: new Date(),
      recordedAt: new Date(),
      confidence: '1.00',
      evidenceIds: [],
      source: 'user:bid',
    })
    .returning();
  return created;
}

app.post(
  '/',
  zValidator('json', PlaceBidSchema),
  withSecurityEvents(
    { action: 'mining.bid.place', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [listing] = await db
        .select()
        .from(marketplaceListings)
        .where(eq(marketplaceListings.id, input.listingId))
        .limit(1);
      if (!listing) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Listing not found' } }, 404);
      }
      const [buyer, listingNode] = await Promise.all([
        ensureEntity(db, tenantId, 'buyer', userId),
        ensureEntity(db, tenantId, 'listing', listing.id),
      ]);
      const [edge] = await db
        .insert(temporalRelationships)
        .values({
          id: randomUUID(),
          tenantId,
          fromEntityId: buyer.id,
          toEntityId: listingNode.id,
          relationship: 'BID_ON',
          attributes: {
            status: 'open',
            amountTzs: input.amountTzs ?? null,
            amountUsd: input.amountUsd ?? null,
            currency: input.currency,
            message: input.message ?? null,
            listingId: listing.id,
            buyerUserId: userId,
          },
          validFrom: new Date(),
          recordedAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: edge }, 201);
    },
  ),
);

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const listingId = c.req.query('listing_id');
  if (!listingId) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'listing_id required' } }, 400);
  }
  const rows = await db
    .select()
    .from(temporalRelationships)
    .where(
      and(
        eq(temporalRelationships.tenantId, tenantId),
        eq(temporalRelationships.relationship, 'BID_ON'),
      ),
    )
    .orderBy(desc(temporalRelationships.recordedAt))
    .limit(200);
  const filtered = rows.filter((r) => (r.attributes as Record<string, unknown>)?.listingId === listingId);
  return c.json({ success: true, data: filtered });
});

async function setBidStatus(db, tenantId: string, bidId: string, status: 'accepted' | 'rejected', extra: Record<string, unknown> = {}) {
  const [row] = await db
    .select()
    .from(temporalRelationships)
    .where(and(eq(temporalRelationships.id, bidId), eq(temporalRelationships.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const merged = { ...(row.attributes as Record<string, unknown>), status, ...extra };
  const [updated] = await db
    .update(temporalRelationships)
    .set({ attributes: merged })
    .where(and(eq(temporalRelationships.id, bidId), eq(temporalRelationships.tenantId, tenantId)))
    .returning();
  return updated;
}

app.post(
  '/:id/accept',
  withSecurityEvents(
    { action: 'mining.bid.accept', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const updated = await setBidStatus(db, tenantId, c.req.param('id'), 'accepted', { acceptedAt: new Date().toISOString() });
      if (!updated) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Bid not found' } }, 404);
      return c.json({ success: true, data: updated });
    },
  ),
);

app.post(
  '/:id/reject',
  zValidator('json', RejectSchema),
  withSecurityEvents(
    { action: 'mining.bid.reject', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const body = c.req.valid('json');
      const updated = await setBidStatus(db, tenantId, c.req.param('id'), 'rejected', { rejectionReason: body.reason, rejectedAt: new Date().toISOString() });
      if (!updated) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Bid not found' } }, 404);
      return c.json({ success: true, data: updated });
    },
  ),
);

export const miningBidsRouter = app;
