// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Expansion advisor router.
 *
 *   POST /expansion-advisor/recommend
 *
 * Wraps the pure `recommendExpansion` composer from
 * `@borjie/expansion-advisor`. Tenant-scoped + audit-logged.
 *
 * The advisor takes `ExpansionInputs` plus `AdvisorRules`. We
 * validate the minimum required shape and rely on the pure
 * function for full domain-type narrowing.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { recommendExpansion } from '@borjie/expansion-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const RecommendInputSchema = z
  .object({
    inputs: z
      .object({
        parcel: z.object({ id: z.string().min(1) }).passthrough(),
        candidates: z.array(z.object({}).passthrough()).min(1),
        market: z.object({}).passthrough(),
        comparables: z.array(z.object({}).passthrough()),
        gentrification: z.object({}).passthrough(),
        zoningLeverage: z.object({}).passthrough(),
        stack: z
          .object({
            tiers: z.array(z.object({}).passthrough()),
            constraints: z.object({}).passthrough().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
    rules: z
      .object({
        legality: z.object({}).passthrough(),
        physical: z.object({}).passthrough(),
        financial: z.object({}).passthrough(),
        horizonMonths: z.number().int().positive(),
        valueAdd: z.object({}).passthrough().optional(),
        landBankingHorizonYears: z.number().int().positive().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/recommend',
  withSecurityEvents(
    {
      action: 'expansion-advisor.run',
      resource: 'expansion-advisor',
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
      const parsed = RecommendInputSchema.safeParse(body);
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
        const result = recommendExpansion(
          parsed.data.inputs as never,
          parsed.data.rules as never,
        );
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'expansion-advisor failed',
        });
      }
    },
  ),
);

export default router;
