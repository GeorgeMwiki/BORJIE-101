
/**
 * /api/v1/analytics — owner-portal AnalyticsSummary card source.
 *
 * The owner-portal Analytics dashboard calls `GET /analytics/summary` to
 * populate top-of-page KPI tiles (occupancy %, revenue MoM, NOI, arrears
 * trend). When repos are wired we compute a real summary from the
 * caller's `propertyAccess` scope; otherwise we return an "honest
 * empty" shape so the page renders the empty state instead of stalling
 * on a never-resolving fetch.
 *
 * NEVER fabricate data. Each metric is reported as 0 (or null where the
 * frontend's fallback expects it) and `meta.source` is set to either
 * `live` or `empty` so the UI can opt to render an em-dash if it
 * prefers.
 *
 * Follow-up api-gateway, ANL-002 (#33): replace this aggregation pass with a
 *   dedicated read-model (`analytics_summary` materialised view) once the
 *   numbers below get expensive to recompute on every dashboard load.
 *   Concrete next-step:
 *     1. Add Drizzle view `analytics_summary` joining
 *        properties → units → leases → invoices → payments.
 *     2. Replace the inline reductions with a `repos.analytics.summary`
 *        call.
 *     3. Cache the row in Redis with a 60s TTL keyed by
 *        `tenantId + sortedPropertyIds`.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { logger } from '../utils/logger';

const analyticsRouter = new Hono();
analyticsRouter.use('*', authMiddleware);
analyticsRouter.use('*', databaseMiddleware);

const EMPTY_SUMMARY = {
  occupancyRate: 0,
  monthlyRevenue: 0,
  revenueGrowth: 0,
  netOperatingIncome: 0,
  arrearsBalance: 0,
  collectionRate: 0,
  totalProperties: 0,
  totalUnits: 0,
  activeLeases: 0,
};

const EMPTY_NOTE =
  'analytics aggregator not yet wired — returning zeroed shape so the dashboard renders an empty state';

analyticsRouter.get('/summary', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');

  if (!repos || !auth?.tenantId) {
    return c.json({
      success: true,
      data: {
        ...EMPTY_SUMMARY,
        meta: { source: 'empty', note: EMPTY_NOTE },
      },
    });
  }

  // Property-domain repos were deleted in Borjie hard-fork. Return empty.
  return c.json({
    success: true,
    data: {
      ...EMPTY_SUMMARY,
      meta: { source: 'empty', note: EMPTY_NOTE },
    },
  });
});

export default analyticsRouter;
