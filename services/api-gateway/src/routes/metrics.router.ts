/**
 * GET /api/v1/metrics — admin-only snapshot of the in-process metrics
 * registry.
 *
 * Returns the same shape emitted by MetricsRegistry.snapshot():
 *
 *   {
 *     collectedAt: ISO,
 *     uptimeSeconds: number,
 *     counters:   [{ name, description, value, labels }],
 *     gauges:     [{ name, description, value, labels }],
 *     histograms: [{ name, description, count, sum, p50, p95, p99, min, max, labels }]
 *   }
 *
 * This is NOT Prometheus text format — it's an internal dashboard feed.
 * The admin portal polls it every 5s; CI/ops can curl it too.
 */

import { Hono } from 'hono';
import { isAdminRole } from '@borjie/authz-policy';
import { getMetricsRegistry } from '../observability/metrics-registry.js';

type AuthedVars = { user?: { role?: string; id?: string } };
export const metricsRouter = new Hono<{ Variables: AuthedVars }>();

metricsRouter.get('/', async (c) => {
  // Admin-only — auth middleware upstream will have validated the JWT
  // and set c.get('user') with role. We double-check here defensively
  // via the shared `isAdminRole` helper (no role-string-matching here).
  const user = c.get('user');
  const isAdmin = isAdminRole(user?.role);

  if (!isAdmin) {
    return c.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Metrics endpoint is admin-only.' },
      },
      403,
    );
  }

  const snapshot = getMetricsRegistry().snapshot();
  return c.json({ success: true, data: snapshot });
});

metricsRouter.get('/health', async (c) => {
  // Non-admin health probe: returns a minimal subset of gauges.
  const snap = getMetricsRegistry().snapshot();
  const pick = (name: string) => snap.gauges.find((g) => g.name === name);
  return c.json({
    success: true,
    data: {
      uptimeSeconds: snap.uptimeSeconds,
      lastHeartbeatMs: pick('heartbeat.last_tick_ago_ms')?.value ?? null,
      activePersonas: pick('heartbeat.active_personas')?.value ?? null,
      collectedAt: snap.collectedAt,
    },
  });
});
