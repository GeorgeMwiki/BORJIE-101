/**
 * /api/v1/owner/break-glass — tenant-visible break-glass Trust Center
 * (INV-A / FIRE-1).
 *
 * The OWNER's side of the break-glass spine. The owning tenant CONSENTS to (or
 * denies / revokes) a Borjie-staff access request and SEES the full,
 * hash-chained access log — who accessed what, when, and why. Every grant +
 * log entry is strictly tenant-scoped: an owner can only ever act on / view
 * THEIR OWN tenant's records (the tenant id comes from the JWT, never a param).
 *
 * Routes:
 *   GET   /grants                  list grant requests for my tenant
 *   POST  /grants/:id/consent      consent → flips pending → active
 *   POST  /grants/:id/deny         deny a pending request
 *   POST  /grants/:id/revoke       revoke an active grant
 *   GET   /access-log              the hash-chained access transparency log
 *   GET   /access-log/verify       verify the chain is intact
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { UserRole } from '../../types/user-role';
import { getOperatorAccessStore } from '../../break-glass/store-singleton';
import { GrantNotFoundError } from '../../break-glass/operator-access-store';
import { createLogger } from '../../utils/logger';

const logger = createLogger('owner-break-glass');

// Consenting to / denying / revoking Borjie break-glass access is an
// owner-level governance act — it decides whether Borjie staff may touch the
// tenant's data. Only the tenant's owner / admin (or a platform super-admin)
// may exercise it. WITHOUT this gate ANY authenticated tenant member (incl. a
// field worker or buyer login) could consent to staff access. The role gate is
// the load-bearing control; reads stay broad so every member can see the log.
const BREAK_GLASS_DECISION_ROLES = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
] as const;

const app = new Hono();
app.use('*', authMiddleware);

function tenantOf(c: { get: (k: 'auth') => unknown }): {
  tenantId: string;
  userId: string;
} {
  const auth = c.get('auth') as { tenantId?: string; userId?: string } | undefined;
  return { tenantId: auth?.tenantId ?? '', userId: auth?.userId ?? '' };
}

app.get('/grants', async (c: any) => {
  const { tenantId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const store = getOperatorAccessStore();
  const grants = await store.listGrantsForTenant(tenantId);
  return c.json({ success: true, data: grants, meta: { count: grants.length } }, 200);
});

async function lifecycle(
  c: any,
  op: 'consent' | 'deny' | 'revoke',
): Promise<Response> {
  const { tenantId, userId } = tenantOf(c);
  const grantId = c.req.param('id');
  if (!tenantId || !grantId) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing tenant context or grant id' },
      },
      400,
    );
  }
  const store = getOperatorAccessStore();
  try {
    let grant;
    if (op === 'consent') {
      grant = await store.consent({ grantId, tenantId, consentedBy: userId });
    } else if (op === 'deny') {
      grant = await store.deny({ grantId, tenantId, deniedBy: userId });
    } else {
      grant = await store.revoke({ grantId, tenantId, revokedBy: userId });
    }
    logger.warn('break-glass tenant lifecycle', {
      evt: `break_glass_${op}`,
      grantId,
      tenantId,
      by: userId,
    });
    return c.json({ success: true, data: grant }, 200);
  } catch (error) {
    if (error instanceof GrantNotFoundError) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Grant not found for this tenant' } },
        404,
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    return c.json(
      { success: false, error: { code: 'BREAK_GLASS_LIFECYCLE_FAILED', message: reason } },
      500,
    );
  }
}

app.post(
  '/grants/:id/consent',
  requireRole(...BREAK_GLASS_DECISION_ROLES),
  (c: any) => lifecycle(c, 'consent'),
);
app.post(
  '/grants/:id/deny',
  requireRole(...BREAK_GLASS_DECISION_ROLES),
  (c: any) => lifecycle(c, 'deny'),
);
app.post(
  '/grants/:id/revoke',
  requireRole(...BREAK_GLASS_DECISION_ROLES),
  (c: any) => lifecycle(c, 'revoke'),
);

app.get('/access-log', async (c: any) => {
  const { tenantId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const store = getOperatorAccessStore();
  const entries = await store.listAccessLogForTenant(tenantId);
  return c.json({ success: true, data: entries, meta: { count: entries.length } }, 200);
});

app.get('/access-log/verify', async (c: any) => {
  const { tenantId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const store = getOperatorAccessStore();
  const result = await store.verifyTenantChain(tenantId);
  return c.json({ success: true, data: result }, 200);
});

export const ownerBreakGlassRouter = app;
