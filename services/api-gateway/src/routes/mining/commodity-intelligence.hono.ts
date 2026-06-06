/**
 * /api/v1/mining/commodity-intelligence — price-trend advice.
 *
 * Wires the REAL `@borjie/mining-commodity-intelligence` compute
 * (multi-source price merge → 1d/7d/30d/90d trend windows → lock /
 * delay-sale recommendations) onto the live `mineral_prices` ticker
 * table (treasury.schema). The ticker is populated append-only by the
 * fx-feed cron from LBMA / LME / Fastmarkets snapshots and is
 * tenant-agnostic (a global benchmark, exactly like `fx_rates`), so the
 * database middleware merely opens the session; no `app.current_tenant_id`
 * binding is required for these reads (RLS-exempt by design, mirroring
 * `fx.hono.ts`).
 *
 * Nothing is fabricated: every tick fed to the advisor is a real
 * `mineral_prices` row. Prices are normalised to USD-per-tonne before
 * they enter the advisor (the ticker stores heterogeneous units —
 * USD/oz, USD/kg, USD/t — in its `unit` column); rows whose unit cannot
 * be normalised are dropped, never coerced to a fake number. When the
 * ticker holds no rows for a commodity the route returns a real degraded
 * payload (empty snapshot + a note).
 *
 * Routes:
 *   GET  /advice   compute snapshot + recommendations for one commodity
 *   POST /advice   same, with caller-supplied policy thresholds
 *
 * Evidence discipline: every recommendation carries ≥1 `evidence` ref
 * from the advisor; we also surface the concrete `mineral_prices` row ids
 * that fed the snapshot so each trend figure is traceable.
 */

import { Hono } from 'hono';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { mineralPrices } from '@borjie/database';
import {
  createCommodityIntelligence,
  intelInputSchema,
  intelRecommendationContextSchema,
  type Commodity,
  type CurrencyCode,
  type PriceHistory,
  type PriceTick,
} from '@borjie/mining-commodity-intelligence';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-commodity-intel');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Commodity enum (mirrors the advisor's `commoditySchema`).
// ---------------------------------------------------------------------------

const COMMODITIES = [
  'gold',
  'silver',
  'copper',
  'cobalt',
  'nickel',
  'tin',
  'zinc',
  'lead',
] as const;

const adviceQuerySchema = z.object({
  commodity: z.enum(COMMODITIES),
  /** How far back to read ticker rows. */
  lookbackDays: z.coerce.number().int().positive().max(365).default(90),
});
type AdviceQuery = z.infer<typeof adviceQuerySchema>;

const adviceBodySchema = adviceQuerySchema.extend({
  policy: z
    .object({
      lockOnUpswingPercent: z.number(),
      delaySaleOnDownswingPercent: z.number(),
    })
    .partial()
    .optional(),
});

// ---------------------------------------------------------------------------
// Normalisation — ticker rows → advisor price ticks.
// ---------------------------------------------------------------------------

type MineralPriceRow = typeof mineralPrices.$inferSelect;

/** Troy ounces per metric tonne (1 t = 1,000,000 g; 1 ozt = 31.1034768 g). */
const OZT_PER_TONNE = 1_000_000 / 31.1034768;
/** Grams per metric tonne. */
const GRAMS_PER_TONNE = 1_000_000;
/** Kilograms per metric tonne. */
const KG_PER_TONNE = 1_000;

/**
 * Convert a ticker (price, unit) into price-per-tonne. Returns null when
 * the unit is not recognised so the row is dropped rather than fabricated.
 * Only USD-denominated units are accepted here (the advisor's currency
 * enum + downstream off-take pricing are USD-benchmarked); TZS/native
 * conversion is the treasury-advisor's job, not this benchmark feed.
 */
function toPricePerTonneUsd(price: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  switch (u) {
    case 'usd/t':
    case 'usd/tonne':
    case 'usd/mt':
      return price;
    case 'usd/kg':
      return price * KG_PER_TONNE;
    case 'usd/g':
      return price * GRAMS_PER_TONNE;
    case 'usd/oz':
    case 'usd/ozt':
      return price * OZT_PER_TONNE;
    default:
      return null;
  }
}

/** Map a free-text ticker `mineral` onto the advisor's commodity enum. */
function mapMineral(mineral: string): Commodity | null {
  const m = mineral.trim().toLowerCase();
  return (COMMODITIES as ReadonlyArray<string>).includes(m) ? (m as Commodity) : null;
}

