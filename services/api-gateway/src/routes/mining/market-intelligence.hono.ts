/**
 * /api/v1/mining/market-intelligence — owner commodity market advisor.
 *
 * Wraps `@borjie/market-intelligence` (commodity tracking, 90-day demand
 * forecast with p5/p50/p95 bands, disruption alerts, and buy/sell/hold
 * signals with causal reasoning) behind a tenant-scoped BFF for the
 * owner cockpit's market surface.
 *
 * REAL price source: gold is priced + back-tested from the append-only
 * `fx_rates` table (LBMA fix written by `fx-feed-cron`) via
 * `createFxRatesPriceProvider` / `fetchGoldHistory`. Copper + tanzanite
 * have no live feed in this repo — those endpoints return an honest 503
 * `FEED_UNAVAILABLE` rather than a fabricated number.
 *
 * Routes (all GET — read-only market intel):
 *   GET /price/:commodity        latest spot/fix for the commodity
 *   GET /forecast/:commodity     90-day demand forecast (real gold history)
 *   GET /disruptions             active disruption alerts for the tenant
 *   GET /sell-signals/:commodity buy/sell/hold signal with reasoning
 *
 * Compute is genuine: the forecaster runs a linear-trend fit over real
 * price history with widening conformal-style bands; the signal
 * generator combines forecast trend + band width + active disruptions
 * into an explainable recommendation.
 *
 * Evidence-required: every sell-signal carries a non-empty `reasoning`
 * array and disruptions carry a `rationale` — the package schema rejects
 * empty chains, so the owner always sees the "why".
 *
 * RLS: `fx_rates` is tenant-agnostic (global benchmarks); the route is
 * still behind `authMiddleware` + `databaseMiddleware` so the GUC is
 * bound and `tenantId` flows onto every market-intel result for
 * tenant-scoped permission checks inside the package.
 *
 * NEVER hardcodes a currency: the price currency is carried on each
 * `CommodityPrice` (USD for the LBMA gold fix) and echoed to the client.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  createMarketIntelligence,
  createDemandForecaster,
  ALLOW_ALL_TENANT_PERMISSION,
  UnknownCommodityError,
  type Commodity,
} from '@borjie/market-intelligence';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import {
  createFxRatesPriceProvider,
  fetchGoldHistory,
  NoPriceFeedError,
  type PriceDbLike,
} from './market-intelligence-price-adapter';

const moduleLogger = createLogger('mining-market-intelligence');

const commodityParamSchema = z.enum(['gold', 'copper', 'tanzanite']);

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

/**
 * Build a per-request `MarketIntelligence` bound to the request's
 * fx_rates-backed price provider. The package's other ports default to
 * their built-in implementations (allow-all tenant permission — the
 * gateway has already authenticated + tenant-bound the request — and
 * empty disruption source until a real feed is wired).
 */
function buildMarketIntel(db: PriceDbLike | null) {
  return createMarketIntelligence({
    priceProvider: createFxRatesPriceProvider(db),
    tenantPermission: ALLOW_ALL_TENANT_PERMISSION,
    logger: moduleLogger,
  });
}

function parseCommodity(raw: string): Commodity | null {
  const parsed = commodityParamSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function feedUnavailable(c: any, commodity: string) {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'FEED_UNAVAILABLE',
        message: `No live price feed for "${commodity}" — gold is fed from the LBMA fix; copper and tanzanite feeds are not yet wired.`,
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// GET /price/:commodity — latest spot/fix for the commodity.
// ---------------------------------------------------------------------------
app.get('/price/:commodity', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db') as PriceDbLike | null;
  const commodity = parseCommodity(c.req.param('commodity'));
  if (!commodity) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNKNOWN_COMMODITY', message: 'Supported: gold, copper, tanzanite.' },
      },
      400,
    );
  }

  const market = buildMarketIntel(db);
  try {
    const price = await market.trackCommodity(commodity, tenantId);
    return c.json({ success: true as const, data: { price } }, 200);
  } catch (err) {
    if (err instanceof NoPriceFeedError) {
      return feedUnavailable(c, commodity);
    }
    if (err instanceof UnknownCommodityError) {
      return c.json(
        {
          success: false as const,
          error: { code: 'UNKNOWN_COMMODITY', message: err.message },
        },
        400,
      );
    }
    moduleLogger.error('market-intel price failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
      commodity,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'PRICE_FAILED', message: 'Price could not be retrieved.' },
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /forecast/:commodity — 90-day demand forecast from real history.
// ---------------------------------------------------------------------------
app.get('/forecast/:commodity', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db') as PriceDbLike | null;
  const commodity = parseCommodity(c.req.param('commodity'));
  if (!commodity) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNKNOWN_COMMODITY', message: 'Supported: gold, copper, tanzanite.' },
      },
      400,
    );
  }

  // Only gold has a real history series in fx_rates today.
  if (commodity !== 'gold') {
    return feedUnavailable(c, commodity);
  }

  const history = await fetchGoldHistory(db, 90);
  if (history.length < 2) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'INSUFFICIENT_HISTORY',
          message:
            'Not enough gold price history yet to forecast (need ≥2 fixes). The LBMA feed cron appends fixes over time.',
        },
      },
      503,
    );
  }

  const forecaster = createDemandForecaster({
    tenantPermission: ALLOW_ALL_TENANT_PERMISSION,
    logger: moduleLogger,
  });
  try {
    const forecast = await forecaster.forecast90Day({
      commodity,
      tenantId,
      history,
      horizonDays: 90,
      driverHints: [],
    });
    return c.json({ success: true as const, data: { forecast } }, 200);
  } catch (err) {
    moduleLogger.error('market-intel forecast failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
      commodity,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'FORECAST_FAILED', message: 'Forecast could not be computed.' },
      },
      422,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /disruptions — active disruption alerts for the tenant.
// ---------------------------------------------------------------------------
app.get('/disruptions', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db') as PriceDbLike | null;
  const market = buildMarketIntel(db);
  try {
    const alerts = await market.getDisruptionAlerts(tenantId);
    return c.json({ success: true as const, data: { alerts } }, 200);
  } catch (err) {
    moduleLogger.error('market-intel disruptions failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'DISRUPTIONS_FAILED', message: 'Disruption alerts could not be retrieved.' },
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /sell-signals/:commodity — buy/sell/hold signal with reasoning.
// ---------------------------------------------------------------------------
app.get('/sell-signals/:commodity', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db') as PriceDbLike | null;
  const commodity = parseCommodity(c.req.param('commodity'));
  if (!commodity) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNKNOWN_COMMODITY', message: 'Supported: gold, copper, tanzanite.' },
      },
      400,
    );
  }

  if (commodity !== 'gold') {
    return feedUnavailable(c, commodity);
  }

  const market = buildMarketIntel(db);
  try {
    const signals = await market.getSellSignals(tenantId, commodity);
    return c.json({ success: true as const, data: { signals } }, 200);
  } catch (err) {
    if (err instanceof NoPriceFeedError) {
      return feedUnavailable(c, commodity);
    }
    moduleLogger.error('market-intel sell-signals failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
      commodity,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'SIGNALS_FAILED', message: 'Sell signals could not be computed.' },
      },
      502,
    );
  }
});

export const miningMarketIntelligenceRouter = app;
export default app;
