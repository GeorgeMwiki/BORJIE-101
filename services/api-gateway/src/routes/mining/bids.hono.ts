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
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { UserRole } from '../../types/user-role';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { enqueueBidOutcomeNotification } from '../../services/buyer-notifications';
import { enqueueSettlementRequested } from '../../services/offtake-settlement';
import {
  bidsPlaceRoute,
  bidsListRoute,
  bidsAcceptRoute,
  bidsRejectRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// Seller-side bid lifecycle (accept / reject / offtake-sign) crystallizes a
// binding commercial contract and enqueues `settlement.requested` (the money
// leg). It is therefore restricted to the seller-org's authorized principals —
// the SAME accounting/ownership tier the sibling cooperative-settlement money
// route gates on (see routes/cooperatives/settlements.hono.ts
// SETTLEMENT_WRITE_ROLES). Without this, ANY authenticated tenant member (incl.
// a low-privilege field worker or a self-registered buyer mapped into the
// tenant) could accept a bid, sign the offtake, and drive settlement. Reads
// (list / incoming / get) stay open to members; only the binding writes gate.
const SELLER_WRITE_ROLES = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.SUPER_ADMIN,
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

const KYC_URL = '/api/v1/mining/buyers/kyc';

/**
 * Build the structured `{ en, sw }` error message the FE renders in the
 * active locale. The WIRE IS LOCALE-NEUTRAL: the stable `code` is the
 * primary; when prose must ride the wire it rides as this STRUCTURED pair
 * so the FE picks one language and never mixes (the `marketplace/rfb`
 * precedent the buyer/owner surfaces already consume). NEVER a
 * concatenated bilingual string, NEVER bare single-language prose.
 */
function localizedMessage(en: string, sw: string): { en: string; sw: string } {
  return { en, sw };
}

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
      // RT-1 / SLICE B2: `tenantId` here is the authenticated BIDDER's
      // (buyer's) tenant, and the cockpit bus partitions strictly per
      // tenant (`cockpit:<tenantId>`), so this pulse lands on the BUYER's
      // OWN channel. That makes it the one marketplace kind buyer-mobile's
      // Live ribbon genuinely receives — buyer-mobile drops the
      // seller/initiator-scoped kinds (rfb.dispatched / settlement.initiated
      // / chat.handoff) that never reach the buyer channel and refreshes the
      // persisted buyer_notifications inbox on this pulse instead.
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

type SetBidStatusResult =
  | { ok: true; row: typeof marketplaceBids.$inferSelect }
  | { ok: false; code: 'NOT_FOUND' | 'BID_NOT_PENDING' };

async function setBidStatus(
  db: DrizzleDb,
  tenantId: string,
  bidId: string,
  status: 'accepted' | 'rejected',
  extra: Record<string, unknown> = {},
): Promise<SetBidStatusResult> {
  const [row] = await db
    .select()
    .from(marketplaceBids)
    .where(
      and(eq(marketplaceBids.id, bidId), eq(marketplaceBids.tenantId, tenantId)),
    )
    .limit(1);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  // Allow the transition from 'pending' (the real state change) OR from the
  // SAME target status (an at-least-once retry / double-submit stays
  // idempotent — crystallizeOfftakeAgreement is UNIQUE on bid_id, so a
  // re-accept never creates a second offtake). A CROSS transition
  // (reject-after-accept / accept-after-reject) is the divergence we reject:
  // it would desync marketplace_bids.status from the crystallized
  // offtake_agreements row and fire a contradictory notification.
  if (row.status !== 'pending' && row.status !== status) {
    return { ok: false, code: 'BID_NOT_PENDING' };
  }
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
      and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceBids.tenantId, tenantId),
        // Optimistic compare-and-set on the status we just read: if a
        // concurrent caller changed it between the SELECT and here, this
        // matches zero rows and we 409 — closing the reject-after-accept
        // TOCTOU without blocking the idempotent same-state retry allowed above.
        eq(marketplaceBids.status, row.status),
      ),
    )
    .returning();
  if (!updated) return { ok: false, code: 'BID_NOT_PENDING' };
  return { ok: true, row: updated };
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
): Promise<string | null> {
  const [inserted] = await tx
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
    .onConflictDoNothing({ target: offtakeAgreements.bidId })
    .returning({ id: offtakeAgreements.id });
  // On a conflict (re-accept of the same bid) the insert returns no row;
  // re-read the existing agreement so the buyer notification deep-link
  // still resolves the contract awaiting signature.
  if (inserted?.id) return inserted.id;
  const [existing] = await tx
    .select({ id: offtakeAgreements.id })
    .from(offtakeAgreements)
    .where(
      and(
        eq(offtakeAgreements.bidId, bid.id),
        eq(offtakeAgreements.tenantId, tenantId),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Resolve the linked user_id of a buyer row so the buyer notification +
 * cockpit pulse can target the bid's BUYER (not the seller actioning it).
 * Returns null when the buyer was never linked to a user (KYC-only row).
 */
async function resolveBuyerUserId(
  db: DrizzleDb,
  tenantId: string,
  buyerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ linkedUserId: buyers.linkedUserId })
    .from(buyers)
    .where(and(eq(buyers.id, buyerId), eq(buyers.tenantId, tenantId)))
    .limit(1);
  const linked = row?.linkedUserId;
  return typeof linked === 'string' && linked.length > 0 ? linked : null;
}

app.openapi(
  { ...bidsAcceptRoute, middleware: [requireRole(...SELLER_WRITE_ROLES)] },
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
      let result: SetBidStatusResult | null = null;
      let offtakeAgreementId: string | null = null;
      try {
        result = await db.transaction(async (tx: DrizzleDb) => {
          const r = await setBidStatus(tx, tenantId, id, 'accepted', {
            acceptedAt: new Date().toISOString(),
          });
          if (!r.ok) return r;
          const flipped = r.row;

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

          offtakeAgreementId = await crystallizeOfftakeAgreement(
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

          // Notify the buyer that their bid was accepted (the binding
          // offtake was just created and now awaits THEIR signature). The
          // bid is intra-tenant (buyer + seller share tenantId), so the row
          // commits in the same tenant context inside this transaction so
          // the contract + the notification are atomic. Best-effort on the
          // buyer-user resolution: a KYC-only buyer with no linked user can
          // still settle, they just get no inbox row.
          const buyerUserId = await resolveBuyerUserId(
            tx,
            tenantId,
            flipped.buyerId,
          );
          if (buyerUserId) {
            await enqueueBidOutcomeNotification(tx, {
              buyerTenantId: tenantId,
              buyerUserId,
              sellerTenantId: tenantId,
              outcome: 'accepted',
              bidId: flipped.id,
              listingId: flipped.listingId,
              offtakeAgreementId,
            });
          }
          return r;
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
              message: localizedMessage(
                'Could not accept bid.',
                'Imeshindwa kukubali zabuni.',
              ),
            },
          },
          500,
        );
      }

      if (!result || !result.ok) {
        const conflict = result?.code === 'BID_NOT_PENDING';
        return c.json(
          {
            success: false as const,
            error: {
              code: result?.code ?? 'NOT_FOUND',
              message: conflict
                ? localizedMessage(
                    'Bid is no longer pending.',
                    'Zabuni hii haisubiri tena.',
                  )
                : localizedMessage('Bid not found.', 'Zabuni haijapatikana.'),
            },
          },
          conflict ? 409 : 404,
        );
      }
      // Pulse the buyer's own cockpit:<tenantId> channel so buyer-mobile
      // invalidates the buyer_notifications inbox and surfaces the accepted
      // bid immediately. Best-effort, never blocks the response — the
      // persisted notification row above is the durable truth.
      const acceptedBid = result.row;
      setImmediate(() => {
        try {
          publishCockpitEvent({
            kind: 'bid.accepted',
            tenantId,
            emittedAt: new Date().toISOString(),
            bidId: String(acceptedBid.id),
            listingId: (acceptedBid.listingId as string | null) ?? null,
            offtakeAgreementId,
            buyerId: String(acceptedBid.buyerId),
          });
        } catch {
          // bus failures must never leak to the request response.
        }
      });
      return c.json({ success: true as const, data: acceptedBid }, 200);
    },
  ),
);

