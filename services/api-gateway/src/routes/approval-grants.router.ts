/**
 * Approval Grants API — Wave 27 Agent D.
 *
 * Exposes the human-authorization primitive described by the user's mandate:
 * "If something is going to be autonomous, that's fine, but a human has to
 * approve it for it to be autonomous. And it's gonna be autonomous as a
 * one-task or a repetitive task, so that also has to be clarified."
 *
 * Endpoints (all require tenant-admin+ role):
 *
 *   POST /standing                         → grant a standing authorization
 *   POST /single                           → grant a one-shot authorization
 *   POST /:id/revoke                       → revoke immediately
 *   GET  /active                           → list currently-active grants
 *   GET  /history                          → paginated history (incl. revoked)
 *   GET  /check?actionCategory=&...        → used by task-agent executor
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const DOMAIN_ENUM = z.enum([
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
]);

const StandingScopeSchema = z
  .object({
    amountCeilingMinorUnits: z.number().int().min(0).optional(),
    entityType: z.string().min(1).optional(),
    entityIds: z.array(z.string().min(1)).min(1).nullable().optional(),
    maxPerDay: z.number().int().positive().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const SingleScopeSchema = z
  .object({
    targetEntityType: z.string().min(1),
    targetEntityId: z.string().min(1),
    amountMinorUnits: z.number().int().min(0).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const GrantStandingSchema = z
  .object({
    domain: DOMAIN_ENUM,
    actionCategory: z.string().min(1).max(100),
    scope: StandingScopeSchema,
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().nullable().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

const GrantSingleSchema = z
  .object({
    domain: DOMAIN_ENUM,
    actionCategory: z.string().min(1).max(100),
    scope: SingleScopeSchema,
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

const RevokeSchema = z
  .object({
    reason: z.string().min(1).max(500),
  })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
);

function svc(c: any): any {
  const services = c.get('services') ?? {};
  return services.approvalGrants?.service ?? null;
}

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'APPROVAL_GRANTS_UNAVAILABLE',
        message: 'ApprovalGrantService not configured on this gateway',
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// POST /standing
// ---------------------------------------------------------------------------
app.post('/standing', zValidator('json', GrantStandingSchema), withSecurityEvents({ action: 'approval-grant.create', resource: 'approval-grant', severity: 'warn' }, async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');
  try {
    const grant = await service.grantStanding(auth.tenantId, {
      ...body,
      createdBy: auth.userId,
    });
    return c.json({ success: true, data: grant }, 201);
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANT_STANDING_FAILED',
      fallback: 'Failed to issue standing grant',
    });
  }
}));

// ---------------------------------------------------------------------------
// POST /single
// ---------------------------------------------------------------------------
app.post('/single', zValidator('json', GrantSingleSchema), withSecurityEvents({ action: 'approval-grant.create', resource: 'approval-grant', severity: 'warn' }, async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');
  try {
    const grant = await service.grantSingle(auth.tenantId, {
      ...body,
      createdBy: auth.userId,
    });
    return c.json({ success: true, data: grant }, 201);
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANT_SINGLE_FAILED',
      fallback: 'Failed to issue single-action grant',
    });
  }
}));

// ---------------------------------------------------------------------------
// POST /:id/revoke
// ---------------------------------------------------------------------------
app.post('/:id/revoke', zValidator('json', RevokeSchema), withSecurityEvents({ action: 'approval-grant.create', resource: 'approval-grant', severity: 'warn' }, async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const { id } = c.req.param();
  const { reason } = c.req.valid('json');
  try {
    const grant = await service.revoke(id, auth.tenantId, auth.userId, reason);
    return c.json({ success: true, data: grant });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANT_REVOKE_FAILED',
      fallback: 'Failed to revoke grant',
    });
  }
}));

// ---------------------------------------------------------------------------
// GET /active
// ---------------------------------------------------------------------------
app.get('/active', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.query();
  try {
    const filters = {
      domain: q.domain || undefined,
      kind: q.kind || undefined,
      actionCategory: q.actionCategory || undefined,
      limit: q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : undefined,
    };
    const grants = await service.listActive(auth.tenantId, filters);
    return c.json({ success: true, data: grants });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANTS_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list active grants',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /history
// ---------------------------------------------------------------------------
app.get('/history', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.query();
  try {
    const filters = {
      domain: q.domain || undefined,
      kind: q.kind || undefined,
      actionCategory: q.actionCategory || undefined,
      includeRevoked: q.includeRevoked
        ? q.includeRevoked === 'true'
        : true,
      limit: q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : undefined,
      offset: q.offset ? Math.max(parseInt(q.offset, 10) || 0, 0) : undefined,
    };
    const grants = await service.listHistory(auth.tenantId, filters);
    return c.json({ success: true, data: grants });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANTS_HISTORY_FAILED',
      status: 500,
      fallback: 'Failed to fetch grant history',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /check — used by task-agent executor
// ---------------------------------------------------------------------------
app.get('/check', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.query();
  const actionCategory = q.actionCategory;
  if (!actionCategory) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION',
          message: 'actionCategory query param is required',
        },
      },
      400,
    );
  }
  try {
    const request = {
      domain: (q.domain as any) ?? 'finance',
      targetEntityType: q.targetEntityType || undefined,
      targetEntityId: q.targetEntityId || undefined,
      amountMinorUnits: q.amountMinorUnits
        ? parseInt(q.amountMinorUnits, 10)
        : undefined,
    };
    const result = await service.checkAuthorization(
      auth.tenantId,
      actionCategory,
      request,
    );
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'APPROVAL_GRANT_CHECK_FAILED',
      status: 500,
      fallback: 'Failed to check authorization',
    });
  }
});

export default app;
