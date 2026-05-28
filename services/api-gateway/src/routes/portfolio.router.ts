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

  // Property-domain repos (properties, units, leases) were deleted in Borjie hard-fork. Return empty.
  return c.json({
    success: true,
    data: { ...EMPTY_SUMMARY, meta: { source: 'empty' } },
  });
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
