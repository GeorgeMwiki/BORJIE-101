/**
 * /api/v1/me/tenants — Roadmap R12.
 *
 * Discord-style tenant rail backend. Returns every tenant the caller
 * has a `person_links` row for, with the canonical display name +
 * primary logo URL (when set). The rail in owner-web reads this and
 * lets the user wear another "hat" without re-authenticating.
 *
 * POST /api/v1/me/tenants/active — switch the active tenant. Writes
 * a `borjie-active-tenant` cookie (HttpOnly, SameSite=Lax). The
 * api-gateway auth middleware reads this cookie on each request and
 * re-binds the `app.current_tenant_id` GUC for RLS scoping.
 *
 * Security note: the user can only switch to a tenant they already
 * have a link for. Cross-tenant injection via the cookie is impossible
 * because the auth middleware re-validates the link on every request.
 *
 * RLS (migration 0333): person_links now carries FORCE RLS scoped to
 * `app.current_tenant_id` (its tenant key is tenant_id UUID NOT NULL).
 * BUT both lookups below are, by definition, CROSS-tenant: they read
 * EVERY tenant the caller is linked to (keyed on supabase_user_id) while
 * `app.current_tenant_id` is still bound to the user's CURRENTLY-active
 * tenant. Under the plain tenant_isolation policy they would return only
 * links for the active tenant — hiding all the OTHER hats and breaking
 * the rail / the switch re-verification. Each runs inside
 * `withServiceRoleContext`, which sets `app.is_service_role='true'`
 * transaction-locally so the `person_links_service_role_bypass` policy
 * short-circuits the tenant predicate for exactly these reads. The bypass
 * is GUC-driven (independent of the DB login role's BYPASSRLS bit), and
 * the `true` set_config scope means it is discarded at COMMIT — it never
 * leaks onto the rest of the request, which stays tenant-scoped.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

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

const ACTIVE_TENANT_COOKIE = 'borjie-active-tenant';

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
    // Cross-tenant read: every hat the caller wears, regardless of the bound
    // tenant GUC. Service-role context lets the bypass policy on person_links
    // return all linked tenants; the tx-local GUC is discarded at COMMIT.
    const rows = (await withServiceRoleContext(
      db as unknown as ServiceRoleDb,
      (sdb) =>
        sdb.execute(sql`
          SELECT
            pl.tenant_id,
            pl.role_in_tenant,
            pl.linked_at,
            COALESCE(t.name, t.legal_name, 'Tenant') AS tenant_name,
            t.logo_url
          FROM person_links pl
          LEFT JOIN tenants t ON t.id::text = pl.tenant_id::text
          WHERE pl.supabase_user_id = ${auth.userId}::uuid
            AND pl.unlinked_at IS NULL
          ORDER BY pl.linked_at DESC
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
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_MEMBERSHIPS_QUERY_FAILED',
          message: err instanceof Error ? err.message : 'unknown',
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
    // Re-verify the user is linked to this tenant — never trust the
    // client's tenantId blindly. This is a CROSS-tenant check: the target
    // tenantId is (by design) NOT the currently-bound one, so it runs under
    // service-role context so the person_links bypass policy can see the
    // target-tenant link. The membership predicate (supabase_user_id +
    // tenant_id) is the real authorization gate — service-role only lifts the
    // RLS row-visibility, it does not weaken the explicit WHERE.
    try {
      const rows = (await withServiceRoleContext(
        db as unknown as ServiceRoleDb,
        (sdb) =>
          sdb.execute(sql`
            SELECT 1
              FROM person_links
             WHERE supabase_user_id = ${auth.userId}::uuid
               AND tenant_id        = ${tenantId}::uuid
               AND unlinked_at IS NULL
             LIMIT 1
          `),
      )) as unknown as Array<{ '1'?: number }>;
      if (rows.length === 0) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_NOT_LINKED',
              message:
                'You are not a member of this tenant, or your link was unlinked.',
            },
          },
          403,
        );
      }
    } catch (err) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TENANT_SWITCH_CHECK_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        },
        500,
      );
    }

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

/** Exported for the auth middleware composition root. */
export const ACTIVE_TENANT_COOKIE_NAME = ACTIVE_TENANT_COOKIE;
