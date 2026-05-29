/**
 * GET /api/v1/observability/realtime — RT-3.
 *
 * Returns the per-tenant cockpit-event round-trip aggregates
 * (P50/P95/P99 + min/max/avg/count) computed from samples posted to
 * `/api/v1/metrics/realtime-latency`.
 *
 * Used by the owner-web cockpit "Live sync" badge to render
 * `Live sync: P95 = 142 ms`.
 *
 * Auth: any signed-in tenant user. Cross-tenant snooping is
 * impossible — the store is keyed by `auth.tenantId`.
 */

import { Hono } from 'hono';

import { authMiddleware } from '../../middleware/hono-auth';
import { getStats } from '../../services/realtime-latency';

export const observabilityRealtimeRouter = new Hono();
observabilityRealtimeRouter.use('*', authMiddleware);

observabilityRealtimeRouter.get('/realtime', (c) => {
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = auth?.tenantId;
  if (!tenantId) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'auth.tenantId missing',
        },
      },
      401,
    );
  }
  const stats = getStats(tenantId);
  return c.json({ success: true as const, data: stats }, 200);
});

export default observabilityRealtimeRouter;
