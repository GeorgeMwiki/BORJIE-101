// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Lifecycle advisor router.
 *
 *   POST /lifecycle-advisor/orchestrate
 *
 * Wraps the pure `orchestrateLifecycle` composer from
 * `@borjie/lifecycle-advisor`. Returns
 * `{ recommendations, nextBestAction }` for an asset at a given
 * lifecycle stage. Tenant-scoped + audit-logged.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { orchestrateLifecycle } from '@borjie/lifecycle-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const StageEnum = z.enum([
  'pre-development',
  'under-construction',
  'lease-up',
  'stabilised-hold',
  'refi-window',
  'disposition-window',
]);

const OrchestrateInputSchema = z
  .object({
    assetId: z.string().min(1),
    stage: StageEnum,
    // Each sub-section is optional — the orchestrator skips domains
    // whose inputs aren't supplied for the current stage.
    feasibility: z.object({}).passthrough().optional(),
    schedule: z.array(z.object({}).passthrough()).optional(),
    changeOrderRisk: z.object({}).passthrough().optional(),
    exitTiming: z.object({}).passthrough().optional(),
    buyerPipeline: z
      .object({ buyers: z.array(z.object({}).passthrough()) })
      .passthrough()
      .optional(),
    refiTimingMonths: z.number().int().positive().optional(),
    lenderSelection: z.object({}).passthrough().optional(),
    covenantStatus: z.object({}).passthrough().optional(),
    distributionForecast: z.object({}).passthrough().optional(),
    reportingCadence: z.object({}).passthrough().optional(),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/orchestrate',
  withSecurityEvents(
    {
      action: 'lifecycle-advisor.run',
      resource: 'lifecycle-advisor',
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
      const parsed = OrchestrateInputSchema.safeParse(body);
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
        const result = orchestrateLifecycle(parsed.data as never);
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'lifecycle-advisor failed',
        });
      }
    },
  ),
);

export default router;
