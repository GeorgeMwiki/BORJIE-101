/**
 * /api/v1/analytics/growth — owner-portal AnalyticsGrowthPage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted AnalyticsGrowthPage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/analytics/growth` as the
 * missing endpoint. The UI expects time-series of NRG (net rental
 * growth), portfolio value trend, and tenancy churn. Until the
 * `analytics_growth` materialised view + read-model land, this returns
 * an empty series with `X-Backend-Status: degraded`.
 *
 * Follow-up (tracked in #33 as "analytics-growth aggregator"): wire the growth aggregator.
 *   Concrete next-step:
 *     1. Add Drizzle view `analytics_growth_monthly` joining
 *        properties → units → leases → invoices → payments grouped by
 *        month and tenantId.
 *     2. Add `repos.analyticsGrowth.series(tenantId, range)` returning
 *        `{ period, occupancy, revenue, noi }[]`.
 *     3. Replace the degraded payload below with the real series.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'create analytics_growth_monthly Drizzle view + repos.analyticsGrowth.series(tenantId, range) and replace this skeleton';

const FLAG_KEY = 'flag.bff.analytics.growth';

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

app.get('/', async (c) => {
  const auth = c.get('auth');
  // Loud-failure path: 501 unless an operator turns the dev-mode flag on.
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, NEXT_STEP));
});

export const analyticsGrowthRouter = app;
