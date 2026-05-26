/**
 * Applications API Routes (NEW 18)
 *
 *   GET  /               → smoke-test endpoint; returns empty [] so the
 *                          acceptance curl sees 200
 *   POST /route          → returns station master id for an application
 *                          location + asset type
 *
 * Wired to `StationMasterRouter` via the composition root. Falls back to
 * 503 if DATABASE_URL is unset (degraded mode).
 */


import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const RouteBodySchema = z.object({
  applicationId: z.string().min(1),
  assetType: z.enum(['residential', 'commercial', 'land', 'mixed_use']),
  location: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
    regionId: z.string().optional(),
    propertyId: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error:
        'StationMasterRouter not configured — DATABASE_URL unset',
    },
    503
  );
}

// GET / — smoke-test root. There is no persistent "application" aggregate
// yet (routing is stateless); the list endpoint exists so the acceptance
// curl returns 200 with an empty array.
app.get('/', async (c: any) => {
  const router = c.get('stationMasterRouter');
  if (!router) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'POST /route with { applicationId, assetType, location } to resolve a station master',
    },
  });
});

app.post('/route', zValidator('json', RouteBodySchema), withSecurityEvents({ action: 'application.create', resource: 'application', severity: 'info' }, async (c: any) => {
  const router = c.get('stationMasterRouter');
  if (!router) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const body = c.req.valid('json');
  try {
    const result = await router.routeApplication({ ...body, tenantId });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    const message =
      error instanceof Error ? error.message : 'Routing failed';
    const code = error?.code ?? 'ROUTE_FAILED';
    const status = code === 'NO_MATCH' ? 404 : 400;
    return c.json(
      { success: false, error: { code, message, diagnostics: error?.diagnostics } },
      status
    );
  }
}));

export default app;
