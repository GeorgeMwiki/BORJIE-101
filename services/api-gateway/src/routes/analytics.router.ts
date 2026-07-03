
/**
 * /api/v1/analytics — mining-domain analytics summary.
 *
 * Returns a single object with the KPIs the owner-portal mining
 * dashboard surfaces above the fold:
 *   - production30dTonnes      total ROM over last 30 days
 *   - cashRunwayDays           cash on hand (latest treasury balances) /
 *                              net daily burn (30d actual costs); null when
 *                              inputs are missing or the estate is not burning
 *   - openIncidentsHighCount   open incidents at severity high|critical
 *   - licencesAtRiskCount      licences flagged at-risk
 *   - sales30dCount            sales in last 30 days
 *   - sales30dNetTzs           net TZS revenue from those sales
 *   - workforce.shiftsToday    shifts started today
 *   - workforce.shifts30d      shifts started in the last 30 days
 *
 * Real Drizzle aggregations. No fixtures, no `EMPTY_SUMMARY` shape.
 * RLS-FORCE is honoured by the `databaseMiddleware` GUC binding.
 */

import { Hono } from 'hono';
import { and, eq, gte, sql } from 'drizzle-orm';
import { sales, shiftReports } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { logger } from '../utils/logger';
import { computeCashRunway } from './owner/brief.hono.js';
import type { ServiceRegistry } from '../composition/service-registry';

const analyticsRouter = new Hono();
analyticsRouter.use('*', authMiddleware);
analyticsRouter.use('*', databaseMiddleware);

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Render-ready chart specs for the mining summary, built from the live
 * KPIs via the ported `@borjie/analytics` Vega-Lite v6 builders. Returns
 * `null` if the analytics bundle is unavailable or a builder throws — the
 * caller treats `charts` as optional so the numeric KPIs are never lost.
 */
