/**
 * /api/v1/mining/bid-messaging — WS-2 buyer ↔ seller bid chat +
 * post-settlement seller ratings.
 *
 * THREAD MODEL — one thread per RFB response
 * ------------------------------------------
 * A thread is keyed by `responseId` (request_for_bid_responses.id). The
 * two participants live in DIFFERENT tenants (buyer = parent RFB tenant;
 * seller = response tenant). Both may read the shared thread; each may
 * only write rows stamped with their own tenant. The DB enforces this
 * via the participant-aware RLS policy in migration 0172 — the handler
 * additionally resolves the caller's role so the bubble alignment +
 * `sender_role` are correct, and fails closed for non-participants.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   GET  /threads/:responseId/messages   list thread (oldest-first)
 *   POST /threads/:responseId/messages   idempotent send (Idempotency-Key)
 *   POST /settlements/:settlementId/rate  buyer rates seller post-delivery
 *   GET  /reputation/:sellerTenantId      seller reputation aggregate
 *
 * Backing tables:
 *   - `bid_messages`   (migration 0172) — RLS FORCE, idempotent send
 *   - `seller_ratings` (migration 0173) — RLS FORCE, one rating/settlement
 *   - `seller_reputation()` SECURITY DEFINER aggregate (migration 0173)
 *
 * Bilingual sw/en error messages on every 4xx (mirrors rfb.hono.ts).
 * No console.* — Pino logger only (CLAUDE.md hard rule).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-bid-messaging');

const UUID_RE = /^[0-9a-f-]{36}$/i;

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

interface AuthCtx {
  tenantId?: string;
  userId?: string;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function bilingual(en: string, sw: string): { en: string; sw: string } {
  return { en, sw };
}

const SendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

const RateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
});

/**
 * Resolve the caller's participant role in a thread. Returns the parent
 * RFB id + the caller's role, or null when the caller's tenant is
 * neither the buyer nor the seller tenant for the response.
 */
async function resolveParticipant(
  db: DbExecutor,
  responseId: string,
  tenantId: string,
): Promise<{ rfbId: string; role: 'buyer' | 'seller' } | null> {
  const row = rowsOf(
    await db.execute(sql`
      SELECT
        r.rfb_id::text       AS rfb_id,
        r.tenant_id::text    AS seller_tenant_id,
        rfb.tenant_id::text  AS buyer_tenant_id
        FROM request_for_bid_responses r
        JOIN request_for_bids rfb ON rfb.id = r.rfb_id
       WHERE r.id = ${responseId}::uuid
       LIMIT 1
    `),
  )[0];
  if (!row) return null;
  const rfbId = String(row.rfb_id);
  if (String(row.buyer_tenant_id) === tenantId) return { rfbId, role: 'buyer' };
  if (String(row.seller_tenant_id) === tenantId) return { rfbId, role: 'seller' };
  return null;
}

export const miningBidMessagingRouter = new Hono();
miningBidMessagingRouter.use('*', authMiddleware);
miningBidMessagingRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /threads/:responseId/messages — list the thread (oldest-first)
// ---------------------------------------------------------------------------

miningBidMessagingRouter.get('/threads/:responseId/messages', async (c) => {
  const auth = c.get('auth') as AuthCtx;
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'MESSAGING_UNAVAILABLE',
          message: bilingual(
            'Messaging temporarily unavailable',
            'Ujumbe haupatikani kwa muda',
          ),
        },
      },
      503,
    );
  }
  const responseId = c.req.param('responseId');
  if (!UUID_RE.test(responseId)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_RESPONSE_ID',
          message: bilingual(
            'responseId must be a UUID',
            'ID ya jibu lazima iwe UUID',
          ),
        },
      },
      400,
    );
  }
  const participant = await resolveParticipant(db, responseId, auth.tenantId);
  if (!participant) {
    return c.json(
      {
        success: false,
        error: {
          code: 'THREAD_NOT_FOUND',
          message: bilingual(
            'Thread not found or not visible to you',
            'Mazungumzo hayajapatikana au huruhusiwi kuyaona',
          ),
        },
      },
      404,
    );
  }
  const messages = rowsOf(
    await db.execute(sql`
      SELECT
        id::text     AS id,
        sender_role,
        sender_id,
        body,
        created_at
        FROM bid_messages
       WHERE rfb_response_id = ${responseId}::uuid
       ORDER BY created_at ASC
       LIMIT 500
    `),
  ).map((m) => ({
    id: String(m.id),
    senderRole: String(m.sender_role),
    senderId: String(m.sender_id),
    body: String(m.body),
    createdAt: m.created_at,
  }));
  return c.json({
    success: true,
    data: { responseId, rfbId: participant.rfbId, role: participant.role, messages },
  });
});

// ---------------------------------------------------------------------------
// POST /threads/:responseId/messages — idempotent send
// ---------------------------------------------------------------------------

