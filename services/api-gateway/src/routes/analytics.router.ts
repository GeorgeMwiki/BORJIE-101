
/**
 * /api/v1/analytics — mining-domain analytics summary.
 *
 * Returns a single object with the KPIs the owner-portal mining
 * dashboard surfaces above the fold:
 *   - production30dTonnes      total ROM over last 30 days
 *   - cashRunwayDays           net TZS over last 90 days, divided by daily avg
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

const analyticsRouter = new Hono();
analyticsRouter.use('*', authMiddleware);
analyticsRouter.use('*', databaseMiddleware);

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    ]);

    const productionTonnes = Number(production30dRows.rows?.[0]?.tonnes ?? 0);
    const salesCount = Number(sales30dRows.rows?.[0]?.sales_count ?? 0);
    const salesNetTzs = Number(sales30dRows.rows?.[0]?.net_tzs ?? 0);
    const cashNetTzs90d = Number(cashRunwayRows.rows?.[0]?.net_tzs_90d ?? 0);
    const cashSampleCount = Number(cashRunwayRows.rows?.[0]?.sample_count ?? 0);
    const dailyAvgTzs = cashNetTzs90d / 90;
    const cashRunwayDays = dailyAvgTzs > 0
      ? Math.round(cashNetTzs90d / dailyAvgTzs)
      : 0;
    const shiftsToday = Number(shiftsTodayRows.rows?.[0]?.shifts ?? 0);
    const shifts30d = Number(shifts30dRows.rows?.[0]?.shifts ?? 0);
    const openIncidentsHighCount = Number(incidentsHighRows.rows?.[0]?.incidents_count ?? 0);
    const licencesAtRiskCount = Number(licencesAtRiskRows.rows?.[0]?.licences_count ?? 0);

    return c.json({
      success: true,
      data: {
        production30dTonnes: productionTonnes,
        cashRunwayDays,
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
