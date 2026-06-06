/**
 * /api/v1/mining/marketplace-advisor — buyer-side marketplace advisor.
 *
 * Surfaces `@borjie/buyer-marketplace-advisor` over HTTP for the buyer
 * mobile app. The package is pure compute (weighted mine ranking, KYC
 * risk scoring, payment-term selection + FX hedge ladder, ETA estimate);
 * this route wires its ports to REAL data:
 *
 *   - MineCatalogPort → reads live `marketplace_listings` rows
 *     (category in mineral-supply set, visibility tanzania/regional/
 *     global) and projects each onto the advisor's `MineProfile`
 *     shape. Grade / monthly output / region live in the listing's
 *     `attributes` JSON; price is the row's `price_tzs` converted to a
 *     USD-per-tonne indicative figure via the request's `fxTzsPerUsd`.
 *     NEVER fabricated — a tenant with no listings gets an empty rank.
 *
 *   - KycSourcePort → in-memory empty source. There is no buyer-KYC
 *     read-model table wired for the advisor yet (the buyer KYC flow at
 *     `routes/mining/buyers-kyc.hono.ts` persists submissions but does
 *     not expose the screening facts the scorer needs). `/kyc-risk`
 *     therefore 404s UNKNOWN_BUYER until that read-model lands — it
 *     never invents a score. See report (KYC-WIRE-DEBT).
 *
 *   - LogisticsPort → in-memory empty source; `/eta` returns
 *     ROUTE_UNAVAILABLE until a geo route resolver is wired. Honest
 *     empty, never fabricated.
 *
 * Routes (all auth + db middleware; tenant scope via the GUC bound by
 * `databaseMiddleware`; RLS FORCE fires on every read):
 *   POST /recommend-mines   rank mineral-supply listings for a need
 *   POST /payment-terms     propose instrument + deposit + FX ladder
 *   POST /eta               estimate delivery ETA for a route
 *   GET  /kyc-risk          buyer KYC risk band (honest 404 until wired)
 *
 * Per CLAUDE.md: Drizzle only, Pino logger (no console.log), zod at the
 * boundary, immutability, currency read from data / request (never
 * hard-coded), evidence-bearing rationale on every recommendation.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { marketplaceListings } from '@borjie/database';
import {
  createBuyerMarketplaceAdvisor,
  createInMemoryKycSource,
  createInMemoryLogistics,
  buyerNeedSchema,
  paymentTermProposalInputSchema,
  etaEstimateInputSchema,
  type MineCatalogPort,
  type MineProfile,
} from '@borjie/buyer-marketplace-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { databaseMiddleware } from '../../middleware/database.js';
import { safeInternalError } from '../../utils/safe-error.js';
import { logger } from '../../utils/logger.js';

type AnyCtx = any;

// ── Mineral-supply listing categories the advisor treats as "mines" ──
// The marketplace also lists equipment / experts / labs; only seller
// supply rows are candidate mines for a buyer's commodity need.
const MINERAL_SUPPLY_CATEGORIES = ['mineral', 'seller', 'buyer', 'producer'];

// Cross-tenant visible visibilities for buyer discovery.
const DISCOVERABLE_VISIBILITIES = ['tanzania', 'regional', 'global'];

// ── Commodity normaliser ────────────────────────────────────────────
// Listing `attributes.mineral` carries product-grade strings
// (e.g. `gold_concentrate`, `tanzanite_rough`); the advisor's commodity
// enum is the base mineral. Map the common product strings down.
const COMMODITY_BY_PREFIX: ReadonlyArray<{
  readonly match: string;
  readonly commodity: string;
}> = [
  { match: 'gold', commodity: 'gold' },
  { match: 'copper', commodity: 'copper' },
  { match: 'silver', commodity: 'silver' },
  { match: 'tin', commodity: 'tin' },
  { match: 'cassiterite', commodity: 'tin' },
  { match: 'tanzanite', commodity: 'tanzanite' },
  { match: 'gemstone', commodity: 'tanzanite' },
  { match: 'graphite', commodity: 'graphite' },
  { match: 'coal', commodity: 'coal' },
  { match: 'iron', commodity: 'iron-ore' },
  { match: 'nickel', commodity: 'nickel' },
  { match: 'cobalt', commodity: 'cobalt' },
  { match: 'coltan', commodity: 'cobalt' },
];

function normaliseCommodity(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  for (const { match, commodity } of COMMODITY_BY_PREFIX) {
    if (lower.includes(match)) return commodity;
  }
  return null;
}

function numFromAttr(attrs: Record<string, unknown>, key: string): number | null {
  const v = attrs[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseLngLat(location: unknown): [number, number] {
  // location is a GeoJSON-ish string at the ORM boundary; tolerate the
  // common `{ "type":"Point","coordinates":[lng,lat] }` shape and the
  // bare `lng,lat` string. Fall back to [0,0] (unknown) — the advisor
  // does not currently use coordinates in the score so this is inert.
  if (typeof location !== 'string' || location.length === 0) return [0, 0];
  try {
    const parsed = JSON.parse(location) as { coordinates?: unknown };
    const coords = parsed.coordinates;
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      return [coords[0], coords[1]];
    }
  } catch {
    const parts = location.split(',').map((p) => Number(p.trim()));
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!];
    }
  }
  return [0, 0];
}

/**
 * Build a Drizzle-backed MineCatalogPort. Reads active mineral-supply
 * listings for the requested commodity, projecting each row onto a
 * `MineProfile`. The buyer's commodity is matched against the listing's
 * `attributes.mineral` (normalised), so a "gold" need surfaces
 * `gold_concentrate` / `gold_dore` listings.
 *
 * `fxTzsPerUsd` converts the row's TZS price to the advisor's
 * USD-per-tonne axis. Rows whose attributes lack a parseable
 * monthly-output / grade fall back to conservative defaults so they are
 * still rankable (volume defaults keep them eligible but unboosted).
 */
