// @ts-nocheck — hono v4 ContextVariableMap drift; tracked in Docs/TYPE_DEBT.md
/**
 * Autonomy policy router — Wave 16 gap-closure.
 *
 * Exposes per-tenant autonomy policy CRUD + the master `autonomousModeEnabled`
 * toggle. Admin-only. Writes flow through the service so every change is
 * audit-chained (Wave 11 security suite).
 *
 *   GET  /api/v1/autonomy/policy
 *   PUT  /api/v1/autonomy/policy
 *   POST /api/v1/autonomy/policy/enable
 *   POST /api/v1/autonomy/policy/disable
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const UpdatePolicySchema = z
  .object({
    autonomousModeEnabled: z.boolean().optional(),
    finance: z.record(z.string(), z.unknown()).optional(),
    leasing: z.record(z.string(), z.unknown()).optional(),
    maintenance: z.record(z.string(), z.unknown()).optional(),
    compliance: z.record(z.string(), z.unknown()).optional(),
    communications: z.record(z.string(), z.unknown()).optional(),
    escalationContacts: z
      .object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
      })
      .optional(),
  })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN)
);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.autonomy?.policyService;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Autonomy policy service not wired on this gateway',
      },
    },
    503
  );
}

app.get('/policy', async (c: any) => {
  const auth = c.get('auth');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const policy = await service.getPolicy(auth.tenantId);
    return c.json({ success: true, data: policy });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUTONOMY_POLICY_FETCH_FAILED',
      status: 500,
      fallback: 'Autonomy policy fetch failed',
    });
  }
});

app.put('/policy', zValidator('json', UpdatePolicySchema), withSecurityEvents({ action: 'autonomy.update', resource: 'autonomy', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const updated = await service.updatePolicy(
      auth.tenantId,
      body,
      auth.userId
    );
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    if (err?.code === 'VALIDATION') {
      return c.json(
        {
          success: false,
          error: {
            code: err?.code ?? 'VALIDATION',
            message: err?.message ?? 'validation failed',
          },
        },
        400
      );
    }
    return routeCatch(c, err, {
      code: 'AUTONOMY_POLICY_UPDATE_FAILED',
      status: 500,
      fallback: 'Autonomy policy update failed',
    });
  }
}));

app.post('/policy/enable', withSecurityEvents({ action: 'autonomy.create', resource: 'autonomy', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const updated = await service.updatePolicy(
      auth.tenantId,
      { autonomousModeEnabled: true },
      auth.userId
    );
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUTONOMY_ENABLE_FAILED',
      status: 500,
      fallback: 'Autonomy enable failed',
    });
  }
}));

app.post('/policy/disable', withSecurityEvents({ action: 'autonomy.create', resource: 'autonomy', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const updated = await service.updatePolicy(
      auth.tenantId,
      { autonomousModeEnabled: false },
      auth.userId
    );
    return c.json({ success: true, data: updated });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUTONOMY_DISABLE_FAILED',
      status: 500,
      fallback: 'Autonomy disable failed',
    });
  }
}));

export default app;
