/**
 * Junior-AI factory router — Wave 28.
 *
 *   POST   /api/v1/junior-ai/provision       body: JuniorAISpec (sans tenantId)
 *   GET    /api/v1/junior-ai/mine            list juniors owned by the caller
 *   GET    /api/v1/junior-ai/:id
 *   PATCH  /api/v1/junior-ai/:id/scope       body: JuniorAIScopePatch
 *   POST   /api/v1/junior-ai/:id/suspend     body: { reason }
 *   POST   /api/v1/junior-ai/:id/revoke
 *
 * Gated with `requireRole(TEAM_LEAD)` — the platform has no literal
 * TEAM_LEAD enum value (see `src/types/user-role.ts`); the team-lead
 * role in practice is TENANT_ADMIN or PROPERTY_MANAGER, so we accept
 * either plus SUPER_ADMIN for support operations.
 *
 * Degrades to 503 NOT_IMPLEMENTED when the composition root has not
 * wired `services.juniorAI.factoryService` (mirrors autonomy.router).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const AUTONOMY_DOMAIN_VALUES = [
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal_proceedings',
  'tenant_welfare',
] as const;

const ProvisionBodySchema = z
  .object({
    domain: z.enum(AUTONOMY_DOMAIN_VALUES),
    mandate: z.string().min(1).max(500),
    policySubset: z.record(z.string(), z.unknown()),
    toolAllowlist: z.array(z.string().min(1)).min(1).max(100),
    memoryScope: z.enum(['team', 'personal']),
    certificationRequired: z.boolean(),
    lifecycle: z
      .object({
        expiresAt: z.string().datetime().optional(),
        maxActionsPerDay: z.number().int().positive().max(10_000).optional(),
      })
      .default({}),
  })
  .strict();

const ScopePatchSchema = z
  .object({
    mandate: z.string().min(1).max(500).optional(),
    policySubset: z.record(z.string(), z.unknown()).optional(),
    toolAllowlist: z.array(z.string().min(1)).min(1).max(100).optional(),
    lifecycle: z
      .object({
        expiresAt: z.string().datetime().optional(),
        maxActionsPerDay: z.number().int().positive().max(10_000).optional(),
      })
      .optional(),
  })
  .strict();

const SuspendBodySchema = z
  .object({ reason: z.string().min(1).max(500) })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.SUPER_ADMIN,
  ),
);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.juniorAI?.factoryService;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Junior-AI factory not wired on this gateway',
      },
    },
    503,
  );
}

function violationEnvelope(c: any, err: any) {
  return c.json(
    {
      success: false,
      error: {
        code: err.code ?? 'POLICY_SUBSET_VIOLATION',
        message: err.message,
        violations: err.violations ?? [],
      },
    },
    422,
  );
}

app.post(
  '/provision',
  zValidator('json', ProvisionBodySchema),
  withSecurityEvents({ action: 'junior-ai.create', resource: 'junior-ai', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const service = svc(c);
    if (!service) return notImplemented(c);
    try {
      const record = await service.provision({
        tenantId: auth.tenantId,
        teamLeadUserId: auth.userId,
        domain: body.domain,
        mandate: body.mandate,
        policySubset: body.policySubset,
        toolAllowlist: body.toolAllowlist,
        memoryScope: body.memoryScope,
        certificationRequired: body.certificationRequired,
        lifecycle: body.lifecycle ?? {},
      });
      return c.json({ success: true, data: record }, 201);
    } catch (err: any) {
      if (err?.code === 'POLICY_SUBSET_VIOLATION') {
        return violationEnvelope(c, err);
      }
      return routeCatch(c, err, {
        code: 'JUNIOR_AI_PROVISION_FAILED',
        status: 500,
        fallback: 'Junior-AI provision failed',
      });
    }
  }),
);

app.get('/mine', async (c: any) => {
  const auth = c.get('auth');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const list = await service.list(auth.tenantId, auth.userId);
    return c.json({ success: true, data: list });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'JUNIOR_AI_LIST_FAILED',
      status: 500,
      fallback: 'Junior-AI list failed',
    });
  }
});

app.get('/:id', async (c: any) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const record = await service.get(auth.tenantId, id);
    if (!record) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Junior-AI not found' } },
        404,
      );
    }
    return c.json({ success: true, data: record });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'JUNIOR_AI_FETCH_FAILED',
      status: 500,
      fallback: 'Junior-AI fetch failed',
    });
  }
});

app.patch(
  '/:id/scope',
  zValidator('json', ScopePatchSchema),
  withSecurityEvents({ action: 'junior-ai.update', resource: 'junior-ai', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const service = svc(c);
    if (!service) return notImplemented(c);
    try {
      const record = await service.adjustScope(auth.tenantId, id, body);
      return c.json({ success: true, data: record });
    } catch (err: any) {
      if (err?.code === 'POLICY_SUBSET_VIOLATION') {
        return violationEnvelope(c, err);
      }
      if (err?.code === 'JUNIOR_AI_NOT_ACTIVE') {
        return c.json(
          {
            success: false,
            error: { code: err.code, message: err.message },
          },
          409,
        );
      }
      return routeCatch(c, err, {
        code: 'JUNIOR_AI_SCOPE_ADJUST_FAILED',
        status: 500,
        fallback: 'Junior-AI scope adjust failed',
      });
    }
  }),
);

app.post(
  '/:id/suspend',
  zValidator('json', SuspendBodySchema),
  withSecurityEvents({ action: 'junior-ai.create', resource: 'junior-ai', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const service = svc(c);
    if (!service) return notImplemented(c);
    try {
      const record = await service.suspend(auth.tenantId, id, body.reason);
      return c.json({ success: true, data: record });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'JUNIOR_AI_SUSPEND_FAILED',
        status: 500,
        fallback: 'Junior-AI suspend failed',
      });
    }
  }),
);

app.post('/:id/revoke', withSecurityEvents({ action: 'junior-ai.create', resource: 'junior-ai', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const service = svc(c);
  if (!service) return notImplemented(c);
  try {
    const record = await service.revoke(auth.tenantId, id);
    return c.json({ success: true, data: record });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'JUNIOR_AI_REVOKE_FAILED',
      status: 500,
      fallback: 'Junior-AI revoke failed',
    });
  }
}));

export default app;