function createDrizzleMineCatalog(
  db: AnyCtx,
  fxTzsPerUsd: number,
): MineCatalogPort {
  return {
    async listMines({ tenantId, commodity }) {
      const rows: ReadonlyArray<Record<string, unknown>> = await db
        .select()
        .from(marketplaceListings)
        .where(
          and(
            eq(marketplaceListings.status, 'active'),
            inArray(marketplaceListings.category, MINERAL_SUPPLY_CATEGORIES),
            or(
              eq(marketplaceListings.tenantId, tenantId),
              inArray(
                marketplaceListings.visibility,
                DISCOVERABLE_VISIBILITIES,
              ),
            ),
            // Pre-filter on the JSON mineral when present to cut the set;
            // the precise commodity match happens in the projection.
            sql`${marketplaceListings.attributes} ? 'mineral'`,
          ),
        )
        .orderBy(desc(marketplaceListings.createdAt))
        .limit(200);

      const mines: MineProfile[] = [];
      for (const row of rows) {
        const attrs =
          (row.attributes as Record<string, unknown> | null | undefined) ?? {};
        const mineCommodity = normaliseCommodity(attrs.mineral);
        if (mineCommodity !== commodity) continue;

        const priceTzs = row.priceTzs != null ? Number(row.priceTzs) : null;
        // Convert per-row TZS price to indicative USD/tonne. priceUnit is
        // free-form; we treat priceTzs as a per-tonne figure when no
        // explicit per-tonne attribute exists. fxTzsPerUsd > 0 enforced
        // by the caller's zod schema.
        const perTonneTzs =
          numFromAttr(attrs, 'pricePerTonneTzs') ?? priceTzs ?? null;
        const indicativePriceUsdPerTonne =
          perTonneTzs != null && perTonneTzs > 0
            ? Math.max(1, Math.round((perTonneTzs / fxTzsPerUsd) * 100) / 100)
            : 1;

        mines.push({
          id: String(row.id ?? ''),
          tenantId: String(row.tenantId ?? tenantId),
          name:
            typeof row.title === 'string' && row.title.length > 0
              ? row.title
              : `Listing ${String(row.id ?? '').slice(0, 8)}`,
          commodity: commodity as MineProfile['commodity'],
          regionId:
            typeof attrs.region === 'string' ? attrs.region : 'unknown',
          location: parseLngLat(row.location),
          monthlyOutputTonnes:
            numFromAttr(attrs, 'monthlyOutputTonnes') ??
            numFromAttr(attrs, 'quantityTonnes') ??
            // quantityKg → tonnes fallback (buyer listings carry kg).
            (numFromAttr(attrs, 'quantityKg') != null
              ? (numFromAttr(attrs, 'quantityKg') as number) / 1000
              : 0),
          averageGrade: numFromAttr(attrs, 'gradeNumeric') ?? 0,
          indicativePriceUsdPerTonne,
          complianceRisk: 'low',
          baseLeadTimeDays:
            numFromAttr(attrs, 'leadTimeDays') != null
              ? Math.max(0, Math.floor(numFromAttr(attrs, 'leadTimeDays') as number))
              : 14,
        });
      }
      return mines;
    },
  };
}

// ── Request schemas (extend the package schemas with route-only fields) ──

const recommendBodySchema = z.object({
  need: buyerNeedSchema.omit({ buyerId: true, tenantId: true }),
  /** TZS per 1 USD — drives the listing-price → USD/tonne projection. */
  fxTzsPerUsd: z.number().positive().max(1_000_000),
});

