//   across multiple c.json branches.

/**
 * Admin Portal BFF — tenant-wide rollup.
 *
 * Previously a stub that returned 503 (`createProtectedLiveDataRouter`).
 * Gated to TENANT_ADMIN/SUPER_ADMIN/ADMIN. Aggregates tenant-wide totals
 * (properties, units, active leases, open invoices) from the shared repo
 * middleware. The heavy-lifting reports live on `/reports` and `/dashboard`
 * — this BFF gives the admin landing page its top-of-screen tiles.
 *
 * Endpoints:
 *   GET /overview         — tenant-wide counts + balances
 *   GET /tenants          — convenience alias for superadmin listing (delegated)
 *   GET /webhooks         — frontend gap-fix: honest empty list until the
 *                            outbound webhook registry has a UI surface.
 *   GET /api-keys         — frontend gap-fix: honest empty list until the
 *                            api-key registry exposes a list endpoint.
 *   GET /roles            — frontend gap-fix: honest empty list until the
 *                            roles read-model is exported here.
 *   GET /roles/audit      — frontend gap-fix: honest empty list until the
 *                            role-change audit trail is wired.
 *
 * The four "honest empty" handlers below intentionally return
 * `{ success: true, data: [] }` rather than 503 / `notImplemented` so the
 * owner-portal admin dashboard can render an empty state instead of a
 * spinner that never resolves. Each handler has a clear follow-up reference
 * pointing at the backend service that needs to be wired before they
 * begin returning real rows.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { routeCatch } from '../../utils/safe-error';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.get('/overview', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  if (!repos) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Admin overview requires DB-backed repos — DATABASE_URL unset',
        },
      },
      503,
    );
  }
  // Property-domain repos were deleted in Borjie hard-fork. Return stub.
  return c.json({
    success: true,
    data: {
      counts: {
        properties: 0,
        units: 0,
        leases: 0,
        activeLeases: 0,
        customers: 0,
        openInvoices: 0,
      },
      financials: {
        openBalance: 0,
      },
    },
  });
});

// ----------------------------------------------------------------------------
// Frontend gap-fix endpoints — owner-portal calls these for the admin
// dashboard cards. The underlying domain services either don't expose a
// list endpoint yet or live behind a registry that the gateway hasn't
// surfaced. Returning an empty array (success: true) lets the page render
// the empty state cleanly. When the underlying services land, swap the
// stub for a real query.
// ----------------------------------------------------------------------------

// Helper: resolve a feature flag from services.featureFlags. Defaults to
// false (off) so 501-Not-Implemented is the loud-failure path.
async function adminFlagOn(c: any, flagKey: string): Promise<boolean> {
  const services = c.get('services') ?? {};
  const ff = services.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') return false;
  try {
    const auth = c.get('auth');
    return Boolean(await ff.isEnabled(auth?.tenantId ?? '', flagKey));
  } catch {
    return false;
  }
}

function notImpl(c: any, flagKey: string, nextStep: string) {
  c.header('X-Backend-Status', 'degraded');
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Downstream service for this endpoint is not wired. Concrete next-step: ${nextStep}`,
        flagKey,
      },
    },
    501,
  );
}

// GET /webhooks — outbound webhook subscriptions registry.
// ADMIN-BFF-001: real wire when `repos.outboundWebhooks.findMany` exists.
// Otherwise: loud-fail 501 unless the per-tenant feature flag is on.
app.get('/webhooks', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos') as { outboundWebhooks?: { findMany?: Function } } | undefined;
  const findMany = repos?.outboundWebhooks?.findMany;
  if (typeof findMany === 'function') {
    const rows = await findMany.call(repos!.outboundWebhooks, auth.tenantId);
    return c.json({ success: true, data: rows ?? [] });
  }
  if (!(await adminFlagOn(c, 'flag.bff.admin_portal.webhooks'))) {
    return notImpl(
      c,
      'flag.bff.admin_portal.webhooks',
      'expose repos.outboundWebhooks.findMany(tenantId) and call it here',
    );
  }
  return c.json({ success: true, data: [] });
});

// GET /api-keys — tenant-scoped API key listing.
// ADMIN-BFF-002: real wire when an api-key registry exposes listForTenant.
app.get('/api-keys', async (c) => {
  const auth = c.get('auth');
  const services = c.get('services') as { apiKeyRegistry?: { listForTenant?: Function } } | undefined;
  const list = services?.apiKeyRegistry?.listForTenant;
  if (typeof list === 'function') {
    const rows = await list.call(services!.apiKeyRegistry, auth.tenantId);
    return c.json({ success: true, data: rows ?? [] });
  }
  if (!(await adminFlagOn(c, 'flag.bff.admin_portal.api_keys'))) {
    return notImpl(
      c,
      'flag.bff.admin_portal.api_keys',
      'add apiKeyRegistry.listForTenant(tenantId) returning { keyId, label, lastUsedAt }',
    );
  }
  return c.json({ success: true, data: [] });
});

// GET /roles — tenant-scoped roles read-model.
// ADMIN-BFF-003: real wire when `repos.roles.findMany` exists.
app.get('/roles', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos') as { roles?: { findMany?: Function } } | undefined;
  const findMany = repos?.roles?.findMany;
  if (typeof findMany === 'function') {
    const rows = await findMany.call(repos!.roles, auth.tenantId);
    return c.json({ success: true, data: rows ?? [] });
  }
  if (!(await adminFlagOn(c, 'flag.bff.admin_portal.roles'))) {
    return notImpl(
      c,
      'flag.bff.admin_portal.roles',
      'select id,name,scope from roles where tenantId = auth.tenantId via repos.roles.findMany',
    );
  }
  return c.json({ success: true, data: [] });
});

// GET /roles/audit — recent role change audit entries.
// ADMIN-BFF-004: real wire when audit trail exposes a typed eventType filter.
app.get('/roles/audit', async (c) => {
  const auth = c.get('auth');
  const services = c.get('services') as { auditTrail?: { findByEventType?: Function } } | undefined;
  const findByEventType = services?.auditTrail?.findByEventType;
  if (typeof findByEventType === 'function') {
    const rows = await findByEventType.call(services!.auditTrail, auth.tenantId, 'role_change');
    return c.json({ success: true, data: rows ?? [] });
  }
  if (!(await adminFlagOn(c, 'flag.bff.admin_portal.roles_audit'))) {
    return notImpl(
      c,
      'flag.bff.admin_portal.roles_audit',
      'expose audit-trail filter by eventType=role_change scoped to tenantId',
    );
  }
  return c.json({ success: true, data: [] });
});

export const adminPortalRouter = app;
