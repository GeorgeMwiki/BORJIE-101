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
 *
 * Migrated to `@hono/zod-openapi` (issue #19). Route defs live in
 * `./_openapi/route-defs.ts` so the static spec generator can register
 * them without importing this file's middleware + DB code.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { buyers, marketplaceBids, marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  bidsPlaceRoute,
  bidsListRoute,
  bidsAcceptRoute,
  bidsRejectRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

const KYC_URL = '/api/v1/mining/buyers/kyc';

/**
 * Resolve the `buyers` row bound to the calling user via
 * `buyers.linked_user_id`. Replaces the legacy
 * contact_name == userId lazy-create heuristic (issue #20). If no
 * row exists the caller must complete KYC at POST {KYC_URL} first.
 */
async function findLinkedBuyer(
  db: DrizzleDb,
  tenantId: string,
  userId: string,
): Promise<{ id: string; kycStatus: string } | null> {
  const [existing] = await db
    .select({ id: buyers.id, kycStatus: buyers.kycStatus })
    .from(buyers)
    .where(
      and(eq(buyers.tenantId, tenantId), eq(buyers.linkedUserId, userId)),
    )
    .limit(1);
  return existing ?? null;
}

app.openapi(
  bidsPlaceRoute,
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
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Listing not found' },
          },
          404,
        );
      }
      const buyer = await findLinkedBuyer(db, tenantId, userId);
      if (!buyer) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'kyc_required',
              message: 'Complete KYC before placing a bid',
            },
            kyc_url: KYC_URL,
          },
          403,
        );
      }
      if (buyer.kycStatus === 'rejected') {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'kyc_rejected',
              message: 'Your KYC submission was rejected; bidding is disabled',
            },
            kyc_url: KYC_URL,
          },
          403,
        );
      }
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
      return c.json({ success: true as const, data: bid }, 201);
    },
  ),
);

app.openapi(bidsListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db') as DrizzleDb;
  const { listing_id: listingId } = c.req.valid('query');
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
  return c.json({ success: true as const, data: rows }, 200);
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

app.openapi(
  bidsAcceptRoute,
  withSecurityEvents(
    { action: 'mining.bid.accept', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const { id } = c.req.valid('param');
      const updated = await setBidStatus(db, tenantId, id, 'accepted', {
        acceptedAt: new Date().toISOString(),
      });
      if (!updated) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Bid not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: updated }, 200);
    },
  ),
);

app.openapi(
  bidsRejectRoute,
  withSecurityEvents(
    { action: 'mining.bid.reject', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await setBidStatus(db, tenantId, id, 'rejected', {
        rejectionReason: body.reason,
        rejectedAt: new Date().toISOString(),
      });
      if (!updated) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Bid not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: updated }, 200);
    },
  ),
);

export const miningBidsRouter = app;
