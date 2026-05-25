// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Green-angle advisor router.
 *
 *   POST /green-angle-advisor/veteran-expert-report
 *
 * Wraps the pure `generateVeteranExpertReport` from
 * `@borjie/green-angle-advisor`. Given a free-form project
 * description + optional structured hints, returns sustainability
 * angles, financing instruments, carbon-market opportunities,
 * impact scoring, and a priority-ranked recommendation list.
 *
 * Tenant-scoped + audit-logged.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { generateVeteranExpertReport } from '@borjie/green-angle-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

// We mirror the shape that the advisor's own
// `ProjectDescriptionSchema` accepts but keep it relaxed via
// `.passthrough()` so new PROJECT_TYPES / JURISDICTIONS in the
// advisor package don't require a gateway redeploy.
const ReportInputSchema = z
  .object({
    description: z.string().min(1).max(20_000),
    hints: z.object({}).passthrough().optional(),
    options: z
      .object({
        minOpportunityScore: z.number().min(0).max(1).optional(),
        maxOpportunities: z.number().int().positive().optional(),
        minFinancingScore: z.number().min(0).max(1).optional(),
        maxFinancing: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/veteran-expert-report',
  withSecurityEvents(
    {
      action: 'green-angle-advisor.run',
      resource: 'green-angle-advisor',
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
      const parsed = ReportInputSchema.safeParse(body);
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
        const { options, ...description } = parsed.data;
        const result = await generateVeteranExpertReport(
          description as never,
          (options ?? {}) as never,
        );
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'green-angle-advisor failed',
        });
      }
    },
  ),
);

export default router;
