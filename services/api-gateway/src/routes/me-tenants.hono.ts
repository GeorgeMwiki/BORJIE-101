/**
 * /api/v1/me/tenants — Roadmap R12, re-read over the UNIFIED membership
 * graph (surface-completion SC-5: person_links → org_memberships).
 *
 * Discord-style tenant rail backend. Returns every tenant where the caller
 * holds an ACTIVE EMPLOYMENT-CLASS org_membership (user_id IS NOT NULL —
 * the insider hats; buyer connections are external counterparties and never
 * appear in the insider rail), resolved from the caller's Supabase sub
 * through identity_auth_principals. person_links is NO LONGER read here —
 * migration 0346 backfilled every live link into the membership graph.
 *
 * POST /api/v1/me/tenants/active — switch the active tenant. Validates the
 * SAME membership predicate the auth middleware enforces per request
 * (`verifyEmploymentMembershipForTenant` — single shared gate), then writes
 * the `borjie-active-tenant` cookie (HttpOnly, SameSite=Lax). Since SC-2 the
 * auth middleware actually READS that cookie on every request: it re-derives
 * the membership grant, rebinds `app.current_tenant_id` AND swaps userId to
 * the shadow user in the target tenant, failing closed on a stale grant.
 *
 * RLS: both lookups are by definition CROSS-tenant (they read every hat
 * while the GUC is bound to the currently-active tenant), so they run inside
 * `withServiceRoleContext` — the service-role bypass policies on
 * org_memberships / identity_auth_principals (0336/0345) lift row visibility
 * for exactly these reads; the explicit sub + status predicates are the real
 * authorization gate. The tx-local GUC is discarded at COMMIT.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { createLogger } from '../utils/logger';
import {
  ACTIVE_TENANT_COOKIE_NAME as ACTIVE_TENANT_COOKIE,
  clearActiveTenantCache,
  verifyEmploymentMembershipForTenant,
} from '../middleware/active-tenant-override';

const moduleLogger = createLogger('me-tenants');

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

/**
 * The transaction-capable client `withServiceRoleContext` expects. Derived
 * from the function's own parameter type so we never have to name the
 * `DatabaseClient` type (which the bundled d.ts surfaces as a namespace).
 */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

interface TenantMembershipRow {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly logoUrl: string | null;
  readonly roleInTenant: string;
  readonly linkedAt: string;
  readonly active: boolean;
}

const SwitchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

function rowToMembership(
  row: Record<string, unknown>,
  activeTenantId: string,
): TenantMembershipRow {
  const tenantId = String(row.tenant_id);
  return {
    tenantId,
    tenantName: String(row.tenant_name ?? 'Untitled tenant'),
    logoUrl: row.logo_url ? String(row.logo_url) : null,
    roleInTenant: String(row.role_in_tenant ?? 'unknown'),
    linkedAt: String(row.linked_at ?? new Date(0).toISOString()),
    active: tenantId === activeTenantId,
  };
}

function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

export const meTenantsRouter = new Hono();
meTenantsRouter.use('*', authMiddleware);
meTenantsRouter.use('*', databaseMiddleware);

meTenantsRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db') as DbExec | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  const cookieActive = readCookie(
    c.req.header('cookie'),
    ACTIVE_TENANT_COOKIE,
  );
  const activeTenantId = cookieActive ?? auth.tenantId;
  try {
    // Cross-tenant read: every INSIDER hat the caller wears, regardless of
    // the bound tenant GUC — sub → principal → ACTIVE employment-class
    // memberships. Service-role lifts row visibility; the sub predicate is
    // the authorization gate.
    const rows = (await withServiceRoleContext(
      db as unknown as ServiceRoleDb,
      (sdb) =>
        sdb.execute(sql`
          SELECT
            m.platform_tenant_id AS tenant_id,
            m.member_role        AS role_in_tenant,
            m.joined_at          AS linked_at,
            COALESCE(t.name, 'Tenant') AS tenant_name,
            -- the tenants table has no logo column (neither in the Drizzle
            -- schema nor the live DB) so selecting t.logo_url threw column
            -- does not exist, 500-ing the org-switcher for EVERY actor. Emit
            -- NULL so the query succeeds; rowToMembership null-defaults logoUrl.
            NULL::text AS logo_url
          FROM identity_auth_principals iap
          JOIN org_memberships m
            ON m.tenant_identity_id = iap.tenant_identity_id
          LEFT JOIN tenants t ON t.id::text = m.platform_tenant_id
          WHERE iap.supabase_user_id = ${auth.userId}::uuid
            AND m.status = 'ACTIVE'
            AND m.user_id IS NOT NULL
          ORDER BY m.joined_at DESC
          LIMIT 50
        `),
    )) as unknown as Array<Record<string, unknown>>;
    const data = rows.map((r) => rowToMembership(r, activeTenantId));
    return c.json({
      success: true,
      data,
      meta: { activeTenantId },
    });
  } catch (err) {
    // Log the REAL cause server-side (the comment below promised "ops read
    // logs" but the bare `catch {}` swallowed it — a silent-failure factory:
    // this exact phantom-column error sat undiagnosable until a live walk).
    // The CLIENT still gets only the opaque code (no SQL/paths leaked).
    moduleLogger.error(
      { err: err instanceof Error ? err.message : String(err), route: '/me/tenants' },
      'me-tenants: membership query failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_MEMBERSHIPS_QUERY_FAILED',
          // SEC (hardening M1): never echo raw error internals (SQL, paths)
          // to the client — the code is enough for the UI; ops read logs.
          message: 'Unable to load your organization memberships. Please try again.',
        },
      },
      500,
    );
  }
});

meTenantsRouter.post(
  '/active',
  zValidator('json', SwitchTenantSchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db') as DbExec | null;
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database client is not initialized',
          },
        },
        503,
      );
    }
    const { tenantId } = c.req.valid('json');
    // Re-verify through the EXACT predicate the per-request auth override
    // enforces (SC-2): an ACTIVE employment-class membership in the target
    // tenant, resolved from the caller's auth principal. Never trust the
    // client's tenantId blindly.
    try {
      const grant = await verifyEmploymentMembershipForTenant(
        db as unknown as ServiceRoleDb,
        auth.userId,
        tenantId,
      );
      if (!grant) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_NOT_LINKED',
              message:
                'You are not an active member of this tenant, or your membership ended.',
            },
          },
          403,
        );
      }
    } catch {
      return c.json(
        {
          success: false,
          error: {
            code: 'TENANT_SWITCH_CHECK_FAILED',
            // SEC (hardening M1): generic client message; internals stay in logs.
            message: 'Unable to verify the tenant switch. Please try again.',
          },
        },
        500,
      );
    }

    // The switch takes effect on the NEXT request through the auth
    // middleware's override; bust its TTL cache so a re-switch after a very
    // recent denial is not shadowed for up to 60s.
    clearActiveTenantCache();

    // Write the active-tenant cookie. HttpOnly + SameSite=Lax so the
    // browser sends it back on every owner-web → api-gateway hop but
    // JS in the page cannot read or forge it.
    const cookie = [
      `${ACTIVE_TENANT_COOKIE}=${encodeURIComponent(tenantId)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=2592000', // 30 days
    ].join('; ');
    c.header('Set-Cookie', cookie);
    return c.json({ success: true, data: { activeTenantId: tenantId } });
  },
);

/** Re-exported for the auth middleware composition root (defined in
 *  middleware/active-tenant-override.ts since SC-2 — the single reader). */
export const ACTIVE_TENANT_COOKIE_NAME = ACTIVE_TENANT_COOKIE;
