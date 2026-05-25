// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Estate auto-management router.
 *
 *   POST /estate-auto-management/predictive-maintenance
 *
 * Wraps the pure `forecastFailure` + `maybeTriggerDispatch` pair
 * from `@borjie/estate-auto-management`. Given an asset
 * telemetry sample, returns the failure forecast AND (if the 30-day
 * probability crosses the policy threshold) a vendor-dispatch
 * trigger ready to hand to a WorkOrderPort.
 *
 * Tenant-scoped + audit-logged.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  forecastFailure,
  maybeTriggerDispatch,
} from '@borjie/estate-auto-management';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../middleware/hono-auth.js';
import { safeInternalError } from '../utils/safe-error.js';

type AnyCtx = any;

const FamilyEnum = z.enum([
  'hvac',
  'elevator',
  'pump',
  'generator',
  'gate-motor',
]);

const VerdictEnum = z.enum(['healthy', 'monitor', 'service', 'urgent']);

const TelemetrySchema = z.object({
  assetId: z.string().min(1),
  family: FamilyEnum,
  vibrationMm: z.number().nonnegative(),
  tempC: z.number(),
  runHours: z.number().nonnegative(),
  lastServiceAgeDays: z.number().nonnegative(),
  spikeCount30d: z.number().int().nonnegative(),
});

const PolicySchema = z.object({
  dispatchAtProb30d: z.number().min(0).max(1),
  slaHoursByVerdict: z
    .record(VerdictEnum, z.number().int().positive())
    .optional(),
});

const PredictiveInputSchema = z.object({
  telemetry: TelemetrySchema,
  policy: PolicySchema,
});

const router = new Hono();
router.use('*', authMiddleware);

router.post(
  '/predictive-maintenance',
  withSecurityEvents(
    {
      action: 'estate-auto-management.run',
      resource: 'estate-auto-management',
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
      const parsed = PredictiveInputSchema.safeParse(body);
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
        const forecast = forecastFailure(parsed.data.telemetry as never);
        const dispatch = maybeTriggerDispatch(
          forecast,
          parsed.data.policy as never,
        );
        return c.json({ success: true, data: { forecast, dispatch } });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'ADVISOR_ERROR',
          fallback: 'estate-auto-management failed',
        });
      }
    },
  ),
);

export default router;
