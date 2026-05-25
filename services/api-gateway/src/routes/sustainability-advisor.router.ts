// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Sustainability advisor router.
 *
 *   POST /sustainability-advisor/property-esg-report
 *
 * Wraps the pure `buildPropertyEsgReport` composer from
 * `@borjie/sustainability-advisor`. Returns the assembled
 * PropertyEsg report including executive summary + veteran notes.
 * Tenant-scoped + audit-logged.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { buildPropertyEsgReport } from '@borjie/sustainability-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const PropertyEsgInputSchema = z
  .object({
    property: z
      .object({
        propertyId: z.string().min(1),
        assetClass: z.string().min(1),
        country: z.string().min(2),
      })
      .passthrough(),
    period: z
      .object({
        financialYear: z.union([z.string(), z.number()]),
        periodStart: z.string().min(1),
        periodEnd: z.string().min(1),
      })
      .passthrough(),
    carbon: z
      .object({
        totalOperationalKgCO2e: z.number().nonnegative(),
        intensityKgCO2ePerM2: z.number().nonnegative(),
      })
      .passthrough(),
    ratings: z.array(z.object({}).passthrough()),
    euTaxonomy: z.object({}).passthrough().nullable(),
    biodiversity: z.object({}).passthrough().nullable(),
    nbsOpportunities: z.array(z.object({}).passthrough()),
    recommendedTargets: z.array(z.object({}).passthrough()),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/property-esg-report',
  withSecurityEvents(
    {
      action: 'sustainability-advisor.run',
      resource: 'sustainability-advisor',
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
      const parsed = PropertyEsgInputSchema.safeParse(body);
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
        const result = buildPropertyEsgReport(parsed.data as never);
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'sustainability-advisor failed',
        });
      }
    },
  ),
);

export default router;
