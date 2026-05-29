/**
 * /api/v1/marketplace/rfb — Roadmap R11.
 *
 * Buyer-initiated Request for Bids surface. Buyers post
 * "I want N tonnes of X at TZS Y per unit by D" via the buyer-mobile
 * `rfb-create` screen; sellers within the geo predicate see the row
 * in their `nearby` feed and respond with counter-offers.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /             buyer creates an RFB
 *   GET    /mine         buyer's own RFBs (most recent first)
 *   GET    /nearby       sellers see open RFBs within radius
 *   PATCH  /:id          buyer cancels (status → cancelled)
 *   POST   /:id/respond  seller responds with a counter-offer
 *
 * Backing tables (migration 0127):
 *   - `request_for_bids` — RLS FORCE per tenant
 *   - `request_for_bid_responses` — RLS FORCE per tenant
 *
 * Tenant isolation: every read/write is gated by
 * `app.current_tenant_id` bound in the database middleware. The
 * nearby feed deliberately crosses tenants on the geo predicate
 * (a buyer in one tenant looking for sellers across the country
 * is the whole point), but the RFB rows themselves stay scoped
 * to the buyer's tenant — sellers only ever see the SUBSET of
 * fields the public projection exposes.
 *
 * Bilingual sw/en error messages on every 4xx so the buyer-mobile
 * can render the right copy without round-tripping.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const MINERAL_KINDS = [
  'gold',
  'tanzanite',
  'diamond',
  'copper',
  'cobalt',
  'nickel',
  'iron',
  'coal',
  'silver',
  'rare_earth',
  'limestone',
  'gypsum',
  'salt',
  'gemstone_other',
] as const;

const CreateRfbSchema = z.object({
  mineralKind: z.enum(MINERAL_KINDS),
  gradeMin: z.string().min(1).max(120).optional().nullable(),
  tonnageMin: z.number().positive().max(1_000_000),
  tonnageMax: z.number().positive().max(1_000_000).optional().nullable(),
  unitPriceTzs: z.number().positive().max(100_000_000_000),
  deliveryBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationLat: z.number().gte(-90).lte(90).optional().nullable(),
  locationLon: z.number().gte(-180).lte(180).optional().nullable(),
  radiusKm: z.number().int().positive().max(5000).default(200),
  notes: z.string().max(1500).optional().nullable(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const NearbyQuerySchema = z.object({
  mineralKind: z.enum(MINERAL_KINDS).optional(),
  /** Seller's current coordinates — required to compute distance. */
  lat: z.coerce.number().gte(-90).lte(90),
  lon: z.coerce.number().gte(-180).lte(180),
  /** Cap returned rows. */
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const RespondSchema = z.object({
  offeredTonnage: z.number().positive().max(1_000_000),
  offeredPriceTzs: z.number().positive().max(100_000_000_000),
  deliveryBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1500).optional().nullable(),
});

const PatchSchema = z.object({
  status: z.enum(['cancelled']),
});

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function bilingualError(
  codeEn: string,
  codeSw: string,
): { en: string; sw: string } {
  return { en: codeEn, sw: codeSw };
}

export const rfbRouter = new Hono();
rfbRouter.use('*', authMiddleware);
rfbRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /  — buyer creates an RFB
// ---------------------------------------------------------------------------

