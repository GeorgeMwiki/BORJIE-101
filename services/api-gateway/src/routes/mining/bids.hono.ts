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
import {
  buyers,
  marketplaceBids,
  marketplaceListings,
  offtakeAgreements,
} from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
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
      // RT-1: pulse the seller's cockpit "Incoming Offers" tile.
      if (bid) {
        setImmediate(() => {
          try {
            publishCockpitEvent({
              kind: 'bid.placed',
              tenantId,
              emittedAt: new Date().toISOString(),
              bidId: bid.id,
              parcelId: listing.id,
              amountTzs: Number(input.bidPriceTzs),
              bidderId: buyer.id,
            });
          } catch {
            // bus failures must never leak to the request response.
          }
        });
      }
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

/**
 * Resolve the contract quantity (kg) from the listing's free-form
 * attributes. Marketplace listings carry no first-class quantity column;
 * the volume lives under `attributes.quantity_kg` (or the camelCase
 * `quantityKg`). Defaults to `0` when absent so the contract still
 * crystallizes — the parties refine the figure before signing.
 */
function resolveQuantityKg(attributes: unknown): string {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const raw = attrs.quantity_kg ?? attrs.quantityKg;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n.toFixed(3) : '0.000';
}

/**
 * Crystallize the binding offtake agreement for an accepted bid.
 *
 * IDEMPOTENT on `bid_id` (UNIQUE in migration 0325): re-accepting the
 * same bid never creates a second contract. The amounts are CONTRACT
 * TERMS, not ledger entries — no money is posted here; settlement still
 * flows through `LedgerService.post()`.
 *
 * Runs inside the caller's tenant-bound transaction so the bid flip and
 * the contract insert commit (or roll back) together.
 */
async function crystallizeOfftakeAgreement(
  tx: DrizzleDb,
  tenantId: string,
  bid: {
    id: string;
    listingId: string;
    buyerId: string;
    bidPriceTzs: string;
    paymentTerms: string | null;
  },
  listingAttributes: unknown,
): Promise<void> {
  await tx
    .insert(offtakeAgreements)
    .values({
      id: randomUUID(),
      tenantId,
      listingId: bid.listingId,
      bidId: bid.id,
      buyerId: bid.buyerId,
      buyerTenantId: null,
      agreedPriceTzs: bid.bidPriceTzs,
      quantityKg: resolveQuantityKg(listingAttributes),
      paymentTerms: bid.paymentTerms,
      status: 'pending_signature',
    })
    .onConflictDoNothing({ target: offtakeAgreements.bidId });
}

