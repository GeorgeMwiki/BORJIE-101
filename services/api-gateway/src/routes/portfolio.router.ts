/**
 * /api/v1/portfolio — owner-portal PortfolioAtAGlance source.
 *
 * The owner-portal calls these three endpoints to render the portfolio
 * dashboard:
 *
 *   GET /portfolio/summary       totalUnits, occupancyRate, totalProperties
 *   GET /portfolio/performance   per-property revenue / NOI / cap rate
 *   GET /portfolio/growth        per-month collections trend
 *
 * `/summary` runs a live aggregation when repos are wired (scoped to
 * the caller's `propertyAccess` set, mirroring `getOwnerScope` in
 * owner-portal.ts). `/performance` and `/growth` still return an
 * "honest empty" shape until per-property revenue/NOI rollups land.
 *
 * Follow-up api-gateway, PORT-005 (#33): swap `/performance` + `/growth` for
 *   Drizzle queries that join properties → units → leases → invoices
 *   → payments scoped to `auth.propertyAccess`. The summary endpoint
 *   here is the reference shape — extend it with per-property buckets
 *   for `/performance` and per-month buckets for `/growth`.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { logger } from '../utils/logger';

const portfolioRouter = new Hono();
portfolioRouter.use('*', authMiddleware);
portfolioRouter.use('*', databaseMiddleware);

const EMPTY_SUMMARY = {
  totalProperties: 0,
  totalUnits: 0,
  occupiedUnits: 0,
  vacantUnits: 0,
  occupancyRate: 0,
  activeLeases: 0,
};

function toCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /portfolio/summary — live mining-estate "at a glance" tile.
 *
 * The owner cockpit renders the legacy property-shaped `PortfolioSummary`
 * fields, so we map the mining estate aggregates onto them (no UI change):
 *
 *   totalProperties → active licences (the estate's permit umbrella)
 *   totalUnits      → total sites under those licences
 *   occupiedUnits   → producing/active sites (status='active')
 *   vacantUnits     → sites that are paused/abandoned/under_rehab
 *   occupancyRate   → active-site utilisation (occupied / total)
 *   activeLeases    → active workforce headcount (live-estate indicator)
 *
 * Every count is tenant-scoped by RLS (`app.current_tenant_id` bound by
 * databaseMiddleware) — we never double-filter tenant_id in app code.
 * Mining-native extras (sites + workforce + 30-day production) ride along
 * in `data.mining` for the surfaces that already read them.
 */
portfolioRouter.get('/summary', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');

  if (!db || !auth?.tenantId) {
    return c.json({
      success: true,
      data: { ...EMPTY_SUMMARY, meta: { source: 'empty' } },
    });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [licenceRows, siteRows, workforceRows, production30dRows] =
      await Promise.all([
        db.execute(sql`
          SELECT COUNT(*)::int AS active_licences
          FROM licences
          WHERE status = 'active'
        `),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total_sites,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_sites
          FROM sites
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS active_workforce
          FROM employees
          WHERE status = 'active'
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS sales_count
          FROM sales
          WHERE ts >= ${thirtyDaysAgo}
        `),
      ]);

    const activeLicences = toCount(licenceRows.rows?.[0]?.active_licences);
    const totalSites = toCount(siteRows.rows?.[0]?.total_sites);
    const activeSites = toCount(siteRows.rows?.[0]?.active_sites);
    const vacantSites = Math.max(0, totalSites - activeSites);
    const activeWorkforce = toCount(workforceRows.rows?.[0]?.active_workforce);
    const sales30dCount = toCount(production30dRows.rows?.[0]?.sales_count);
    const occupancyRate =
      totalSites > 0 ? Math.round((activeSites / totalSites) * 100) / 100 : 0;

    return c.json({
      success: true,
      data: {
        totalProperties: activeLicences,
        totalUnits: totalSites,
        occupiedUnits: activeSites,
        vacantUnits: vacantSites,
        occupancyRate,
        activeLeases: activeWorkforce,
        mining: {
          activeLicences,
          totalSites,
          activeSites,
          activeWorkforce,
          sales30dCount,
        },
        meta: { source: 'live' },
      },
    });
  } catch (err) {
    logger.error(
      { err, tenantId: auth.tenantId },
      'portfolio summary aggregation failed',
    );
    // Honest degrade — never leak the raw error to the client, never 500
    // the owner home tile. Surface the empty shape with a degraded marker
    // so the UI renders "0 sites" rather than an error panel.
    c.header('X-Backend-Status', 'degraded');
    return c.json({
      success: true,
      data: { ...EMPTY_SUMMARY, meta: { source: 'degraded' } },
    });
  }
});

// Loud-failure 501: the per-property revenue/NOI rollup tables are not
// yet wired. We return 501 unless a per-tenant feature flag is on (dev
// mode). The previous silent empty array hid the gap from observability.
async function performanceFlagOn(c: any): Promise<boolean> {
  const services = c.get('services') ?? {};
  const ff = services.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') return false;
  try {
    const auth = c.get('auth');
    return Boolean(await ff.isEnabled(auth?.tenantId ?? '', 'flag.bff.portfolio.performance'));
  } catch {
    return false;
  }
}

async function growthFlagOn(c: any): Promise<boolean> {
  const services = c.get('services') ?? {};
  const ff = services.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') return false;
  try {
    const auth = c.get('auth');
    return Boolean(await ff.isEnabled(auth?.tenantId ?? '', 'flag.bff.portfolio.growth'));
  } catch {
    return false;
  }
}

portfolioRouter.get('/performance', async (c) => {
  if (!(await performanceFlagOn(c))) {
    c.header('X-Backend-Status', 'degraded');
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Per-property performance rollup not wired. Concrete next-step: build a Drizzle query joining properties → units → leases → invoices → payments scoped to auth.propertyAccess returning { propertyId, monthlyRevenue, noi, capRate }.',
          flagKey: 'flag.bff.portfolio.performance',
        },
      },
      501,
    );
  }
  // Frontend expects an array of per-property performance rows.
  return c.json({ success: true, data: [] });
});

portfolioRouter.get('/growth', async (c) => {
  if (!(await growthFlagOn(c))) {
    c.header('X-Backend-Status', 'degraded');
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Per-month growth rollup not wired. Concrete next-step: aggregate payments by month-of-receipt grouped by auth.propertyAccess returning { month, collections, momDelta }.',
          flagKey: 'flag.bff.portfolio.growth',
        },
      },
      501,
    );
  }
  // Frontend expects an array of per-month growth points.
  return c.json({ success: true, data: [] });
});

export default portfolioRouter;
