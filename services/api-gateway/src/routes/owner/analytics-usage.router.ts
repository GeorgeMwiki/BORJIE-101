// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches.

/**
 * /api/v1/analytics/usage — owner-portal AnalyticsUsagePage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted AnalyticsUsagePage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/analytics/usage` as the
 * missing endpoint. The UI expects feature-usage metrics (logins,
 * payments processed, work-orders created) per active user. Until a
 * real usage warehouse export lands, this returns an empty series
 * with `X-Backend-Status: degraded`.
 *
 * Follow-up api-gateway, ANL-USAGE-001 (Docs/TODO_BACKLOG.md): wire the usage aggregator.
 *   Concrete next-step:
 *     1. Add `analytics_usage_daily` warehouse table populated by the
 *        outbox worker from `audit_events`.
 *     2. Add `repos.analyticsUsage.series(tenantId, range, dimension)`
 *        returning `{ date, dimension, count }[]`.
 *     3. Replace the degraded payload below with the real series.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'create analytics_usage_daily table + repos.analyticsUsage.series(tenantId, range, dimension) and replace this skeleton';

const FLAG_KEY = 'flag.bff.analytics.usage';

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
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, NEXT_STEP));
});

export const analyticsUsageRouter = app;
