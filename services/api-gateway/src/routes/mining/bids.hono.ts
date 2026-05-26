// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/bids — buyer bids on marketplace listings.
 *
 * Bids are persisted in the dedicated `marketplace_bids` table (see
 * packages/database/src/schemas/marketplace-bids.schema.ts and
 * migration 0006_marketplace_bids.sql). Each row joins to the
 * `marketplace_listings` it targets and the KYC'd `buyers` row placing
 * the bid. Lifecycle (pending → accepted | rejected | countered |
 * withdrawn) is enforced by the `marketplace_bid_status` enum at the
 * database level.
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
import { and, desc, eq } from 'drizzle-orm';
import { buyers, marketplaceBids, marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

const PaymentTermsSchema = z.enum(['instant', 'net_30', 'net_60']);

const PlaceBidSchema = z.object({
  listingId: z.string().min(1),
  bidPriceTzs: z.number().nonnegative(),
  paymentTerms: PaymentTermsSchema.default('instant'),
  notes: z.string().max(2000).optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

/**
 * Resolve (or lazily create) the `buyers` row representing the calling
 * user. Mirrors the previous `ensureEntity('buyer', ...)` workaround so
 * the API surface still accepts a bare `userId` from the auth context.
 */
async function resolveBuyer(
  db: DrizzleDb,
  tenantId: string,
  userId: string,
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: buyers.id })
    .from(buyers)
    .where(
      and(
        eq(buyers.tenantId, tenantId),
        eq(buyers.contactName, userId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(buyers)
    .values({
      id: randomUUID(),
      tenantId,
      name: userId,
      kind: 'trader',
      country: 'TZ',
      contactName: userId,
      kycStatus: 'pending',
      attributes: { user_id: userId },
    })
    .returning({ id: buyers.id });
  return created;
}

app.post(
  '/',
  zValidator('json', PlaceBidSchema),
  withSecurityEvents(
    { action: 'mining.bid.place', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const input = c.req.valid('json');
      const [listing] = await db
        .select()
        .from(marketplaceListings)
        .where(
          and(
            eq(marketplaceListings.id, input.listingId),
            eq(marketplaceListings.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!listing) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Listing not found' } },
          404,
        );
      }
      const buyer = await resolveBuyer(db, tenantId, userId);
      const [bid] = await db
        .insert(marketplaceBids)
        .values({
          id: randomUUID(),
          tenantId,
          listingId: listing.id,
          buyerId: buyer.id,
          bidPriceTzs: input.bidPriceTzs.toFixed(2),
          paymentTerms: input.paymentTerms,
          notes: input.notes ?? null,
          status: 'pending',
        })
        .returning();
      return c.json({ success: true, data: bid }, 201);
    },
  ),
);

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db') as DrizzleDb;
  const listingId = c.req.query('listing_id');
  if (!listingId) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'listing_id required' } },
      400,
    );
  }
  const rows = await db
    .select({
      bid: marketplaceBids,
      listing: {
        id: marketplaceListings.id,
        title: marketplaceListings.title,
        category: marketplaceListings.category,
      },
      buyer: {
        id: buyers.id,
        name: buyers.name,
        kind: buyers.kind,
      },
    })
    .from(marketplaceBids)
    .innerJoin(
      marketplaceListings,
      eq(marketplaceListings.id, marketplaceBids.listingId),
    )
    .innerJoin(buyers, eq(buyers.id, marketplaceBids.buyerId))
    .where(
      and(
        eq(marketplaceBids.tenantId, tenantId),
        eq(marketplaceBids.listingId, listingId),
      ),
    )
    .orderBy(desc(marketplaceBids.createdAt))
    .limit(200);
  return c.json({ success: true, data: rows });
});

async function setBidStatus(
  db: DrizzleDb,
  tenantId: string,
  bidId: string,
  status: 'accepted' | 'rejected',
  extra: Record<string, unknown> = {},
) {
  const [row] = await db
    .select()
    .from(marketplaceBids)
    .where(
      and(eq(marketplaceBids.id, bidId), eq(marketplaceBids.tenantId, tenantId)),
    )
    .limit(1);
  if (!row) return null;
  const nextAttributes = {
    ...((row.attributes as Record<string, unknown>) ?? {}),
    ...extra,
  };
  const [updated] = await db
    .update(marketplaceBids)
    .set({
      status,
      attributes: nextAttributes,
      acceptedAt: status === 'accepted' ? new Date() : row.acceptedAt,
      updatedAt: new Date(),
    })
    .where(
      and(eq(marketplaceBids.id, bidId), eq(marketplaceBids.tenantId, tenantId)),
    )
    .returning();
  return updated;
}

app.post(
  '/:id/accept',
  withSecurityEvents(
    { action: 'mining.bid.accept', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const updated = await setBidStatus(
        db,
        tenantId,
        c.req.param('id'),
        'accepted',
        { acceptedAt: new Date().toISOString() },
      );
      if (!updated) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Bid not found' } },
          404,
        );
      }
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
      const db = c.get('db') as DrizzleDb;
      const body = c.req.valid('json');
      const updated = await setBidStatus(
        db,
        tenantId,
        c.req.param('id'),
        'rejected',
        {
          rejectionReason: body.reason,
          rejectedAt: new Date().toISOString(),
        },
      );
      if (!updated) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Bid not found' } },
          404,
        );
      }
      return c.json({ success: true, data: updated });
    },
  ),
);

export const miningBidsRouter = app;
