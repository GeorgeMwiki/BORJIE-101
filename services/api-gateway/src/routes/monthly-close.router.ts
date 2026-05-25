// @ts-nocheck — hono v4 ContextVariableMap drift; tracked in Docs/TYPE_DEBT.md
/**
 * Monthly-close orchestrator router — Wave 28 Phase A Agent PhA2.
 *
 *   POST /api/v1/monthly-close/trigger              — manual run for current tenant
 *   GET  /api/v1/monthly-close                       — list recent runs
 *   GET  /api/v1/monthly-close/:runId                — one run's step-by-step state
 *   POST /api/v1/monthly-close/:runId/approve-step   — human approval for a gated step
 *
 * Admin-only. Every mutation wraps the orchestrator call in a try/catch +
 * `routeCatch` so SQL constraint errors / unexpected failures surface as
 * safely-redacted envelopes (Wave 19 safe-error contract).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import { MonthlyClose } from '@borjie/ai-copilot/orchestrators';

import { withSecurityEvents } from '@borjie/observability';
const {
  MONTHLY_CLOSE_STEPS,
  MonthlyCloseAlreadyCompletedError,
  MonthlyCloseRunNotFoundError,
  MonthlyCloseStepNotGatedError,
} = MonthlyClose;

const TriggerSchema = z
  .object({
    periodYear: z.number().int().min(2020).max(2100).optional(),
    periodMonth: z.number().int().min(1).max(12).optional(),
  })
  .strict();

const ApproveStepSchema = z
  .object({
    stepName: z.enum(
      MONTHLY_CLOSE_STEPS as unknown as [string, ...string[]],
    ),
  })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
);

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'MONTHLY_CLOSE_UNAVAILABLE',
        message: 'Monthly-close orchestrator not configured on this gateway.',
      },
    },
    503,
  );
}

function orch(c: any) {
  const services = c.get('services') ?? {};
  return services.monthlyClose?.orchestrator ?? null;
}

app.post('/trigger', zValidator('json', TriggerSchema), withSecurityEvents({ action: 'monthly-close.create', resource: 'monthly-close', severity: 'info' }, async (c: any) => {
  const svc = orch(c);
  if (!svc) return notConfigured(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');
  try {
    const result = await svc.triggerRun({
      tenantId: auth.tenantId,
      trigger: 'manual',
      triggeredBy: auth.userId,
      periodYear: body.periodYear,
      periodMonth: body.periodMonth,
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof MonthlyCloseAlreadyCompletedError) {
      return c.json(
        {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            runId: err.runId,
          },
        },
        409,
      );
    }
    return routeCatch(c, err, {
      code: 'MONTHLY_CLOSE_TRIGGER_FAILED',
      status: 500,
      fallback: 'Monthly-close trigger failed.',
    });
  }
}));

app.get('/', async (c: any) => {
  const svc = orch(c);
  if (!svc) return notConfigured(c);
  const auth = c.get('auth');
  const limit = Number(c.req.query('limit') ?? '20');
  try {
    const runs = await svc.listRuns(auth.tenantId, limit);
    return c.json({
      success: true,
      data: {
        runs,
        meta: { total: runs.length },
      },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'MONTHLY_CLOSE_LIST_FAILED',
      status: 500,
      fallback: 'Monthly-close listing failed.',
    });
  }
});

app.get('/:runId', async (c: any) => {
  const svc = orch(c);
  if (!svc) return notConfigured(c);
  const auth = c.get('auth');
  const runId = c.req.param('runId');
  try {
    const run = await svc.getRun(runId, auth.tenantId);
    return c.json({ success: true, data: run });
  } catch (err: any) {
    if (err instanceof MonthlyCloseRunNotFoundError) {
      return c.json(
        {
          success: false,
          error: { code: err.code, message: 'Run not found.' },
        },
        404,
      );
    }
    return routeCatch(c, err, {
      code: 'MONTHLY_CLOSE_FETCH_FAILED',
      status: 500,
      fallback: 'Monthly-close fetch failed.',
    });
  }
});

app.post(
  '/:runId/approve-step',
  zValidator('json', ApproveStepSchema),
  withSecurityEvents({ action: 'monthly-close.create', resource: 'monthly-close', severity: 'info' }, async (c: any) => {
    const svc = orch(c);
    if (!svc) return notConfigured(c);
    const auth = c.get('auth');
    const runId = c.req.param('runId');
    const body = c.req.valid('json');
    try {
      const run = await svc.approveStep({
        runId,
        tenantId: auth.tenantId,
        stepName: body.stepName,
        approverUserId: auth.userId,
      });
      return c.json({ success: true, data: run });
    } catch (err: any) {
      if (err instanceof MonthlyCloseRunNotFoundError) {
        return c.json(
          {
            success: false,
            error: { code: err.code, message: 'Run not found.' },
          },
          404,
        );
      }
      if (err instanceof MonthlyCloseStepNotGatedError) {
        return c.json(
          {
            success: false,
            error: {
              code: err.code,
              message: err.message ?? 'Step is not awaiting approval.',
            },
          },
          409,
        );
      }
      return routeCatch(c, err, {
        code: 'MONTHLY_CLOSE_APPROVE_FAILED',
        status: 500,
        fallback: 'Monthly-close approve-step failed.',
      });
    }
  }),
);

export default app;
