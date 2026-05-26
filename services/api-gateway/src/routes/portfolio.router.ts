// @ts-nocheck — Hono v4 status-code literal union widens c.json branches.

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

portfolioRouter.get('/summary', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');

  if (!repos || !auth?.tenantId) {
    return c.json({
      success: true,
      data: { ...EMPTY_SUMMARY, meta: { source: 'empty' } },
    });
  }

  try {
    const propertyAccess = auth.propertyAccess;
    const allowsAll = Array.isArray(propertyAccess) && propertyAccess.includes('*');
    const allowedIds = new Set<string>(
      Array.isArray(propertyAccess) ? propertyAccess.filter((id) => id !== '*') : [],
    );

    const [propertiesResult, unitsResult, leasesResult] = await Promise.all([
      repos.properties.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.units.findMany(auth.tenantId, { limit: 5000, offset: 0 }),
      repos.leases.findMany(auth.tenantId, { limit: 5000, offset: 0 }),
    ]);

    const scopedProperties = allowsAll
      ? propertiesResult.items ?? []
      : (propertiesResult.items ?? []).filter((p) => allowedIds.has(p.id));
    const propertyIds = new Set(scopedProperties.map((p) => p.id));

    const scopedUnits = (unitsResult.items ?? []).filter((u) => propertyIds.has(u.propertyId));
    const occupiedUnits = scopedUnits.filter((u) => u.status === 'occupied').length;
    const vacantUnits = scopedUnits.length - occupiedUnits;
    const occupancyRate = scopedUnits.length === 0 ? 0 : occupiedUnits / scopedUnits.length;

    const unitIds = new Set(scopedUnits.map((u) => u.id));
    const activeLeases = (leasesResult.items ?? []).filter(
      (l) =>
        l.status === 'active' && (propertyIds.has(l.propertyId) || unitIds.has(l.unitId)),
    ).length;

    return c.json({
      success: true,
      data: {
        totalProperties: scopedProperties.length,
        totalUnits: scopedUnits.length,
        occupiedUnits,
        vacantUnits,
        occupancyRate,
        activeLeases,
        meta: { source: 'live' },
      },
    });
  } catch (error) {
    logger.warn('portfolio summary aggregation failed; falling back to empty', {
      tenantId: auth.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      success: true,
      data: { ...EMPTY_SUMMARY, meta: { source: 'empty' } },
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