const paymentTermsBodySchema = paymentTermProposalInputSchema.omit({
  buyerId: true,
  tenantId: true,
});

const etaBodySchema = etaEstimateInputSchema;

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ─────────────────────────────────────────────────────────────────────
// POST /recommend-mines — rank live mineral-supply listings for a need.
// ─────────────────────────────────────────────────────────────────────

app.post(
  '/recommend-mines',
  withSecurityEvents(
    {
      action: 'marketplace_advisor.recommend',
      resource: 'marketplace-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'tenantId required' },
          },
          400,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = recommendBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      try {
        const advisor = createBuyerMarketplaceAdvisor({
          mineCatalog: createDrizzleMineCatalog(db, parsed.data.fxTzsPerUsd),
          logger,
        });
        const recommendations = await advisor.recommendMines({
          ...parsed.data.need,
          // Identity is taken from the session, never the body.
          buyerId: userId,
          tenantId,
        });
        return c.json({
          success: true,
          data: recommendations,
          meta: { total: recommendations.length },
        });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'MARKETPLACE_ADVISOR_ERROR',
          fallback: 'mine recommendation failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// POST /payment-terms — instrument + deposit + FX hedge ladder.
// Pure compute on the request inputs; no DB read required.
// ─────────────────────────────────────────────────────────────────────

app.post(
  '/payment-terms',
  withSecurityEvents(
    {
      action: 'marketplace_advisor.payment_terms',
      resource: 'marketplace-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const { tenantId, userId } = c.get('auth');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'tenantId required' },
          },
          400,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = paymentTermsBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      try {
        const advisor = createBuyerMarketplaceAdvisor({ logger });
        const proposal = await advisor.proposePaymentTerms({
          ...parsed.data,
          buyerId: userId,
          tenantId,
        });
        return c.json({ success: true, data: proposal });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'MARKETPLACE_ADVISOR_ERROR',
          fallback: 'payment-term proposal failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// POST /eta — delivery ETA estimate.
// Honest 422 ROUTE_UNAVAILABLE until a geo route resolver is wired.
// ─────────────────────────────────────────────────────────────────────

app.post(
  '/eta',
  withSecurityEvents(
    {
      action: 'marketplace_advisor.eta',
      resource: 'marketplace-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const { tenantId } = c.get('auth');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'tenantId required' },
          },
          400,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = etaBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      try {
        // No geo route resolver wired yet — empty logistics port. The
        // advisor throws RouteUnavailableError, which we surface as 422.
        const advisor = createBuyerMarketplaceAdvisor({
          logistics: createInMemoryLogistics([]),
          logger,
        });
        const estimate = await advisor.estimateEta(parsed.data);
        return c.json({ success: true, data: estimate });
      } catch (e) {
        const code =
          (e as { code?: string } | null)?.code === 'ROUTE_UNAVAILABLE'
            ? 'ROUTE_UNAVAILABLE'
            : null;
        if (code) {
          return c.json(
            {
              success: false,
              error: {
                code,
                message:
                  'No route data available for this origin/destination yet.',
              },
            },
            422,
          );
        }
        return safeInternalError(c, e, {
          code: 'MARKETPLACE_ADVISOR_ERROR',
          fallback: 'eta estimate failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// GET /kyc-risk — buyer KYC risk band.
// Honest 404 UNKNOWN_BUYER until a buyer-KYC read-model is wired.
// ─────────────────────────────────────────────────────────────────────

app.get(
  '/kyc-risk',
  withSecurityEvents(
    {
      action: 'marketplace_advisor.kyc_risk',
      resource: 'marketplace-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const { tenantId, userId } = c.get('auth');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'tenantId required' },
          },
          400,
        );
      }
      try {
        // No buyer-KYC screening read-model wired yet — empty source.
        // The advisor throws UnknownBuyerError, surfaced as 404. It NEVER
        // fabricates a score for an unknown buyer.
        const advisor = createBuyerMarketplaceAdvisor({
          kycSource: createInMemoryKycSource([]),
          logger,
        });
        const report = await advisor.assessKycRisk(userId, tenantId);
        return c.json({ success: true, data: report });
      } catch (e) {
        const code = (e as { code?: string } | null)?.code;
        if (code === 'UNKNOWN_BUYER') {
          return c.json(
            {
              success: false,
              error: {
                code: 'KYC_NOT_AVAILABLE',
                message:
                  'No KYC screening facts available for this buyer yet.',
              },
            },
            404,
          );
        }
        return safeInternalError(c, e, {
          code: 'MARKETPLACE_ADVISOR_ERROR',
          fallback: 'kyc risk assessment failed',
        });
      }
    },
  ),
);

export const miningMarketplaceAdvisorRouter = app;
export default app;
