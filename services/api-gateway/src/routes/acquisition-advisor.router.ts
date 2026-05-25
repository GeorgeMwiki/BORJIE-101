// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Acquisition advisor router.
 *
 *   POST /acquisition-advisor/recommend
 *
 * Wraps the pure `recommendAcquisition` composer from
 * `@borjie/acquisition-advisor`. Every call is tenant-scoped
 * via `authMiddleware` and audit-logged via `withSecurityEvents`.
 *
 * The advisor takes deeply-typed DD subsystem outputs as input.
 * We validate the minimum required shape at the gateway and
 * delegate full domain-type narrowing to the pure function — it
 * already rejects malformed inputs at the cost of a 500 with a
 * scrubbed error message.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { recommendAcquisition } from '@borjie/acquisition-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

// Minimum surface — every required field for the pure composer.
// Optional fields are kept loosely typed via `.passthrough()` to
// avoid mirroring 700-line domain types in two places.
const RecommendInputSchema = z
  .object({
    deal: z
      .object({
        id: z.string().min(1),
        nlaSqm: z.number().positive(),
        t12EGI: z.number(),
        t12Opex: z.number(),
        askingPrice: z.number().positive(),
        currency: z.string().min(3),
        subMarket: z.string().min(1),
        jurisdiction: z.string().min(1),
        assetClass: z.string().min(1),
        units: z.number().int().nonnegative(),
      })
      .passthrough(),
    saleTriangulation: z
      .object({
        weightedMedianPerSqm: z.number().nonnegative(),
        confidence: z.number().min(0).max(1),
      })
      .passthrough(),
    capRateDerivative: z
      .object({
        spreadBps: z.number(),
      })
      .passthrough(),
    marketCapRate: z.number().positive(),
    replacementCostValue: z.number().nonnegative().optional(),
    mcdaWeights: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/recommend',
  withSecurityEvents(
    {
      action: 'acquisition-advisor.run',
      resource: 'acquisition-advisor',
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
            error: {
              code: 'BAD_REQUEST',
              message: parsed.error.message,
            },
          },
          400,
        );
      }
      try {
        const result = recommendAcquisition(parsed.data as never);
        return c.json({ success: true, data: result });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'acquisition-advisor failed',
        });
      }
    },
  ),
);

export default router;