function buildSummaryCharts(
  c: any,
  kpis: {
    readonly productionTonnes: number;
    readonly salesNetTzs: number;
    readonly cashNetTzs90d: number;
    readonly openIncidentsHighCount: number;
    readonly licencesAtRiskCount: number;
  },
): unknown {
  try {
    const registry = c.get('services') as unknown as ServiceRegistry | undefined;
    const analytics = registry?.portedDomain?.analytics;
    if (!analytics) return null;
    return {
      tiles: [
        analytics.kpiTile({
          title: 'Production (30d)',
          value: kpis.productionTonnes,
          format: 'number',
        }),
        analytics.kpiTile({
          title: 'Sales net (30d)',
          value: kpis.salesNetTzs,
          format: 'currency',
        }),
        analytics.kpiTile({
          title: 'Open high incidents',
          value: kpis.openIncidentsHighCount,
          format: 'number',
        }),
        analytics.kpiTile({
          title: 'Licences at risk',
          value: kpis.licencesAtRiskCount,
          format: 'number',
        }),
      ],
      // Vega-Lite v6 bar of the headline revenue/production magnitudes so
      // the dashboard can drop the spec straight into vega-embed.
      revenueVsProduction: analytics.barChart({
        title: 'Revenue vs production (last 30d / 90d)',
        x: 'metric',
        y: 'value',
        data: [
          { metric: 'Sales net (30d)', value: kpis.salesNetTzs },
          { metric: 'Cash net (90d)', value: kpis.cashNetTzs90d },
          { metric: 'Production tonnes (30d)', value: kpis.productionTonnes },
        ],
      }),
    };
  } catch (error) {
    logger.warn('analytics summary chart-build failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

analyticsRouter.get('/summary', async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!auth?.tenantId || !db) {
    return c.json(
      { success: false, error: { code: 'NO_TENANT', message: 'Tenant not bound.' } },
      401,
    );
  }
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
    const today = dayKey(now);

    const [
      production30dRows,
      sales30dRows,
      cashRunwayRows,
      shiftsTodayRows,
      shifts30dRows,
      incidentsHighRows,
      licencesAtRiskRows,
      cashOnHandRows,
      dailyBurnRows,
    ] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(SUM(rom_tonnes), 0)::numeric AS tonnes
        FROM shift_reports
        WHERE tenant_id = ${auth.tenantId}
          AND shift_date >= ${dayKey(thirtyDaysAgo)}
      `),
      db.execute(sql`
        SELECT
          COUNT(*)::int AS sales_count,
          COALESCE(SUM(net_tzs), 0)::numeric AS net_tzs
        FROM sales
        WHERE tenant_id = ${auth.tenantId}
          AND ts >= ${thirtyDaysAgo}
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(net_tzs), 0)::numeric AS net_tzs_90d,
          COUNT(*)::int AS sample_count
        FROM sales
        WHERE tenant_id = ${auth.tenantId}
          AND ts >= ${ninetyDaysAgo}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS shifts
        FROM shift_reports
        WHERE tenant_id = ${auth.tenantId}
          AND shift_date = ${today}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS shifts
        FROM shift_reports
        WHERE tenant_id = ${auth.tenantId}
          AND shift_date >= ${dayKey(thirtyDaysAgo)}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS incidents_count
        FROM incidents
        WHERE tenant_id = ${auth.tenantId}
          AND status = 'open'
          AND severity IN ('critical', 'high')
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS licences_count
        FROM licences
        WHERE tenant_id = ${auth.tenantId}
          AND COALESCE(dormancy_score, 0) >= 0.5
      `),
      // REAL cash on hand — Σ latest `cash_balances.balance_tzs` per account.
      // Mirrors risk-scanner (scanner.ts:resolveCashFlow). `account_count = 0`
      // ⇒ no treasury feed ⇒ honest unknown (null), never a fabricated 0.
      db.execute(sql`
        SELECT COALESCE(SUM(latest.balance_tzs), 0)::numeric AS cash_total,
               COUNT(*)::int AS account_count
          FROM (
            SELECT DISTINCT ON (account_id) balance_tzs
              FROM cash_balances
             WHERE tenant_id = ${auth.tenantId}
             ORDER BY account_id, recorded_at DESC
          ) AS latest
      `),
      // REAL net daily burn — Σ actual `costs.amount_tzs` over 30d / 30.
      // `cost_rows = 0` ⇒ no cost feed ⇒ honest unknown (null).
      db.execute(sql`
        SELECT (COALESCE(SUM(amount_tzs), 0) / 30.0)::numeric AS daily_burn,
               COUNT(*)::int AS cost_rows
          FROM costs
         WHERE tenant_id = ${auth.tenantId}
           AND state = 'actual'
           AND ts > NOW() - INTERVAL '30 days'
      `),
    ]);

    const productionTonnes = Number(production30dRows.rows?.[0]?.tonnes ?? 0);
    const salesCount = Number(sales30dRows.rows?.[0]?.sales_count ?? 0);
    const salesNetTzs = Number(sales30dRows.rows?.[0]?.net_tzs ?? 0);
    const cashNetTzs90d = Number(cashRunwayRows.rows?.[0]?.net_tzs_90d ?? 0);
    const cashSampleCount = Number(cashRunwayRows.rows?.[0]?.sample_count ?? 0);
    // REAL runway = cash on hand ÷ net daily burn. Only a present treasury /
    // cost feed grounds each input (account_count / cost_rows > 0); otherwise
    // the input is `null` and the runway is an honest `null` (unknown), NOT the
    // old degenerate `cashNet90d / (cashNet90d / 90)` == 90 constant.
    const cashAccountCount = Number(cashOnHandRows.rows?.[0]?.account_count ?? 0);
    const cashOnHandTzs =
      cashAccountCount > 0
        ? Number(cashOnHandRows.rows?.[0]?.cash_total ?? 0)
        : null;
    const costRows = Number(dailyBurnRows.rows?.[0]?.cost_rows ?? 0);
    const netDailyBurnTzs =
      costRows > 0 ? Number(dailyBurnRows.rows?.[0]?.daily_burn ?? 0) : null;
    const { runwayDays: cashRunwayDays, burnStatus: cashBurnStatus } =
      computeCashRunway({ cashOnHandTzs, netDailyBurnTzs });
    const shiftsToday = Number(shiftsTodayRows.rows?.[0]?.shifts ?? 0);
    const shifts30d = Number(shifts30dRows.rows?.[0]?.shifts ?? 0);
    const openIncidentsHighCount = Number(incidentsHighRows.rows?.[0]?.incidents_count ?? 0);
    const licencesAtRiskCount = Number(licencesAtRiskRows.rows?.[0]?.licences_count ?? 0);

    // Build render-ready chart specs from the live KPIs using the ported
    // `@borjie/analytics` Vega-Lite v6 builders. This is the first live
    // consumer of the analytics bundle — the owner dashboard can render
    // the returned `charts` natively (KPI tiles + a Vega-Lite bar) instead
    // of re-deriving spec shapes on the client. Best-effort: a builder
    // throw degrades to `charts: null`, never failing the KPI payload.
    const charts = buildSummaryCharts(c, {
      productionTonnes,
      salesNetTzs,
      cashNetTzs90d,
      openIncidentsHighCount,
      licencesAtRiskCount,
    });

    return c.json({
      success: true,
      data: {
        production30dTonnes: productionTonnes,
        // REAL runway (cash on hand ÷ net daily burn); `null` when unknown or
        // not-burning. `cashBurnStatus` disambiguates for the renderer.
        cashRunwayDays,
        cashBurnStatus,
        cashOnHandTzs,
        netDailyBurnTzs,
        cash90dNetTzs: cashNetTzs90d,
        cashSampleCount,
        sales30dCount: salesCount,
        sales30dNetTzs: salesNetTzs,
        openIncidentsHighCount,
        licencesAtRiskCount,
        workforce: {
          shiftsToday,
          shifts30d,
        },
        charts,
        meta: { source: 'live' },
      },
    });
  } catch (error) {
    logger.warn('mining analytics summary failed', {
      tenantId: auth.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'ANALYTICS_FAILED',
          message: 'Mining analytics summary failed; see server logs.',
        },
      },
      500,
    );
  }
});

export default analyticsRouter;