miningBidMessagingRouter.post(
  '/threads/:responseId/messages',
  zValidator('json', SendMessageSchema),
  async (c) => {
    const auth = c.get('auth') as AuthCtx;
    const db = c.get('db') as DbExecutor | null;
    if (!db || !auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MESSAGING_UNAVAILABLE',
            message: bilingual(
              'Messaging temporarily unavailable',
              'Ujumbe haupatikani kwa muda',
            ),
          },
        },
        503,
      );
    }
    const responseId = c.req.param('responseId');
    if (!UUID_RE.test(responseId)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_RESPONSE_ID',
            message: bilingual(
              'responseId must be a UUID',
              'ID ya jibu lazima iwe UUID',
            ),
          },
        },
        400,
      );
    }
    const body = c.req.valid('json');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;

    const participant = await resolveParticipant(db, responseId, auth.tenantId);
    if (!participant) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_THREAD_PARTICIPANT',
            message: bilingual(
              'Only the buyer or seller on this deal may message',
              'Ni mnunuzi au muuzaji wa mkataba huu pekee wanaoweza kutuma ujumbe',
            ),
          },
        },
        403,
      );
    }

    // Idempotent send: a replay carrying the same Idempotency-Key
    // short-circuits to the already-stored row (matches the partial
    // unique index in migration 0172). Scoped to (response, sender, key).
    if (idempotencyKey) {
      const existing = rowsOf(
        await db.execute(sql`
          SELECT id::text AS id, sender_role, body, created_at
            FROM bid_messages
           WHERE rfb_response_id = ${responseId}::uuid
             AND sender_id = ${auth.userId}
             AND idempotency_key = ${idempotencyKey}
           LIMIT 1
        `),
      )[0];
      if (existing) {
        return c.json(
          {
            success: true,
            meta: { idempotent: true },
            data: {
              id: String(existing.id),
              senderRole: String(existing.sender_role),
              body: String(existing.body),
              createdAt: existing.created_at,
            },
          },
          200,
        );
      }
    }

    const provenance = JSON.stringify({
      via: 'buyer_mobile',
      actorId: auth.userId,
      requestedAt: new Date().toISOString(),
    });
    const inserted = rowsOf(
      await db.execute(sql`
        INSERT INTO bid_messages (
          tenant_id, rfb_response_id, rfb_id,
          sender_id, sender_role, body, idempotency_key, provenance
        ) VALUES (
          ${auth.tenantId}, ${responseId}::uuid, ${participant.rfbId}::uuid,
          ${auth.userId}, ${participant.role}, ${body.body},
          ${idempotencyKey}, ${provenance}::jsonb
        )
        RETURNING id::text AS id, sender_role, body, created_at
      `),
    )[0];
    if (!inserted) {
      return c.json(
        {
          success: false,
          error: {
            code: 'MESSAGE_SEND_FAILED',
            message: bilingual('Failed to send message', 'Imeshindwa kutuma ujumbe'),
          },
        },
        500,
      );
    }
    moduleLogger.info(
      {
        responseId,
        rfbId: participant.rfbId,
        senderRole: participant.role,
        tenantId: auth.tenantId,
      },
      'bid_message_sent',
    );
    return c.json(
      {
        success: true,
        data: {
          id: String(inserted.id),
          senderRole: String(inserted.sender_role),
          body: String(inserted.body),
          createdAt: inserted.created_at,
        },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// POST /settlements/:settlementId/rate — buyer rates the seller after
// a ledger-backed settlement (post-delivery).
// ---------------------------------------------------------------------------

const SETTLED_STATES = new Set(['posted', 'paying_out', 'completed']);

miningBidMessagingRouter.post(
  '/settlements/:settlementId/rate',
  zValidator('json', RateSchema),
  async (c) => {
    const auth = c.get('auth') as AuthCtx;
    const db = c.get('db') as DbExecutor | null;
    if (!db || !auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'RATING_UNAVAILABLE',
            message: bilingual(
              'Rating temporarily unavailable',
              'Ukadiriaji haupatikani kwa muda',
            ),
          },
        },
        503,
      );
    }
    const settlementId = c.req.param('settlementId');
    if (!UUID_RE.test(settlementId)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_SETTLEMENT_ID',
            message: bilingual(
              'settlementId must be a UUID',
              'ID ya malipo lazima iwe UUID',
            ),
          },
        },
        400,
      );
    }
    const body = c.req.valid('json');

    // Load the settlement (RLS scopes to the buyer's tenant) + join the
    // response → RFB so we know the seller identity + that THIS caller
    // is the buyer who signed the delivery.
    const settlement = rowsOf(
      await db.execute(sql`
        SELECT
          s.id::text           AS id,
          s.status             AS status,
          s.response_id::text  AS response_id,
          r.seller_id          AS seller_id,
          r.tenant_id::text    AS seller_tenant_id,
          rfb.buyer_id         AS buyer_id
          FROM settlements s
          JOIN request_for_bid_responses r ON r.id = s.response_id
          JOIN request_for_bids rfb ON rfb.id = r.rfb_id
         WHERE s.id = ${settlementId}::uuid
         LIMIT 1
      `),
    )[0];
    if (!settlement) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: bilingual(
              'Settlement not found in your tenant',
              'Malipo hayajapatikana katika muktadha wako',
            ),
          },
        },
        404,
      );
    }
    if (String(settlement.buyer_id) !== auth.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_SETTLEMENT_BUYER',
            message: bilingual(
              'Only the buyer on this settlement may rate the seller',
              'Ni mnunuzi wa malipo haya pekee anayeweza kumkadiria muuzaji',
            ),
          },
        },
        403,
      );
    }
    if (!SETTLED_STATES.has(String(settlement.status))) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_SETTLED',
            message: bilingual(
              'You can only rate after delivery is settled',
              'Unaweza kukadiria tu baada ya malipo kukamilika',
            ),
          },
        },
        409,
      );
    }

    const provenance = JSON.stringify({
      via: 'buyer_mobile',
      actorId: auth.userId,
      requestedAt: new Date().toISOString(),
    });
    // ON CONFLICT (settlement_id) DO NOTHING → one rating per settlement.
    // A re-POST returns the same row (idempotent) via the follow-up
    // SELECT when DO NOTHING suppresses the RETURNING.
    const inserted = rowsOf(
      await db.execute(sql`
        INSERT INTO seller_ratings (
          tenant_id, settlement_id, rfb_response_id,
          seller_tenant_id, seller_id, rater_user_id,
          stars, comment, provenance
        ) VALUES (
          ${auth.tenantId}, ${settlementId}::uuid, ${String(settlement.response_id)}::uuid,
          ${String(settlement.seller_tenant_id)}, ${String(settlement.seller_id)}, ${auth.userId},
          ${body.stars}, ${body.comment ?? null}, ${provenance}::jsonb
        )
        ON CONFLICT (settlement_id) DO NOTHING
        RETURNING id::text AS id, stars, created_at
      `),
    )[0];
    if (!inserted) {
      // DO NOTHING fired — a rating already exists. Return it idempotently.
      const existing = rowsOf(
        await db.execute(sql`
          SELECT id::text AS id, stars, created_at
            FROM seller_ratings
           WHERE settlement_id = ${settlementId}::uuid
           LIMIT 1
        `),
      )[0];
      if (existing) {
        return c.json(
          {
            success: true,
            meta: { idempotent: true },
            data: {
              id: String(existing.id),
              stars: Number(existing.stars),
              createdAt: existing.created_at,
            },
          },
          200,
        );
      }
      return c.json(
        {
          success: false,
          error: {
            code: 'RATING_FAILED',
            message: bilingual('Failed to record rating', 'Imeshindwa kuhifadhi ukadiriaji'),
          },
        },
        500,
      );
    }
    moduleLogger.info(
      {
        settlementId,
        sellerTenantId: String(settlement.seller_tenant_id),
        stars: body.stars,
        tenantId: auth.tenantId,
      },
      'seller_rated',
    );
    return c.json(
      {
        success: true,
        data: {
          id: String(inserted.id),
          stars: Number(inserted.stars),
          createdAt: inserted.created_at,
        },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// GET /reputation/:sellerTenantId — public reputation aggregate.
//
// Reads the SECURITY DEFINER `seller_reputation()` aggregate (migration
// 0173) so a prospective buyer sees a seller's score without weakening
// the per-row tenant isolation on seller_ratings. Returns count + avg
// only — never any rater identity.
// ---------------------------------------------------------------------------

miningBidMessagingRouter.get('/reputation/:sellerTenantId', async (c) => {
  const auth = c.get('auth') as AuthCtx;
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REPUTATION_UNAVAILABLE',
          message: bilingual(
            'Reputation temporarily unavailable',
            'Sifa hazipatikani kwa muda',
          ),
        },
      },
      503,
    );
  }
  const sellerTenantId = c.req.param('sellerTenantId');
  if (!sellerTenantId || sellerTenantId.length > 128) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_SELLER_TENANT',
          message: bilingual('Invalid seller tenant id', 'Kitambulisho batili cha muuzaji'),
        },
      },
      400,
    );
  }
  const row = rowsOf(
    await db.execute(sql`
      SELECT rating_count, average_stars
        FROM seller_reputation(${sellerTenantId})
    `),
  )[0];
  const ratingCount = Number(row?.rating_count ?? 0);
  const averageStars =
    row?.average_stars === null || row?.average_stars === undefined
      ? null
      : Number(row.average_stars);
  return c.json({
    success: true,
    data: { sellerTenantId, ratingCount, averageStars },
  });
});

export default miningBidMessagingRouter;
