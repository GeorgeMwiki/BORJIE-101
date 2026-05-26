/**
 * Geo-platform router.
 *
 *   POST /geo-platform/area-insights
 *
 * Wraps `fetchAreaInsights` from `@borjie/geo-platform`.
 * Returns the bundled Solar + Air Quality + Pollen + drive-time
 * sample for a coordinate. Partial-failure tolerant — per-section
 * errors are surfaced inside the response payload.
 *
 * Tenant-scoped + audit-logged. NB: this is a POST (not GET)
 * because the input includes a structured list of drive-time
 * targets that exceed a reasonable URL length.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { fetchAreaInsights } from '@borjie/geo-platform';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const WaypointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .passthrough();

const AreaInsightsInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  driveTimeTargets: z
    .array(
      z.object({
        label: z.string().min(1).max(128),
        destination: WaypointSchema,
      }),
    )
    .max(20)
    .optional(),
  include: z
    .object({
      solar: z.boolean().optional(),
      airQuality: z.boolean().optional(),
      pollen: z.boolean().optional(),
      routes: z.boolean().optional(),
    })
    .optional(),
});

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/area-insights',
  withSecurityEvents(
    {
      action: 'geo-platform.run',
      resource: 'geo-platform',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'tenantId required' },
          },
          400,
        );
      }
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = AreaInsightsInputSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      try {
        const result = await fetchAreaInsights(parsed.data as never);
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'geo-platform failed',
        });
      }
    },
  ),
);

export default router;