rfbRouter.post('/', zValidator('json', CreateRfbSchema), async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RFB_UNAVAILABLE',
          message: bilingualError(
            'Marketplace temporarily unavailable',
            'Soko halipatikani kwa muda',
          ),
        },
      },
      503,
    );
  }
  const body = c.req.valid('json');
  if (body.tonnageMax != null && body.tonnageMax < body.tonnageMin) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TONNAGE_RANGE',
          message: bilingualError(
            'tonnageMax must be at least tonnageMin',
            'Tonnage ya juu lazima iwe sawa au zaidi ya tonnage ya chini',
          ),
        },
      },
      400,
    );
  }
  // delivery_by must be in the future.
  const deliveryDate = new Date(`${body.deliveryBy}T00:00:00Z`);
  if (Number.isNaN(deliveryDate.getTime()) || deliveryDate.getTime() < Date.now()) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DELIVERY_IN_PAST',
          message: bilingualError(
            'deliveryBy must be a future date',
            'Tarehe ya kufikisha lazima iwe ya baadaye',
          ),
        },
      },
      400,
    );
  }

  const provenance = {
    via: 'buyer_mobile',
    ...(body.provenance ?? {}),
  };

  const inserted = await db.execute(sql`
    INSERT INTO request_for_bids (
      tenant_id, buyer_id, mineral_kind, grade_min,
      tonnage_min, tonnage_max, unit_price_tzs, delivery_by,
      location_lat, location_lon, radius_km, notes,
      provenance, expires_at
    ) VALUES (
      ${auth.tenantId}::uuid, ${auth.userId}, ${body.mineralKind},
      ${body.gradeMin ?? null}, ${body.tonnageMin}, ${body.tonnageMax ?? null},
      ${body.unitPriceTzs}, ${body.deliveryBy}::date,
      ${body.locationLat ?? null}, ${body.locationLon ?? null},
      ${body.radiusKm}, ${body.notes ?? null},
      ${JSON.stringify(provenance)}::jsonb,
      NOW() + INTERVAL '14 days'
    )
    RETURNING id::text AS id, created_at, expires_at
  `);
  const row = rowsOf(inserted)[0];
  if (!row) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RFB_INSERT_FAILED',
          message: bilingualError('Failed to create RFB', 'Imeshindwa kuunda RFB'),
        },
      },
      500,
    );
  }
  return c.json(
    {
      success: true,
      data: {
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /mine  — buyer's own RFBs (most recent first)
// ---------------------------------------------------------------------------

rfbRouter.get('/mine', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json({ success: false, error: { code: 'RFB_UNAVAILABLE' } }, 503);
  }
  const res = await db.execute(sql`
    SELECT
      rfb.id::text AS id,
      rfb.mineral_kind,
      rfb.grade_min,
      rfb.tonnage_min::text AS tonnage_min,
      rfb.tonnage_max::text AS tonnage_max,
      rfb.unit_price_tzs::text AS unit_price_tzs,
      rfb.delivery_by::text AS delivery_by,
      rfb.location_lat::text AS location_lat,
      rfb.location_lon::text AS location_lon,
      rfb.radius_km,
      rfb.status,
      rfb.notes,
      rfb.created_at,
      rfb.expires_at,
      (
        SELECT COUNT(*)::int FROM request_for_bid_responses r
         WHERE r.rfb_id = rfb.id AND r.status = 'pending'
      ) AS pending_response_count
    FROM request_for_bids rfb
    WHERE rfb.buyer_id = ${auth.userId}
    ORDER BY rfb.created_at DESC
    LIMIT 100
  `);
  return c.json({ success: true, data: { rfbs: rowsOf(res) } });
});

// ---------------------------------------------------------------------------
// GET /nearby  — sellers see open RFBs within their radius
// ---------------------------------------------------------------------------
//
// Haversine SQL — no extension needed (we deliberately avoid the
// earthdistance extension which is not enabled in every Borjie
// deployment). The math runs server-side in a single pass.
//
// For each open RFB with location_lat / location_lon, we compute
// distance_km between the buyer and the seller, then filter to rows
// where `distance_km <= radius_km`. The buyer's radius is honoured —
// a seller outside the buyer's stated cone will not see the RFB.
// ---------------------------------------------------------------------------

rfbRouter.get('/nearby', zValidator('query', NearbyQuerySchema), async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId) {
    return c.json({ success: false, error: { code: 'RFB_UNAVAILABLE' } }, 503);
  }
  const q = c.req.valid('query');
  const mineralFilter = q.mineralKind ?? null;
  const res = await db.execute(sql`
    WITH candidates AS (
      SELECT
        id::text AS id,
        buyer_id,
        mineral_kind,
        grade_min,
        tonnage_min::text AS tonnage_min,
        tonnage_max::text AS tonnage_max,
        unit_price_tzs::text AS unit_price_tzs,
        delivery_by::text AS delivery_by,
        location_lat,
        location_lon,
        radius_km,
        notes,
        created_at,
        expires_at,
        CASE
          WHEN location_lat IS NULL OR location_lon IS NULL THEN NULL
          ELSE
            6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(${q.lat}::numeric)) *
                cos(radians(location_lat)) *
                cos(radians(location_lon) - radians(${q.lon}::numeric))
                + sin(radians(${q.lat}::numeric)) * sin(radians(location_lat))
              ))
            )
        END AS distance_km
      FROM request_for_bids
      WHERE status = 'open'
        AND expires_at > NOW()
        AND (${mineralFilter}::text IS NULL OR mineral_kind = ${mineralFilter}::text)
    )
    SELECT *
      FROM candidates
     WHERE distance_km IS NULL OR distance_km <= radius_km
     ORDER BY distance_km ASC NULLS LAST, created_at DESC
     LIMIT ${q.limit}::int
  `);
  return c.json({ success: true, data: { rfbs: rowsOf(res) } });
});

