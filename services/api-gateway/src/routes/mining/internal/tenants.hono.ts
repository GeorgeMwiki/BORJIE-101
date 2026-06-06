/**
 * /api/v1/mining/internal/tenants — Borjie HQ tenant administration.
 *
 * SUPER_ADMIN-only surface for provisioning + suspension. All mutations
 * skip the per-tenant RLS scope (these rows ARE the tenant index) but
 * the route still requires platform-admin role.
 *
 * Routes:
 *   GET    /             list tenants
 *   POST   /             provision tenant
 *   PATCH  /:id          update plan / billing
 *   POST   /:id/suspend  suspend
 *   POST   /:id/activate activate (suspended/pending → active) [AD-8]
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { tenants } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalTenantsListRoute,
  internalTenantsProvisionRoute,
  internalTenantsUpdateRoute,
  internalTenantsSuspendRoute,
  internalTenantsActivateRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalTenantsListRoute, async (c) => {
  const db = c.get('db');
  const rows = await db
    .select()
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(100);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  internalTenantsProvisionRoute,
  withSecurityEvents(
    { action: 'platform.tenant.provision', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .insert(tenants)
        .values({
          id: randomUUID(),
          name: input.name,
          slug: input.slug,
          status: 'pending',
          subscriptionTier: input.subscriptionTier,
          plan: input.plan,
          primaryEmail: input.primaryEmail,
          primaryPhone: input.primaryPhone ?? null,
          country: input.country,
          region: input.region ?? 'af-south-1',
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  internalTenantsUpdateRoute,
  withSecurityEvents(
    { action: 'platform.tenant.update', resource: 'platform.tenant', severity: 'info' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const [row] = await db
        .update(tenants)
        .set({ ...input, updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

app.openapi(
  internalTenantsSuspendRoute,
  withSecurityEvents(
    { action: 'platform.tenant.suspend', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');
      const [row] = await db
        .update(tenants)
        .set({ status: 'suspended', updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

// AD-8 — Activate. The mirror of suspend: flips a `suspended` (or
// `pending`) tenant back to `active`. Reactivating an already-active
// tenant is a 409 no-op so the operator gets explicit feedback rather
// than a silent re-write. Admin-role guarded (router-level requireRole)
// and audited via withSecurityEvents, exactly like suspend.
app.openapi(
  internalTenantsActivateRoute,
  withSecurityEvents(
    { action: 'platform.tenant.activate', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');

      // Read current status first so we can reject an idempotent re-activate
      // with a clear 409 (and never silently bump updatedAt on a no-op).
      const [current] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      if (!current) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      if (current.status === 'active') {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'ALREADY_ACTIVE',
              message: 'Tenant is already active',
            },
          },
          409,
        );
      }

      const [row] = await db
        .update(tenants)
        .set({ status: 'active', updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningInternalTenantsRouter = app;
