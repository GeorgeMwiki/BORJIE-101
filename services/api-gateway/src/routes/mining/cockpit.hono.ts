/**
 * /api/v1/mining/cockpit — owner strategic cockpit widgets.
 *
 * Routes:
 *   GET  /daily-brief             one-glance start-of-day
 *   GET  /cash-runway             days-of-cash projection
 *   GET  /licence-health          dormancy + expiry-risk per licence
 *   GET  /production-vs-target    rolling 30-day production gap
 *   GET  /27mar-cliff-status      USD-cliff remediation rollup
 *
 * Migrated to `@hono/zod-openapi` (issue #19). Route definitions live
 * in `./_openapi/route-defs.ts` so the static spec generator can
 * register them without importing this file's middleware + DB code.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  licences,
  shiftReports,
  sales,
  incidents,
  grievances,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  cockpitDailyBriefRoute,
  cockpitCashRunwayRoute,
  cockpitLicenceHealthRoute,
  cockpitProductionVsTargetRoute,
  cockpitCliffStatusRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

app.openapi(cockpitDailyBriefRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const today = dayKey(new Date());
  const [shifts, openIncidents, openGrievances] = await Promise.all([
    db
      .select()
      .from(shiftReports)
      .where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.shiftDate, today))),
    db
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.status, 'open')))
      .limit(50),
    db
      .select()
      .from(grievances)
      .where(and(eq(grievances.tenantId, tenantId), eq(grievances.status, 'open')))
      .limit(50),
  ]);
  return c.json(
    {
      success: true as const,
      data: {
        date: today,
        shiftsToday: shifts.length,
        openIncidents: openIncidents.length,
        openGrievances: openGrievances.length,
        criticalIncidents: openIncidents.filter(
          (i) => i.severity === 'critical' || i.severity === 'high',
        ).length,
      },
    },
    200,
  );
});

app.openapi(cockpitCashRunwayRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const recentSales = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .orderBy(desc(sales.ts));
  const ninetyDayNetTzs = recentSales.reduce(
    (sum, s) => sum + Number(s.netTzs ?? 0),
    0,
  );
  const dailyAvgTzs = ninetyDayNetTzs / 90;
  return c.json(
    {
      success: true as const,
      data: {
        ninetyDayNetTzs,
        dailyAvgTzs,
        sampleCount: recentSales.length,
        note: 'Runway computation defers to ledger service for outflows; this surfaces inflow signal only.',
      },
    },
    200,
  );
});

app.openapi(cockpitLicenceHealthRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const rows = await db
    .select()
    .from(licences)
    .where(eq(licences.tenantId, tenantId))
    .orderBy(desc(licences.dormancyScore));
  const enriched = rows.map((row) => {
    const expiry = row.expiryDate ? new Date(row.expiryDate as unknown as string) : null;
    const daysToExpiry = expiry
      ? Math.round((expiry.getTime() - Date.now()) / 86_400_000)
      : null;
    return {
      ...row,
      daysToExpiry,
      atRisk:
        (row.dormancyScore ?? 0) >= 60 ||
        (daysToExpiry !== null && daysToExpiry <= 90),
    };
  });
  return c.json({ success: true as const, data: enriched }, 200);
});

app.openapi(cockpitProductionVsTargetRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const rows = await db
    .select({
      siteId: shiftReports.siteId,
      tonnes: sql<number>`COALESCE(SUM(${shiftReports.romTonnes}), 0)`,
      fuel: sql<number>`COALESCE(SUM(${shiftReports.fuelLitres}), 0)`,
      shifts: sql<number>`COUNT(*)`,
    })
    .from(shiftReports)
    .where(and(eq(shiftReports.tenantId, tenantId), gte(shiftReports.shiftDate, dayKey(cutoff))))
    .groupBy(shiftReports.siteId);
  return c.json(
    { success: true as const, data: { window: '30d' as const, perSite: rows } },
    200,
  );
});

app.openapi(cockpitCliffStatusRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date('2026-03-27T00:00:00Z');
  const usdSales = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .limit(500);
  const usdDenom = usdSales.filter((s) => Number(s.grossPriceUsd ?? 0) > 0).length;
  return c.json(
    {
      success: true as const,
      data: {
        cliffDateIso: cutoff.toISOString(),
        postCliffSales: usdSales.length,
        usdDenominated: usdDenom,
        remediationComplete: usdDenom === 0,
        note: 'Post-27-Mar-2026 domestic contracts must settle TZS-primary.',
      },
    },
    200,
  );
});

export const miningCockpitRouter = app;
