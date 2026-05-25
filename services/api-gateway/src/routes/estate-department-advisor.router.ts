// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Estate-department advisor router.
 *
 *   POST /estate-department-advisor/department-health-report
 *
 * Wraps the pure `buildDepartmentHealthReport` from
 * `@borjie/estate-department-advisor`. Returns the veteran
 * director's multi-section department-health report ranked by
 * strategic priority. Tenant-scoped + audit-logged.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { buildDepartmentHealthReport } from '@borjie/estate-department-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const ReportInputSchema = z
  .object({
    portfolio: z
      .object({
        tenantId: z.string().min(1),
        properties: z.array(z.object({}).passthrough()),
        vendors: z.array(z.object({}).passthrough()),
      })
      .passthrough(),
    nowMs: z.number().int().nonnegative(),
    complianceHorizonDays: z.number().int().positive().optional(),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/department-health-report',
  withSecurityEvents(
    {
      action: 'estate-department-advisor.run',
      resource: 'estate-department-advisor',
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
      // Cross-tenant guard — caller's authenticated tenant must
      // match the portfolio's tenant. Prevents a portal user from
      // pulling another tenant's department health by spoofing the
      // body field.
      if (parsed.data.portfolio.tenantId !== tenantId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_MISMATCH',
              message: 'portfolio.tenantId must match authenticated tenant',
            },
          },
          403,
        );
      }
      try {
        const result = buildDepartmentHealthReport(parsed.data as never);
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'estate-department-advisor failed',
        });
      }
    },
  ),
);

export default router;
