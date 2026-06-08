/**
 * /api/v1/mining/internal/break-glass — platform operator break-glass surface
 * (INV-A / FIRE-1).
 *
 * SUPER_ADMIN / ADMIN / SUPPORT only. This is the Borjie-staff side of the
 * break-glass spine: an operator FILES a deny-by-default request to access one
 * tenant's business data, and can LIST the status of their own requests. The
 * grant is unusable until the owning tenant CONSENTS on owner-web (the tenant
 * side lives in `routes/owner/break-glass.hono.ts`).
 *
 * Routes:
 *   POST /requests            file a request (status: pending, time-boxed)
 *   GET  /requests?tenant=…   list grant status for a tenant (metadata only)
 *
 * Filing a request is itself a platform-audited security event. It surfaces NO
 * tenant business data — only the operator's own request metadata.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddlewareNoPin } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { getOperatorAccessStore } from '../../../break-glass/store-singleton';
import { requestGrantSchema } from '../../../break-glass/types';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('internal-break-glass');

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT),
);
app.use('*', databaseMiddlewareNoPin);

// POST /requests — file a deny-by-default break-glass request.
app.post('/requests', async (c: any) => {
  const auth = c.get('auth') as {
    userId: string;
    email?: string;
  };
  const raw = await c.req.json().catch(() => null);
  const parsed = requestGrantSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid break-glass request',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  try {
    const store = getOperatorAccessStore();
    const grant = await store.requestGrant({
      ...parsed.data,
      operatorId: auth.userId,
      operatorEmail: auth.email ?? null,
    });
    logger.warn('break-glass requested', {
      evt: 'break_glass_requested',
      grantId: grant.id,
      operatorId: auth.userId,
      tenantId: grant.tenantId,
      justificationCode: grant.justificationCode,
      scopes: grant.scopes,
    });
    return c.json({ success: true, data: grant }, 201);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('break-glass request failed', {
      evt: 'break_glass_request_failed',
      reason,
    });
    return c.json(
      {
        success: false,
        error: { code: 'BREAK_GLASS_REQUEST_FAILED', message: reason },
      },
      500,
    );
  }
});

// GET /requests?tenant=… — status of grants for a tenant (metadata only).
app.get('/requests', async (c: any) => {
  const tenantId = (c.req.query('tenant') ?? c.req.query('tenantId') ?? '').trim();
  if (!tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'A tenant query parameter is required',
        },
      },
      400,
    );
  }
  const store = getOperatorAccessStore();
  const grants = await store.listGrantsForTenant(tenantId);
  return c.json({ success: true, data: grants, meta: { count: grants.length } }, 200);
});

export const miningInternalBreakGlassRouter = app;