/** Derive the advisor currency from the ticker unit (USD-only here). */
function unitCurrency(unit: string): CurrencyCode | null {
  return unit.trim().toLowerCase().startsWith('usd/') ? 'USD' : null;
}

function toPriceTicks(
  rows: ReadonlyArray<MineralPriceRow>,
  commodity: Commodity,
): { ticks: PriceTick[]; rowIds: string[] } {
  const ticks: PriceTick[] = [];
  const rowIds: string[] = [];
  for (const r of rows) {
    if (mapMineral(r.mineral) !== commodity) continue;
    const currency = unitCurrency(r.unit);
    if (currency === null) continue;
    const price = Number(r.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const perTonne = toPricePerTonneUsd(price, r.unit);
    if (perTonne === null || perTonne <= 0) continue;
    ticks.push({
      commodity,
      pricePerTonne: perTonne,
      currency,
      source: r.source,
      asOfISO: (r.ts instanceof Date ? r.ts : new Date(r.ts as unknown as string)).toISOString(),
    });
    rowIds.push(r.id);
  }
  return { ticks, rowIds };
}

interface IntelComputation {
  readonly snapshot: Awaited<
    ReturnType<ReturnType<typeof createCommodityIntelligence>['analyze']>
  >;
  readonly recommendations: Awaited<
    ReturnType<ReturnType<typeof createCommodityIntelligence>['recommend']>
  >;
  readonly rowIds: ReadonlyArray<string>;
}

async function computeIntel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: { readonly query: AdviceQuery; readonly policy?: Record<string, number> },
): Promise<IntelComputation | { readonly degraded: true; readonly note: string }> {
  const { query } = args;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - query.lookbackDays);

  // mineral_prices is tenant-agnostic; read the window with no tenant
  // predicate, mirroring the fx benchmark read path in fx.hono.ts.
  const rows = (await db
    .select()
    .from(mineralPrices)
    .where(and(eq(mineralPrices.mineral, query.commodity), gte(mineralPrices.ts, cutoff)))
    .orderBy(asc(mineralPrices.ts))
    .limit(5000)) as MineralPriceRow[];

  if (rows.length === 0) {
    return { degraded: true, note: `no ticker rows for ${query.commodity}` };
  }

  const { ticks, rowIds } = toPriceTicks(rows, query.commodity);
  if (ticks.length === 0) {
    return {
      degraded: true,
      note: `no USD-denominated ticker rows for ${query.commodity}`,
    };
  }

  const history: PriceHistory = { commodity: query.commodity, ticks };
  const input = intelInputSchema.parse({
    commodity: query.commodity,
    histories: [history],
    baseCurrency: 'USD',
  });

  const advisor = createCommodityIntelligence({ logger: moduleLogger });
  const snapshot = await advisor.analyze(input);
  const recContext = intelRecommendationContextSchema.parse({
    snapshot,
    ...(args.policy ? { policy: args.policy } : {}),
  });
  const recommendations = await advisor.recommend(recContext);

  return { snapshot, recommendations, rowIds };
}

function evidenceIdsFrom(comp: IntelComputation): ReadonlyArray<string> {
  const fromRecs = comp.recommendations.flatMap((r) => r.evidence.map((e) => e.id));
  const fromRows = comp.rowIds.map((id) => `mineral-price:${id}`);
  return Array.from(new Set([...fromRecs, ...fromRows]));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function degradedPayload(note: string) {
  return {
    success: true as const,
    data: { snapshot: null, recommendations: [], evidenceIds: [], note },
  };
}

app.get('/advice', async (c) => {
  const db = c.get('db');
  const parsed = adviceQuerySchema.safeParse({
    commodity: c.req.query('commodity'),
    lookbackDays: c.req.query('lookbackDays') ?? undefined,
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  const result = await computeIntel(db, { query: parsed.data });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(
    {
      success: true as const,
      data: {
        snapshot: result.snapshot,
        recommendations: result.recommendations,
        evidenceIds: evidenceIdsFrom(result),
      },
    },
    200,
  );
});

app.post('/advice', async (c) => {
  const db = c.get('db');
  const raw = await c.req.json().catch(() => ({}));
  const parsed = adviceBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  const { policy, ...query } = parsed.data;
  const result = await computeIntel(db, {
    query,
    ...(policy ? { policy: policy as Record<string, number> } : {}),
  });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(
    {
      success: true as const,
      data: {
        snapshot: result.snapshot,
        recommendations: result.recommendations,
        evidenceIds: evidenceIdsFrom(result),
      },
    },
    200,
  );
});

export const miningCommodityIntelligenceRouter = app;
export default app;
