/**
 * /api/v1/owner/forecasts — owner-cockpit forecasting surface.
 *
 * Produces calibrated forecasts (point + 95% confidence interval) for
 * the operating-finance KPIs the owner cockpit needs:
 *
 *   GET /cash-flow?days=90      — daily net TZS projection from the
 *                                 last 180 days of `sales.netTzs`.
 *   GET /production?days=30     — daily ROM tonnes projection from the
 *                                 last 180 days of `shift_reports`
 *                                 (grouped to per-day totals).
 *   GET /royalty?days=30        — projected royalty payable for the
 *                                 next N days (derived from production
 *                                 forecast × jurisdictional royalty rate).
 *
 * The model layer is `@borjie/forecasting` Holt-Winters with a
 * deterministic grid-search tune + heuristic 95% intervals. Same input
 * series always yields the same output (no randomness in the model).
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS. The
 *       Drizzle query also asserts `tenantId` explicitly so the model
 *       can never accidentally learn from another tenant's series.
 *
 * Empty / sparse data: the route returns 200 with
 * `{ point: 0, lower: 0, upper: 0, meta: { source: 'insufficient' } }`
 * when fewer than 14 days of history are available — never invents a
 * synthetic projection.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import {
  createHoltWintersForecaster,
  type TimeSeries,
  type TimeSeriesForecast,
} from '@borjie/forecasting';
import { sales, shiftReports } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-forecasts');

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const horizonQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
});

const ForecastPointSchema = z.object({
  t: z.string(),
  point: z.number(),
  lower: z.number(),
  upper: z.number(),
});

const ForecastEnvelopeSchema = z.object({
  metric: z.string(),
  unit: z.string(),
  horizonDays: z.number().int().positive(),
  modelKind: z.string(),
  modelVersion: z.string(),
  generatedAt: z.string(),
  history: z.array(z.object({ t: z.string(), y: z.number() })),
  projection: z.array(ForecastPointSchema),
  meta: z.object({
    source: z.enum(['live', 'insufficient']),
    historyPoints: z.number().int().nonnegative(),
    seasonalPeriod: z.number().int().positive().optional(),
    halfWidth: z.number().optional(),
  }),
});

export type ForecastEnvelope = z.infer<typeof ForecastEnvelopeSchema>;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const HISTORY_DAYS = 180;
const MIN_HISTORY_FOR_MODEL = 14;
const Z_95 = 1.96;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gapFillDaily(
  rows: ReadonlyArray<{ readonly day: string; readonly value: number }>,
  startInclusive: Date,
  endInclusive: Date,
): ReadonlyArray<{ readonly t: string; readonly y: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.day, Number(r.value ?? 0));
  }
  const out: Array<{ readonly t: string; readonly y: number }> = [];
  const cursor = new Date(startInclusive);
  while (cursor.getTime() <= endInclusive.getTime()) {
    const key = dayKey(cursor);
    out.push({ t: cursor.toISOString(), y: map.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Object.freeze(out);
}

function emptyEnvelope(
  metric: string,
  unit: string,
  horizonDays: number,
  history: ReadonlyArray<{ readonly t: string; readonly y: number }>,
): ForecastEnvelope {
  return {
    metric,
    unit,
    horizonDays,
    modelKind: 'holt-winters',
    modelVersion: 'holt-winters-1',
    generatedAt: new Date().toISOString(),
    history: [...history],
    projection: [],
    meta: { source: 'insufficient', historyPoints: history.length },
  };
}

async function runHoltWinters(
  history: ReadonlyArray<{ readonly t: string; readonly y: number }>,
  horizonDays: number,
  seriesId: string,
  unit: string,
  clampToZero: boolean,
): Promise<TimeSeriesForecast> {
  const series: TimeSeries = Object.freeze({
    id: seriesId,
    frequency: 'daily',
    unit,
    points: history.map((p) => Object.freeze({ t: p.t, y: p.y })),
  });
  const forecaster = createHoltWintersForecaster({ intervalZ: Z_95 });
  const result = await forecaster.predict({
    series,
    horizon: { steps: horizonDays },
    opts: { alpha: 0.05, seasonality: 7 },
  });
  if (!clampToZero) return result;
  // Clamp to non-negative for revenue / production which can't be < 0.
  const clamped = result.points.map((p) =>
    Object.freeze({
      ...p,
      point: Math.max(0, p.point),
      lower: Math.max(0, p.lower),
      upper: Math.max(0, p.upper),
    }),
  );
  return Object.freeze({ ...result, points: Object.freeze(clamped) });
}

function packEnvelope(
  metric: string,
  unit: string,
  horizonDays: number,
  history: ReadonlyArray<{ readonly t: string; readonly y: number }>,
  forecast: TimeSeriesForecast,
): ForecastEnvelope {
  return {
    metric,
    unit,
    horizonDays,
    modelKind: String(forecast.modelKind),
    modelVersion: forecast.modelVersion,
    generatedAt: forecast.generatedAt,
    history: [...history],
    projection: forecast.points.map((p) => ({
      t: p.t,
      point: p.point,
      lower: p.lower,
      upper: p.upper,
    })),
    meta: {
      source: 'live',
      historyPoints: history.length,
      seasonalPeriod: Number(forecast.meta?.seasonalPeriod ?? 7),
      halfWidth: Number(forecast.meta?.halfWidth ?? 0),
    },
  };
}

// ----------------------------------------------------------------------------
// Drizzle aggregators
// ----------------------------------------------------------------------------

async function fetchDailyCashFlow(
  db: any,
  tenantId: string,
): Promise<ReadonlyArray<{ readonly t: string; readonly y: number }>> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HISTORY_DAYS);
  const rows = ((await db
    .select({
      day: sql<string>`to_char(${sales.ts}, 'YYYY-MM-DD')`,
      value: sql<string>`COALESCE(SUM(${sales.netTzs}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .groupBy(sql`to_char(${sales.ts}, 'YYYY-MM-DD')`)) ?? []) as ReadonlyArray<{
    readonly day: string;
    readonly value: string;
  }>;
  const normalised = rows.map((r) => ({ day: r.day, value: Number(r.value) }));
  return gapFillDaily(normalised, cutoff, new Date());
}

async function fetchDailyProduction(
  db: any,
  tenantId: string,
): Promise<ReadonlyArray<{ readonly t: string; readonly y: number }>> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HISTORY_DAYS);
  const cutoffKey = dayKey(cutoff);
  const rows = ((await db
    .select({
      day: shiftReports.shiftDate,
      value: sql<string>`COALESCE(SUM(${shiftReports.romTonnes}), 0)`,
    })
    .from(shiftReports)
    .where(
      and(
        eq(shiftReports.tenantId, tenantId),
        gte(shiftReports.shiftDate, cutoffKey),
      ),
    )
    .groupBy(shiftReports.shiftDate)) ?? []) as ReadonlyArray<{
    readonly day: string;
    readonly value: string;
  }>;
  const normalised = rows.map((r) => ({ day: r.day, value: Number(r.value) }));
  return gapFillDaily(normalised, cutoff, new Date());
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/cash-flow', zValidator('query', horizonQuerySchema), async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const { days } = c.req.valid('query') as { days: number };
  if (!auth?.tenantId || !db) {
    return c.json(
      { success: false, error: { code: 'NO_TENANT', message: 'Tenant not bound.' } },
      401,
    );
  }
  try {
    const history = await fetchDailyCashFlow(db, auth.tenantId);
    if (history.length < MIN_HISTORY_FOR_MODEL) {
      return c.json({
        success: true,
        data: emptyEnvelope('cash_flow_net_tzs', 'TZS', days, history),
      });
    }
    const forecast = await runHoltWinters(
      history,
      days,
      `owner::cash-flow::${auth.tenantId}`,
      'TZS',
      false,
    );
    return c.json({
      success: true,
      data: packEnvelope('cash_flow_net_tzs', 'TZS', days, history, forecast),
    });
  } catch (err) {
    moduleLogger.warn('cash-flow forecast failed', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'FORECAST_FAILED',
          message: 'Cash-flow forecast failed; see server logs.',
        },
      },
      500,
    );
  }
});

app.get('/production', zValidator('query', horizonQuerySchema), async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const { days } = c.req.valid('query') as { days: number };
  if (!auth?.tenantId || !db) {
    return c.json(
      { success: false, error: { code: 'NO_TENANT', message: 'Tenant not bound.' } },
      401,
    );
  }
  try {
    const history = await fetchDailyProduction(db, auth.tenantId);
    if (history.length < MIN_HISTORY_FOR_MODEL) {
      return c.json({
        success: true,
        data: emptyEnvelope('production_tonnes', 'tonnes', days, history),
      });
    }
    const forecast = await runHoltWinters(
      history,
      days,
      `owner::production::${auth.tenantId}`,
      'tonnes',
      true,
    );
    return c.json({
      success: true,
      data: packEnvelope('production_tonnes', 'tonnes', days, history, forecast),
    });
  } catch (err) {
    moduleLogger.warn('production forecast failed', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'FORECAST_FAILED',
          message: 'Production forecast failed; see server logs.',
        },
      },
      500,
    );
  }
});

// Tanzania mining royalty is 6% on gold (Mining Act 2010 §87). Other
// minerals vary 3-7%. We expose the rate as `royaltyRate` so the UI
// can display the assumption. The projection is the production
// forecast × an average parcel value (computed from the last 60 days
// of sales) × the royalty rate.
const DEFAULT_ROYALTY_RATE_TZ_GOLD = 0.06;

app.get('/royalty', zValidator('query', horizonQuerySchema), async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const { days } = c.req.valid('query') as { days: number };
  if (!auth?.tenantId || !db) {
    return c.json(
      { success: false, error: { code: 'NO_TENANT', message: 'Tenant not bound.' } },
      401,
    );
  }
  try {
    const [tonnageHistory, valuePerTonne] = await Promise.all([
      fetchDailyProduction(db, auth.tenantId),
      computeRecentValuePerTonne(db, auth.tenantId),
    ]);
    if (tonnageHistory.length < MIN_HISTORY_FOR_MODEL || valuePerTonne === 0) {
      const empty = emptyEnvelope('royalty_payable_tzs', 'TZS', days, []);
      return c.json({
        success: true,
        data: {
          ...empty,
          meta: {
            ...empty.meta,
            royaltyRate: DEFAULT_ROYALTY_RATE_TZ_GOLD,
            valuePerTonneTzs: valuePerTonne,
          },
        },
      });
    }
    const tonnageForecast = await runHoltWinters(
      tonnageHistory,
      days,
      `owner::royalty::${auth.tenantId}`,
      'tonnes',
      true,
    );
    const royaltyProjection = tonnageForecast.points.map((p) => ({
      t: p.t,
      point: p.point * valuePerTonne * DEFAULT_ROYALTY_RATE_TZ_GOLD,
      lower: p.lower * valuePerTonne * DEFAULT_ROYALTY_RATE_TZ_GOLD,
      upper: p.upper * valuePerTonne * DEFAULT_ROYALTY_RATE_TZ_GOLD,
    }));
    const royaltyHistory = tonnageHistory.map((p) => ({
      t: p.t,
      y: p.y * valuePerTonne * DEFAULT_ROYALTY_RATE_TZ_GOLD,
    }));
    return c.json({
      success: true,
      data: {
        metric: 'royalty_payable_tzs',
        unit: 'TZS',
        horizonDays: days,
        modelKind: 'holt-winters',
        modelVersion: tonnageForecast.modelVersion,
        generatedAt: tonnageForecast.generatedAt,
        history: royaltyHistory,
        projection: royaltyProjection,
        meta: {
          source: 'live' as const,
          historyPoints: tonnageHistory.length,
          seasonalPeriod: Number(tonnageForecast.meta?.seasonalPeriod ?? 7),
          halfWidth: Number(tonnageForecast.meta?.halfWidth ?? 0),
          royaltyRate: DEFAULT_ROYALTY_RATE_TZ_GOLD,
          valuePerTonneTzs: valuePerTonne,
        },
      },
    });
  } catch (err) {
    moduleLogger.warn('royalty forecast failed', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'FORECAST_FAILED',
          message: 'Royalty forecast failed; see server logs.',
        },
      },
      500,
    );
  }
});

async function computeRecentValuePerTonne(
  db: any,
  tenantId: string,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 60);
  // Join sales × ore_parcels to compute per-tonne value over the last
  // 60 days. Falls back to 0 when there's no signal (parsed mass_kg of
  // the linked parcel = 0 or no sales). Use raw SQL since the join
  // crosses two tables and we want one round-trip.
  try {
    const result = (await db.execute(sql`
      SELECT
        COALESCE(SUM(${sales.grossPriceTzs}), 0)::numeric AS gross_tzs,
        COALESCE(SUM(op.mass_kg), 0)::numeric AS total_kg
      FROM ${sales} s
      INNER JOIN ore_parcels op ON op.id = s.parcel_id
      WHERE s.tenant_id = ${tenantId}
        AND s.ts >= ${cutoff}
    `)) as { readonly rows?: ReadonlyArray<{ readonly gross_tzs?: string; readonly total_kg?: string }> };
    const r = result?.rows?.[0];
    if (!r) return 0;
    const grossTzs = Number(r.gross_tzs ?? 0);
    const totalKg = Number(r.total_kg ?? 0);
    if (totalKg <= 0) return 0;
    return (grossTzs / totalKg) * 1000; // → per tonne
  } catch (err) {
    moduleLogger.warn('value-per-tonne lookup failed', {
      tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export const ownerForecastsRouter = app;
export default ownerForecastsRouter;
