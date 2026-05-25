// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches.

/**
 * /api/v1/analytics/exports — owner-portal AnalyticsExportsPage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted AnalyticsExportsPage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/analytics/exports/templates`
 * as the missing endpoint. This router replies with an empty list +
 * `X-Backend-Status: degraded` so the UI stops 404'ing while the export
 * service is being designed.
 *
 * Follow-up api-gateway, ANL-EXPORTS-001 (Docs/TODO_BACKLOG.md): land the analytics export domain
 *   service. Concrete next-step:
 *     1. Add `analytics_export_templates` migration ({ id, tenantId,
 *        name, kind, schema, createdAt, createdBy }).
 *     2. Add `repos.analyticsExports.{listTemplates, listRecent, create}`
 *        in @borjie/database.
 *     3. Replace the degraded payload with a real query, scoped to
 *        `tenantId`.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'create analytics_export_templates table + repos.analyticsExports.listTemplates(tenantId) and replace this skeleton';

const FLAG_KEY = 'flag.bff.analytics.exports';

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

app.get('/templates', async (c) => {
  const auth = c.get('auth');
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, NEXT_STEP));
});

export const analyticsExportsRouter = app;
