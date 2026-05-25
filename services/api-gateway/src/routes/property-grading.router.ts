// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal widening.
/**
 * Property-grading router.
 *
 * Mounted at `/api/v1/property-grading`. Every endpoint is tenant-scoped
 * via `authMiddleware`; the weight-configuration endpoints gate on
 * TENANT_ADMIN / SUPER_ADMIN.
 *
 *   GET  /property-grading/property/:propertyId
 *   GET  /property-grading/property/:propertyId/history?months=12
 *   GET  /property-grading/portfolio?weightBy=unit_count
 *   POST /property-grading/recompute/:propertyId
 *   GET  /property-grading/weights
 *   PUT  /property-grading/weights
 *
 * When the domain-services registry does not expose a
 * `propertyGrading` service (degraded mode) the endpoints return 503.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { safeInternalError } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

const WeightsInputSchema = z.object({
  income: z.number().min(0).max(1),
  expense: z.number().min(0).max(1),
  maintenance: z.number().min(0).max(1),
  occupancy: z.number().min(0).max(1),
  compliance: z.number().min(0).max(1),
  tenant: z.number().min(0).max(1),
});

const PortfolioQuerySchema = z.object({
  weightBy: z.enum(['equal', 'unit_count', 'asset_value']).optional(),
  previousScore: z.coerce.number().finite().optional(),
});

const HistoryQuerySchema = z.object({
  months: z.coerce.number().int().positive().max(36).optional(),
});

function getService(c: AnyCtx) {
  const services = c.get('services') ?? {};
  return services.propertyGrading ?? null;
}

function unavailable(c: AnyCtx) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'property-grading service is not wired in this environment',
      },
    },
    503,
  );
}

function badRequest(c: AnyCtx, message: string) {
  return c.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    400,
  );
}

function internalError(c: AnyCtx, err: unknown) {
  // Wave 19 Agent H+I: scrub in prod; dev keeps detail.
  return safeInternalError(c, err, {
    code: 'INTERNAL_ERROR',
    fallback: 'Internal server error',
  });
}

export const propertyGradingRouter = new Hono();
propertyGradingRouter.use('*', authMiddleware);

propertyGradingRouter.get('/property/:propertyId', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const svc = getService(c);
  if (!svc) return unavailable(c);
  const propertyId = c.req.param('propertyId');
  if (!propertyId) return badRequest(c, 'propertyId is required');
  try {
    const outcome = await svc.gradeProperty(auth.tenantId, propertyId);
    if (outcome.kind === 'insufficient') {
      return c.json({ success: true, data: outcome.report });
    }
    return c.json({ success: true, data: outcome.report });
  } catch (e) {
    return internalError(c, e);
  }
});

propertyGradingRouter.get('/property/:propertyId/history', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const svc = getService(c);
  if (!svc) return unavailable(c);
  const propertyId = c.req.param('propertyId');
  const parsed = HistoryQuerySchema.safeParse({ months: c.req.query('months') });
  if (!parsed.success) return badRequest(c, parsed.error.message);
  try {
    const history = await svc.trackOverTime(
      auth.tenantId,
      propertyId,
      parsed.data.months ?? 12,
    );
    return c.json({
      success: true,
      data: history,
      meta: { total: history.length },
    });
  } catch (e) {
    return internalError(c, e);
  }
});

propertyGradingRouter.get('/portfolio', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const svc = getService(c);
  if (!svc) return unavailable(c);
  const parsed = PortfolioQuerySchema.safeParse({
    weightBy: c.req.query('weightBy'),
    previousScore: c.req.query('previousScore'),
  });
  if (!parsed.success) return badRequest(c, parsed.error.message);
  try {
    const portfolio = await svc.getPortfolioGrade(auth.tenantId, {
      weightBy: parsed.data.weightBy,
      previousScore: parsed.data.previousScore,
    });
    return c.json({ success: true, data: portfolio });
  } catch (e) {
    return internalError(c, e);
  }
});

propertyGradingRouter.post(
  '/recompute/:propertyId',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  withSecurityEvents({ action: 'property-grading.create', resource: 'property-grading', severity: 'info' }, async (c: AnyCtx) => {
    const auth = c.get('auth');
    const svc = getService(c);
    if (!svc) return unavailable(c);
    const propertyId = c.req.param('propertyId');
    try {
      const outcome = await svc.gradeProperty(auth.tenantId, propertyId);
      return c.json({ success: true, data: outcome.report }, 201);
    } catch (e) {
      return internalError(c, e);
    }
  }),
);

propertyGradingRouter.get('/weights', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const svc = getService(c);
  if (!svc) return unavailable(c);
  try {
    const weights = await svc.getWeights(auth.tenantId);
    return c.json({ success: true, data: weights });
  } catch (e) {
    return internalError(c, e);
  }
});

propertyGradingRouter.put(
  '/weights',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  withSecurityEvents({ action: 'property-grading.update', resource: 'property-grading', severity: 'info' }, async (c: AnyCtx) => {
    const auth = c.get('auth');
    const svc = getService(c);
    if (!svc) return unavailable(c);
    const body = await c.req.json().catch(() => ({}));
    const parsed = WeightsInputSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.message);
    try {
      const weights = await svc.setWeights(auth.tenantId, parsed.data);
      return c.json({ success: true, data: weights });
    } catch (e) {
      return internalError(c, e);
    }
  }),
);

export default propertyGradingRouter;