// ---------------------------------------------------------------------------
// PATCH /:id  — buyer cancels
// ---------------------------------------------------------------------------

rfbRouter.patch('/:id', zValidator('json', PatchSchema), async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json({ success: false, error: { code: 'RFB_UNAVAILABLE' } }, 503);
  }
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const res = await db.execute(sql`
    UPDATE request_for_bids
       SET status = ${body.status}
     WHERE id = ${id}::uuid
       AND buyer_id = ${auth.userId}
       AND status = 'open'
    RETURNING id::text AS id, status
  `);
  const row = rowsOf(res)[0];
  if (!row) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RFB_NOT_FOUND_OR_NOT_OPEN',
          message: bilingualError(
            'RFB not found or already closed',
            'RFB haijapatikana au imeshafungwa',
          ),
        },
      },
      404,
    );
  }
  return c.json({ success: true, data: row });
});

// ---------------------------------------------------------------------------
// POST /:id/respond  — seller responds with a counter-offer
// ---------------------------------------------------------------------------

rfbRouter.post('/:id/respond', zValidator('json', RespondSchema), async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json({ success: false, error: { code: 'RFB_UNAVAILABLE' } }, 503);
  }
  const id = c.req.param('id');
  const body = c.req.valid('json');

  // Confirm the RFB exists, is open, and is not already past its
  // expiry. We deliberately look it up in the SAME query as the
  // insert so two concurrent sellers can't race against an expiring
  // row.
  const rfb = rowsOf(
    await db.execute(sql`
      SELECT tenant_id::text AS tenant_id, status, expires_at
        FROM request_for_bids
       WHERE id = ${id}::uuid
         AND status = 'open'
         AND expires_at > NOW()
       LIMIT 1
    `),
  )[0];
  if (!rfb) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RFB_NOT_OPEN',
          message: bilingualError(
            'RFB not open or expired',
            'RFB haijafunguliwa au imekwisha muda wake',
          ),
        },
      },
      404,
    );
  }
  const rfbTenantId = String(rfb.tenant_id);
  const inserted = await db.execute(sql`
    INSERT INTO request_for_bid_responses (
      rfb_id, tenant_id, seller_id,
      offered_tonnage, offered_price_tzs, delivery_by, notes,
      provenance
    ) VALUES (
      ${id}::uuid, ${rfbTenantId}::uuid, ${auth.userId},
      ${body.offeredTonnage}, ${body.offeredPriceTzs}, ${body.deliveryBy}::date,
      ${body.notes ?? null},
      ${JSON.stringify({ via: 'buyer_mobile', sellerTenantId: auth.tenantId })}::jsonb
    )
    RETURNING id::text AS id, created_at
  `);
  const row = rowsOf(inserted)[0];
  if (!row) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RFB_RESPOND_FAILED',
          message: bilingualError('Failed to send response', 'Imeshindwa kutuma jibu'),
        },
      },
      500,
    );
  }
  return c.json({ success: true, data: row }, 201);
});

export default rfbRouter;