app.openapi(
  { ...bidsRejectRoute, middleware: [requireRole(...SELLER_WRITE_ROLES)] },
  withSecurityEvents(
    { action: 'mining.bid.reject', resource: 'mining.bid', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      // Flip the status AND write the buyer notification in ONE tenant-bound
      // transaction so the buyer reliably learns the outcome the moment the
      // bid is declined (the bid is intra-tenant, so the buyer's own
      // cockpit:<tenantId> channel + inbox both receive it).
      const result = await db.transaction(async (tx: DrizzleDb) => {
        const r = await setBidStatus(tx, tenantId, id, 'rejected', {
          rejectionReason: body.reason,
          rejectedAt: new Date().toISOString(),
        });
        if (!r.ok) return r;
        const flipped = r.row;
        const buyerUserId = await resolveBuyerUserId(
          tx,
          tenantId,
          flipped.buyerId,
        );
        if (buyerUserId) {
          await enqueueBidOutcomeNotification(tx, {
            buyerTenantId: tenantId,
            buyerUserId,
            sellerTenantId: tenantId,
            outcome: 'rejected',
            bidId: flipped.id,
            listingId: flipped.listingId,
          });
        }
        return r;
      });
      if (!result.ok) {
        const conflict = result.code === 'BID_NOT_PENDING';
        return c.json(
          {
            success: false as const,
            error: {
              code: result.code,
              message: conflict
                ? localizedMessage(
                    'Bid is no longer pending.',
                    'Zabuni hii haisubiri tena.',
                  )
                : localizedMessage('Bid not found.', 'Zabuni haijapatikana.'),
            },
          },
          conflict ? 409 : 404,
        );
      }
      const rejectedBid = result.row;
      setImmediate(() => {
        try {
          publishCockpitEvent({
            kind: 'bid.rejected',
            tenantId,
            emittedAt: new Date().toISOString(),
            bidId: String(rejectedBid.id),
            listingId: (rejectedBid.listingId as string | null) ?? null,
            buyerId: String(rejectedBid.buyerId),
          });
        } catch {
          // bus failures must never leak to the request response.
        }
      });
      return c.json({ success: true as const, data: rejectedBid }, 200);
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
// POST /offtake-agreements/:id/sign — advance a crystallized offtake contract
// from `pending_signature` to `signed` AND enqueue the settlement.
//
// This is the missing lifecycle link (mining-bid-accept-no-payment-trigger):
// `accept` crystallizes the contract at `pending_signature` (money never moves
// from that table — CLAUDE.md), and the documented lifecycle is
// pending_signature → signed → (settlement). On the SIGNED transition we write
// a `settlement.requested` row into the transactional `event_outbox` IN THE
// SAME TRANSACTION as the status flip, so a settlement worker consumes it via
// the existing ledger composition (LedgerService.post() stays the sole money
// writer). Idempotent: re-signing a signed contract returns it unchanged and
// never enqueues a second settlement (the agreementId-keyed outbox guard).
//
// Tenant-scoped (RLS + predicate). Registered as a literal POST path so it
// never collides with the buyer-side `GET /:id`.
// ---------------------------------------------------------------------------

app.post('/offtake-agreements/:id/sign', requireRole(...SELLER_WRITE_ROLES), async (c: any) => {
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
  const agreementId = c.req.param('id');
  if (!agreementId || !/^[0-9a-z-]{8,64}$/i.test(agreementId)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_AGREEMENT_ID', message: 'invalid agreement id' },
      },
      400,
    );
  }

  // Capture the narrowed values into `const` locals: TS preserves a `const`'s
  // narrowing across the async transaction closure below, whereas the `auth.*`
  // member accesses widen back to `string | undefined` inside the closure.
  const tenantId = auth.tenantId;
  const userId = auth.userId;
  let result:
    | { kind: 'ok'; row: Record<string, unknown>; enqueued: boolean }
    | { kind: 'not_found' };
  try {
    result = await db.transaction(async (tx: DrizzleDb) => {
      const [existing] = await tx
        .select()
        .from(offtakeAgreements)
        .where(
          and(
            eq(offtakeAgreements.id, agreementId),
            eq(offtakeAgreements.tenantId, auth.tenantId),
          ),
        )
        .limit(1);
      if (!existing) return { kind: 'not_found' as const };

      // Idempotent: already signed → return as-is, never re-enqueue.
      if (existing.status === 'signed') {
        return { kind: 'ok' as const, row: existing, enqueued: false };
      }

      const now = new Date();
      const [updated] = await tx
        .update(offtakeAgreements)
        .set({ status: 'signed', signedAt: now, updatedAt: now })
        .where(
          and(
            eq(offtakeAgreements.id, agreementId),
            eq(offtakeAgreements.tenantId, auth.tenantId),
            eq(offtakeAgreements.status, 'pending_signature'),
          ),
        )
        .returning();
      if (!updated) {
        // Lost a race (another signer) — return the current row, no enqueue.
        return { kind: 'ok' as const, row: existing, enqueued: false };
      }

      // settlement.requested → durable outbox row consumed by the settlement
      // worker, written in THIS transaction. Shared with the buyer-sign
      // surface so whichever party completes the signature first emits an
      // identical event exactly once (the `eq(status, 'pending_signature')`
      // CAS above is the once-only guard).
      await enqueueSettlementRequested(tx, {
        tenantId,
        agreement: {
          id: agreementId,
          bidId: String(updated.bidId),
          listingId: String(updated.listingId),
          buyerId: String(updated.buyerId),
          buyerTenantId:
            (updated.buyerTenantId as string | null | undefined) ?? null,
          agreedPriceTzs: String(updated.agreedPriceTzs),
          quantityKg: String(updated.quantityKg),
        },
        signedBy: userId,
        source: 'offtake-sign',
        signedAt: now,
      });

      return { kind: 'ok' as const, row: updated, enqueued: true };
    });
  } catch (error) {
    c.get('logger')?.error?.(
      { err: error, agreementId },
      'offtake agreement sign / settlement enqueue failed',
    );
    return c.json(
      {
        success: false as const,
        error: {
          code: 'SIGN_FAILED',
          message: localizedMessage(
            'Could not sign the agreement.',
            'Imeshindwa kusaini mkataba.',
          ),
        },
      },
      500,
    );
  }

  if (result.kind === 'not_found') {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NOT_FOUND',
          message: localizedMessage(
            'Offtake agreement not found.',
            'Mkataba wa ununuzi haujapatikana.',
          ),
        },
      },
      404,
    );
  }

  // Pulse the cockpit that settlement has been initiated (best-effort).
  if (result.enqueued) {
    setImmediate(() => {
      try {
        publishCockpitEvent({
          kind: 'settlement.initiated',
          tenantId: auth.tenantId as string,
          emittedAt: new Date().toISOString(),
          settlementId: agreementId,
          cooperativeId: null,
          amountTzs: Number(result.kind === 'ok' ? result.row.agreedPriceTzs : 0),
          initiatedBy: auth.userId as string,
        });
      } catch {
        // bus failures must never leak to the request response.
      }
    });
  }

  return c.json(
    {
      success: true as const,
      data: result.row,
      meta: { settlementEnqueued: result.enqueued },
    },
    200,
  );
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