app.openapi(
  bidsAcceptRoute,
  withSecurityEvents(
    { action: 'mining.bid.accept', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const { id } = c.req.valid('param');

      // Flip the bid to accepted AND crystallize the binding offtake
      // agreement in ONE tenant-bound transaction so the two either both
      // commit or both roll back. The contract insert is idempotent on
      // bid_id (migration 0325 UNIQUE), so an at-least-once retry / double
      // accept never produces a second agreement and never errors.
      //
      // NOTE: money is NOT moved here. agreed_price_tzs / quantity_kg are
      // CONTRACT TERMS; settlement still routes through LedgerService.post().
      let updated: Record<string, unknown> | null = null;
      try {
        updated = await db.transaction(async (tx: DrizzleDb) => {
          const flipped = await setBidStatus(tx, tenantId, id, 'accepted', {
            acceptedAt: new Date().toISOString(),
          });
          if (!flipped) return null;

          // Re-read the listing INSIDE the tx (tenant-scoped) so the
          // contract terms (quantity) come from a consistent snapshot.
          const [listing] = await tx
            .select({ attributes: marketplaceListings.attributes })
            .from(marketplaceListings)
            .where(
              and(
                eq(marketplaceListings.id, flipped.listingId),
                eq(marketplaceListings.tenantId, tenantId),
              ),
            )
            .limit(1);

          await crystallizeOfftakeAgreement(
            tx,
            tenantId,
            {
              id: flipped.id,
              listingId: flipped.listingId,
              buyerId: flipped.buyerId,
              bidPriceTzs: flipped.bidPriceTzs,
              paymentTerms: flipped.paymentTerms ?? null,
            },
            listing?.attributes ?? {},
          );
          return flipped;
        });
      } catch (error) {
        c.get('logger')?.error?.(
          { err: error, bidId: id },
          'bid accept / offtake crystallization failed',
        );
        return c.json(
          {
            success: false as const,
            error: {
              code: 'ACCEPT_FAILED',
              message: 'Could not accept bid. Imeshindikana kukubali zabuni.',
            },
          },
          500,
        );
      }

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

// ---------------------------------------------------------------------------
// GET /incoming — seller-side: list bids on listings owned by the
// calling tenant (the owner cockpit "Incoming Offers" card).
//
// Filters by tenant only — every marketplace_bids row already carries
// the seller tenant_id (RLS enforces). Optional `status` filter.
// ---------------------------------------------------------------------------

app.get('/incoming', async (c: any) => {
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
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const statusParam = c.req.query('status') as string | undefined;
  const allowedStatuses = new Set([
    'pending',
    'accepted',
    'rejected',
    'countered',
    'withdrawn',
  ]);
  const status =
    statusParam && allowedStatuses.has(statusParam) ? statusParam : undefined;

  const conds = [eq(marketplaceBids.tenantId, auth.tenantId)];
  if (status) {
    conds.push(eq(marketplaceBids.status, status));
  }
  const rows = await db
    .select()
    .from(marketplaceBids)
    .where(and(...conds))
    .orderBy(desc(marketplaceBids.createdAt))
    .limit(200);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// GET /mine — buyer-side: list MY active bids across listings.
//
// Resolves the calling user's KYC'd `buyers` row, then lists every
// `marketplace_bids` row tied to that buyer. Persona-tool surface for
// the buyer-mobile "My bids" stack (composition/brain-tools/
// buyer-tools.ts — buyerMyBidsTool). Optional `status` filter.
// ---------------------------------------------------------------------------

app.get('/mine', async (c: any) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  const statusParam = c.req.query('status') as string | undefined;
  const allowedStatuses = new Set([
    'pending',
    'accepted',
    'rejected',
    'countered',
    'withdrawn',
    'active',
  ]);
  const status =
    statusParam && allowedStatuses.has(statusParam) ? statusParam : undefined;

  const buyer = await findLinkedBuyer(db, auth.tenantId, auth.userId);
  if (!buyer) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  const conds = [
    eq(marketplaceBids.tenantId, auth.tenantId),
    eq(marketplaceBids.buyerId, buyer.id),
  ];
  if (status && status !== 'active') {
    conds.push(eq(marketplaceBids.status, status));
  } else if (status === 'active') {
    conds.push(eq(marketplaceBids.status, 'pending'));
  }
  const rows = await db
    .select()
    .from(marketplaceBids)
    .where(and(...conds))
    .orderBy(desc(marketplaceBids.createdAt))
    .limit(200);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// GET /offtake-agreements — SELLER-side: every binding offtake agreement
// crystallized for the calling (seller) tenant. Tenant-scoped only — every
// offtake_agreements row carries the seller tenant_id and RLS enforces it.
// Optional `status` filter (pending_signature | signed | ...).
//
// Registered BEFORE the `/:id` param route so the literal segment never
// falls through to the bid-detail handler.
// ---------------------------------------------------------------------------

app.get('/offtake-agreements', async (c: any) => {
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
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const statusParam = c.req.query('status') as string | undefined;
  const allowedStatuses = new Set([
    'pending_signature',
    'signed',
    'cancelled',
    'completed',
  ]);
  const status =
    statusParam && allowedStatuses.has(statusParam) ? statusParam : undefined;

  const conds = [eq(offtakeAgreements.tenantId, auth.tenantId)];
  if (status) {
    conds.push(eq(offtakeAgreements.status, status));
  }
  const rows = await db
    .select()
    .from(offtakeAgreements)
    .where(and(...conds))
    .orderBy(desc(offtakeAgreements.createdAt))
    .limit(200);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// GET /offtake-agreements/mine — BUYER-side: the binding offtake agreements
// for the calling buyer. Resolves the calling user's KYC'd `buyers` row,
// then lists every offtake_agreements row tied to that buyer. Tenant-scoped
// (RLS) + buyer-scoped (belt-and-braces predicate).
//
// Registered BEFORE `GET /offtake-agreements` would otherwise shadow it?
// No — Hono matches the longer literal path first; both are literal. Listed
// here for locality with the seller read.
// ---------------------------------------------------------------------------

app.get('/offtake-agreements/mine', async (c: any) => {
  const auth = c.get('auth') as
    | { tenantId?: string; userId?: string }
    | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  const buyer = await findLinkedBuyer(db, auth.tenantId, auth.userId);
  if (!buyer) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  const rows = await db
    .select()
    .from(offtakeAgreements)
    .where(
      and(
        eq(offtakeAgreements.tenantId, auth.tenantId),
        eq(offtakeAgreements.buyerId, buyer.id),
      ),
    )
    .orderBy(desc(offtakeAgreements.createdAt))
    .limit(200);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// GET /:id — buyer-side: fetch ONE of the calling buyer's own bids.
//
// Scoped to (tenant + buyers.linked_user_id) so a buyer can only read a
// bid they themselves placed; cross-buyer / cross-tenant reads 404 (no
// existence leak). Joins the target listing so the buyer-mobile bid
// detail screen has the listing title + attributes (mineral, quantity,
// per-kg hint) without a second round-trip. The message thread is loaded
// separately via the bid-messaging surface, so no thread is embedded.
//
// Registered AFTER the literal `/incoming` and `/mine` routes so those
// never fall through to this param route; a UUID guard rejects anything
// that is not a bid id.
// ---------------------------------------------------------------------------

app.get('/:id', async (c: any) => {
  const auth = c.get('auth') as
    | { tenantId?: string; userId?: string }
    | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  const bidId = c.req.param('id');
  if (!bidId || !/^[0-9a-f-]{36}$/i.test(bidId)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BID_ID', message: 'bid id must be a UUID' },
      },
      400,
    );
  }

  const buyer = await findLinkedBuyer(db, auth.tenantId, auth.userId);
  if (!buyer) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Bid not found' },
      },
      404,
    );
  }

  const [row] = await db
    .select({
      bid: marketplaceBids,
      listing: {
        id: marketplaceListings.id,
        title: marketplaceListings.title,
        category: marketplaceListings.category,
        priceTzs: marketplaceListings.priceTzs,
        attributes: marketplaceListings.attributes,
      },
    })
    .from(marketplaceBids)
    .innerJoin(
      marketplaceListings,
      eq(marketplaceListings.id, marketplaceBids.listingId),
    )
    .where(
      and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceBids.tenantId, auth.tenantId),
        eq(marketplaceBids.buyerId, buyer.id),
      ),
    )
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Bid not found' },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: row }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/withdraw — buyer-side: withdraw an own pending bid.
//
// Refuses unless the calling user owns the bid (via buyers.linked_user_id).
// Idempotent on already-withdrawn — returns the existing row.
// Stamps `withdrawnAt` + `withdrawalReason` into attributes.jsonb so the
// audit-trail captures the why.
// ---------------------------------------------------------------------------

app.post('/:id/withdraw', async (c: any) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db') as DrizzleDb;
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database not configured' },
      },
      503,
    );
  }

  const bidId = c.req.param('id');
  if (!bidId || !/^[0-9a-f-]{36}$/i.test(bidId)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BID_ID', message: 'bid id must be a UUID' },
      },
      400,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    reason?: string;
  };

  const buyer = await findLinkedBuyer(db, auth.tenantId, auth.userId);
  if (!buyer) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'kyc_required',
          message: 'Complete KYC before withdrawing a bid',
        },
      },
      403,
    );
  }
  const [existing] = await db
    .select()
    .from(marketplaceBids)
    .where(
      and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceBids.tenantId, auth.tenantId),
      ),
    )
    .limit(1);
  if (!existing) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Bid not found' },
      },
      404,
    );
  }
  if (existing.buyerId !== buyer.id) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NOT_BID_OWNER',
          message: 'Only the buyer who placed the bid can withdraw it',
        },
      },
      403,
    );
  }
  if (existing.status === 'withdrawn') {
    return c.json({ success: true as const, data: existing }, 200);
  }
  if (existing.status !== 'pending' && existing.status !== 'countered') {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'BID_TERMINAL',
          message: `Cannot withdraw a bid in '${existing.status}' state`,
        },
      },
      409,
    );
  }
  const [updated] = await db
    .update(marketplaceBids)
    .set({
      status: 'withdrawn',
      attributes: {
        ...((existing.attributes as Record<string, unknown>) ?? {}),
        withdrawnAt: new Date().toISOString(),
        withdrawalReason: body.reason ?? null,
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceBids.tenantId, auth.tenantId),
      ),
    )
    .returning();
  return c.json({ success: true as const, data: updated }, 200);
});

export const miningBidsRouter = app;
