// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Gamification router (NEW 9 — 3-layer Till-model)
 *
 * Endpoints:
 *   GET  /v1/gamification/policies
 *   PUT  /v1/gamification/policies
 *   GET  /v1/gamification/customers/:customerId
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import {
  createGamificationService,
  GamificationError,
  type GamificationRepository,
  type CashbackQueuePort,
} from '@borjie/domain-services/gamification';

import { withSecurityEvents } from '@borjie/observability';
function getService(c: { get: (k: string) => unknown }) {
  const injected = c.get('gamificationService');
  if (injected) return injected as ReturnType<typeof createGamificationService>;
  const repo = c.get('gamificationRepo') as GamificationRepository;
  const cashbackQueue = c.get('cashbackQueue') as CashbackQueuePort | undefined;
  if (!repo) {
    throw new Error('gamification router requires gamificationRepo in context');
  }
  return createGamificationService({ repo, cashbackQueue });
}

const PolicyUpdateSchema = z.object({
  onTimePoints: z.number().int().optional(),
  earlyPaymentBonusPoints: z.number().int().optional(),
  latePenaltyPoints: z.number().int().optional(),
  streakBonusPoints: z.number().int().optional(),
  bronzeThreshold: z.number().int().optional(),
  silverThreshold: z.number().int().optional(),
  goldThreshold: z.number().int().optional(),
  platinumThreshold: z.number().int().optional(),
  earlyPayDiscountBps: z.number().int().min(0).max(10000).optional(),
  earlyPayMinDaysBefore: z.number().int().min(0).optional(),
  earlyPayMaxCreditMinor: z.number().int().min(0).optional(),
  lateFeeBps: z.number().int().min(0).max(10000).optional(),
  lateFeeGraceDays: z.number().int().min(0).optional(),
  lateFeeMaxMinor: z.number().int().min(0).optional(),
  cashbackEnabled: z.boolean().optional(),
  cashbackBps: z.number().int().min(0).max(10000).optional(),
  cashbackMonthlyCapMinor: z.number().int().min(0).optional(),
  cashbackProvider: z
    .enum(['mpesa_b2c', 'airtel_b2c', 'tigopesa_b2c'])
    .optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

// --- GET policies (active) -------------------------------------------------
app.get('/policies', async (c) => {
  const auth = c.get('auth');
  const service = getService(c);
  try {
    const policy = await service.getOrCreatePolicy(auth.tenantId, auth.userId);
    return c.json({ success: true, data: policy });
  } catch (err) {
    return mapError(c, err);
  }
});

// --- PUT policies ----------------------------------------------------------
app.put('/policies', zValidator('json', PolicyUpdateSchema), withSecurityEvents({ action: 'gamification.update', resource: 'gamification', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const patch = c.req.valid('json');
  const service = getService(c);
  try {
    const policy = await service.updatePolicy(auth.tenantId, patch, auth.userId);
    return c.json({ success: true, data: policy });
  } catch (err) {
    return mapError(c, err);
  }
}));

// --- GET customer state ----------------------------------------------------
app.get('/customers/:customerId', async (c) => {
  const auth = c.get('auth');
  const customerId = c.req.param('customerId');
  const service = getService(c);
  try {
    const profile = await service.getCustomerState(auth.tenantId, customerId);
    return c.json({ success: true, data: profile });
  } catch (err) {
    return mapError(c, err);
  }
});

function mapError(c: unknown, err: unknown) {
  const ctx = c as { json: (b: unknown, s: number) => unknown };
  if (err instanceof GamificationError) {
    const httpStatus =
      err.code === 'POLICY_NOT_FOUND'
        ? 404
        : err.code === 'TENANT_MISMATCH'
        ? 403
        : err.code === 'DUPLICATE_EVENT'
        ? 409
        : 400;
    return ctx.json(
      { success: false, error: { code: err.code, message: err.message } },
      httpStatus
    );
  }
  return ctx.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'unknown',
      },
    },
    500
  );
}

export default app;
export const gamificationRouter = app;
