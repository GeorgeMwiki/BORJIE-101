/**
 * Supabase Auth middleware — alternative to `auth.middleware.ts`.
 *
 * Activated when `AUTH_PROVIDER=supabase`. Verifies the bearer token
 * using `SUPABASE_JWT_SECRET` (HS256) and projects the principal onto
 * the existing `AuthContext` shape so downstream middleware (tenant,
 * RLS, repos, etc.) continue to work unchanged.
 *
 * The legacy JWT middleware in `middleware/auth.middleware.ts` remains
 * the default until ops flip `AUTH_PROVIDER`. Both paths share the
 * same `AuthContext` contract so route handlers don't have to know
 * which provider issued the token.
 */

import { createMiddleware } from 'hono/factory';
import { verifySupabaseJwt, extractBearer } from './supabase-jwt-verify.js';
import type { AuthContext } from '../../middleware/auth.middleware.js';
import { UserRole } from '../../types/user-role.js';

function readJwtSecret(): string {
  return process.env.SUPABASE_JWT_SECRET ?? '';
}

/**
 * Map a Supabase role-string array to our `UserRole` enum. The
 * `app_metadata.roles[]` is the canonical source; if multiple roles
 * are present, the highest-privilege one wins.
 *
 * Order matters — earlier entries beat later ones.
 */
const ROLE_PRIORITY: ReadonlyArray<{ match: string; mapped: UserRole }> = [
  { match: 'super_admin', mapped: UserRole.SUPER_ADMIN },
  { match: 'support', mapped: UserRole.SUPPORT },
  { match: 'admin', mapped: UserRole.TENANT_ADMIN },
  { match: 'owner', mapped: UserRole.OWNER },
  { match: 'accountant', mapped: UserRole.ACCOUNTANT },
  { match: 'manager', mapped: UserRole.PROPERTY_MANAGER },
  { match: 'property_manager', mapped: UserRole.PROPERTY_MANAGER },
  { match: 'maintenance', mapped: UserRole.MAINTENANCE_STAFF },
  { match: 'maintenance_staff', mapped: UserRole.MAINTENANCE_STAFF },
  { match: 'resident', mapped: UserRole.RESIDENT },
];

export function mapSupabaseRolesToUserRole(roles: readonly string[]): UserRole {
  const lower = roles.map((r) => r.toLowerCase());
  for (const { match, mapped } of ROLE_PRIORITY) {
    if (lower.includes(match)) return mapped;
  }
  // Default: tenant admin if unrecognized — never silently grant SUPER_ADMIN.
  return UserRole.TENANT_ADMIN;
}

/**
 * Supabase Auth middleware.
 *
 * Behaviour:
 *   - Missing Bearer → 401 UNAUTHORIZED.
 *   - Invalid token → 401 INVALID_TOKEN.
 *   - Token without tenant claim → 403 MISSING_TENANT.
 *   - Valid → c.set('auth', AuthContext) and call next().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAuthMiddleware = createMiddleware<any>(async (c, next) => {
  const jwtSecret = readJwtSecret();
  if (!jwtSecret) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_PROVIDER_MISCONFIGURED',
          message:
            'AUTH_PROVIDER=supabase requires SUPABASE_JWT_SECRET to be set.',
        },
      },
      500,
    );
  }

  const token = extractBearer(c.req.header('Authorization'));
  if (!token) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        },
      },
      401,
    );
  }

  try {
    const principal = await verifySupabaseJwt(token, {
      jwtSecret,
    });

    const role = mapSupabaseRolesToUserRole(principal.roles);
    const authContext: AuthContext = {
      userId: principal.userId,
      tenantId: principal.tenantId,
      role,
      permissions: principal.roles,
      propertyAccess: [],
      email: principal.email,
      sessionId: undefined,
      tokenExp: typeof principal.raw.exp === 'number' ? principal.raw.exp : undefined,
      tokenIat: typeof principal.raw.iat === 'number' ? principal.raw.iat : undefined,
    };
    c.set('auth', authContext);
    await next();
    return;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'token verification failed';
    // SupabaseAuthError carries an explicit status — pass it through.
    const status =
      typeof (err as { status?: number }).status === 'number'
        ? (err as { status: 401 | 403 }).status
        : 401;
    return c.json(
      {
        success: false,
        error: {
          code: status === 403 ? 'FORBIDDEN' : 'INVALID_TOKEN',
          message,
        },
      },
      status,
    );
  }
});

/**
 * Boot-time switch. Returns the middleware whose env-flag matches the
 * current `AUTH_PROVIDER` value. Defaults to legacy.
 *
 * ```ts
 * app.use('*', selectAuthMiddleware());
 * ```
 */
export function selectAuthMiddleware(): typeof supabaseAuthMiddleware {
  const provider = (process.env.AUTH_PROVIDER ?? 'legacy').toLowerCase();
  if (provider === 'supabase') return supabaseAuthMiddleware;
  // Lazy import to avoid double-loading the legacy module when not needed.
  // The legacy middleware is still the default — callers that wire this
  // directly should fall back to the legacy import path explicitly.
  throw new Error(
    `selectAuthMiddleware(): AUTH_PROVIDER='${provider}' — use 'supabase' or import the legacy authMiddleware directly.`,
  );
}
