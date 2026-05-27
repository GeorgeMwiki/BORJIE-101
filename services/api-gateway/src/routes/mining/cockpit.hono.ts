/**
 * /api/v1/mining/cockpit — owner strategic cockpit widgets.
 *
 * Routes:
 *   GET  /daily-brief             one-glance start-of-day
 *   GET  /cash-runway             days-of-cash projection
 *   GET  /licence-health          dormancy + expiry-risk per licence
 *   GET  /production-vs-target    rolling 30-day production gap
 *   GET  /27mar-cliff-status      USD-cliff remediation rollup
 *   GET  /decisions               pending owner-decision queue (B-MgrDispatch)
 *   GET  /sic-pings               supervisor SIC ping queue (migration 0082)
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
  miningApprovalItems,
  miningSicPings,
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
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-cockpit');

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

// ---------------------------------------------------------------------------
// GET /decisions — pending owner-decision queue.
//
// Sources from `mining_approval_items` (B-MgrDispatch, migration 0081).
// Only rows targeted at the current authenticated user as approver, with
// status = 'pending', are returned. The mobile wiring agent surfaces
// these in the owner cockpit widget.
//
// If the `mining_approval_items` table is missing, the handler returns
// `{ items: [], note: 'awaiting B-Manager migration 0081' }` with 200.
// ---------------------------------------------------------------------------
app.get('/decisions', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: true as const,
        data: {
          items: [] as const,
          note: 'database not configured',
        },
      },
      200,
    );
  }
  try {
    const rows = await db
      .select()
      .from(miningApprovalItems)
      .where(
        and(
          eq(miningApprovalItems.tenantId, tenantId),
          eq(miningApprovalItems.approverUserId, userId),
          eq(miningApprovalItems.status, 'pending'),
        ),
      )
      .orderBy(desc(miningApprovalItems.createdAt))
      .limit(100);
    return c.json({ success: true as const, data: { items: rows } }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_approval_items"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_approval_items/i.test(message)
    ) {
      moduleLogger.warn(
        { tenantId },
        'mining_approval_items missing — returning empty decisions queue',
      );
      return c.json(
        {
          success: true as const,
          data: {
            items: [] as const,
            note: 'awaiting B-Manager migration 0081',
          },
        },
        200,
      );
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /sic-pings — supervisor Short Interval Control ping queue.
//
// Reads `mining_sic_pings` (migration 0082) newest-first. Bounded to the
// last 100 pings; the owner cockpit widget renders the top N.
// ---------------------------------------------------------------------------
app.get('/sic-pings', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: true as const,
        data: { items: [] as const, note: 'database not configured' },
      },
      200,
    );
  }
  try {
    const rows = await db
      .select()
      .from(miningSicPings)
      .where(eq(miningSicPings.tenantId, tenantId))
      .orderBy(desc(miningSicPings.pingedAt))
      .limit(100);
    return c.json({ success: true as const, data: { items: rows } }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_sic_pings"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_sic_pings/i.test(message)
    ) {
      moduleLogger.warn(
        { tenantId },
        'mining_sic_pings missing — returning empty SIC ping queue',
      );
      return c.json(
        {
          success: true as const,
          data: { items: [] as const, note: 'awaiting migration 0082' },
        },
        200,
      );
    }
    throw err;
  }
});

export const miningCockpitRouter = app;
