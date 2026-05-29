/**
 * Auxiliary endpoints for the workforce tab-config surface — Wave
 * WORKFORCE-FIXED-TABS.
 *
 *   GET /api/v1/owner/workforce/tab-configs/all
 *     Owner-side list endpoint that the owner-web matrix uses to
 *     hydrate every (role, site_scope) row in one round-trip. Tenant-
 *     scoped via RLS.
 *
 *   GET /api/v1/internal/workforce/tab-policy-summary
 *     Admin-only cross-tenant aggregate. Counts how many tenants enable
 *     each (role, tabId) pair across the fleet, so the Borjie team can
 *     spot pilot tenants who have not yet enabled enough tabs. Bypasses
 *     the per-tenant RLS scope because the request is platform-admin.
 */

import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';

import { workforceRoleTabConfigs } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('workforce-tab-configs-extras');

const OWNER_SIDE_ROLES = new Set<string>(['owner', 'manager']);

const ADMIN_ROLES = new Set<string>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
]);

// ---------------------------------------------------------------------------
// Owner-side LIST endpoint
// ---------------------------------------------------------------------------

const ownerListApp = new Hono();
ownerListApp.use('*', authMiddleware);
ownerListApp.use('*', databaseMiddleware);

ownerListApp.get('/tab-configs/all', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    role: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_CONFIG_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  const platformRole = (auth.role ?? '').toString();
  if (!OWNER_SIDE_ROLES.has(jwtRole) && !ADMIN_ROLES.has(platformRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only owner / manager / platform admin may list configs',
        },
      },
      403,
    );
  }

  const rows = await db
    .select()
    .from(workforceRoleTabConfigs)
    .where(eq(workforceRoleTabConfigs.tenantId, auth.tenantId))
    .orderBy(desc(workforceRoleTabConfigs.updatedAt));

  return c.json({
    success: true,
    data: rows,
    meta: { total: rows.length },
  });
});

export const workforceTabConfigOwnerListRouter = ownerListApp;

// ---------------------------------------------------------------------------
// Internal admin aggregate endpoint
// ---------------------------------------------------------------------------

const adminApp = new Hono();
adminApp.use('*', authMiddleware);
adminApp.use('*', databaseMiddleware);

adminApp.get('/workforce/tab-policy-summary', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    role: string;
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_POLICY_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const platformRole = (auth.role ?? '').toString();
  if (!ADMIN_ROLES.has(platformRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Platform admin role required',
        },
      },
      403,
    );
  }

  try {
    const distRes = await db.execute(sql`
      SELECT role::text AS role,
             tab_id::text AS tab_id,
             COUNT(DISTINCT tenant_id)::int AS tenant_count
        FROM workforce_role_tab_configs,
             LATERAL unnest(enabled_tab_ids) AS tab_id
       GROUP BY role, tab_id
       ORDER BY role, tab_id
    `);
    const distribution = Array.isArray(distRes)
      ? distRes
      : ((distRes as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
        []);

    const totalRes = await db.execute(sql`
      SELECT COUNT(DISTINCT tenant_id)::int AS total
        FROM workforce_role_tab_configs
    `);
    const totalRow = Array.isArray(totalRes)
      ? (totalRes as ReadonlyArray<Record<string, unknown>>)[0]
      : ((totalRes as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
          [])[0];
    const totalTenants = Number(totalRow?.total ?? 0);

    return c.json({
      success: true,
      data: {
        totalTenants,
        distribution: (distribution as ReadonlyArray<{
          role: string;
          tab_id: string;
          tenant_count: number;
        }>).map((row) => ({
          role: row.role,
          tabId: row.tab_id,
          tenantCount: Number(row.tenant_count),
        })),
      },
    });
  } catch (err) {
    moduleLogger.warn(
      'workforce-tab-policy-summary: aggregate failed',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return c.json(
      {
        success: true,
        data: { totalTenants: 0, distribution: [] },
      },
      200,
    );
  }
});

export const workforceTabPolicyAdminRouter = adminApp;
