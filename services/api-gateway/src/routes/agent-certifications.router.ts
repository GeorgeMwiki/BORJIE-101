/**
 * Agent certifications router \u2014 Wave-11 OpenClaw port.
 *
 * Mounted at `/api/v1/agent-certifications`.
 *
 *   GET    /                 \u2014 list certs for caller tenant (tenant admin)
 *   POST   /                 \u2014 issue a new cert (tenant admin)
 *   DELETE /:certId          \u2014 revoke a cert (tenant admin)
 *   GET    /revocations      \u2014 list revocation history
 *
 * The underlying service is injected through the shared `services` context so
 * tests and dev can swap an in-memory implementation without changing code.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';

import { withSecurityEvents } from '@borjie/observability';
const IssueSchema = z.object({
  agentId: z.string().min(1).max(128),
  scopes: z.array(z.string().min(1)).min(1).max(32),
  validForMs: z.number().int().positive().max(3 * 365 * 24 * 60 * 60 * 1000),
  metadata: z.record(z.unknown()).optional(),
});

const RevokeSchema = z.object({
  reason: z.string().min(1).max(500),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.agentCertification;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'agentCertification service not wired into api-gateway',
      },
    },
    503,
  );
}

app.get(
  '/',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: any) => {
    const auth = c.get('auth');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const items = await s.listForTenant(auth.tenantId);
      return c.json({ success: true, data: items });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | undefined;
      return c.json(
        {
          success: false,
          error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' },
        },
        400,
      );
    }
  },
);

app.get(
  '/revocations',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: any) => {
    const auth = c.get('auth');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const items = await s.listRevocations(auth.tenantId);
      return c.json({ success: true, data: items });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | undefined;
      return c.json(
        {
          success: false,
          error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' },
        },
        400,
      );
    }
  },
);

app.post(
  '/',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', IssueSchema),
  withSecurityEvents({ action: 'agent-certification.create', resource: 'agent-certification', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const cert = await s.issue({
        agentId: body.agentId,
        tenantId: auth.tenantId,
        scopes: body.scopes,
        issuer: auth.userId,
        validForMs: body.validForMs,
        metadata: body.metadata,
      });
      return c.json({ success: true, data: cert }, 201);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | undefined;
      return c.json(
        {
          success: false,
          error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' },
        },
        400,
      );
    }
  }),
);

app.delete(
  '/:certId',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', RevokeSchema),
  withSecurityEvents({ action: 'agent-certification.delete', resource: 'agent-certification', severity: 'notice' }, async (c: any) => {
    const auth = c.get('auth');
    const certId = c.req.param('certId');
    const body = c.req.valid('json');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      await s.revoke(certId, auth.tenantId, auth.userId, body.reason);
      return c.json({ success: true });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | undefined;
      return c.json(
        {
          success: false,
          error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' },
        },
        400,
      );
    }
  }),
);

export default app;
