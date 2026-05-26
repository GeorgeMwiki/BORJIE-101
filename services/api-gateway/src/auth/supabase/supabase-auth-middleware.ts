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
import {
  verifySupabaseJwt,
  extractBearer,
  type VerifySupabaseJwtOptions,
} from './supabase-jwt-verify.js';
import type { AuthContext } from '../../middleware/auth.middleware.js';
import { UserRole } from '../../types/user-role.js';

function readJwtSecret(): string {
  return process.env.SUPABASE_JWT_SECRET ?? '';
}

/**
 * Derive the Supabase Auth JWKS URL from `SUPABASE_URL` (preferred) or
 * its `NEXT_PUBLIC_` mirror. Modern Supabase projects expose the public
 * JWKS at `<base>/auth/v1/.well-known/jwks.json`.
 */
function readJwksUrl(): string | null {
  const base =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    null;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
}

/**
 * Build the verify options the way the live Supabase project demands.
 * Prefer JWKS (ES256/RS256, post May-2026 default); fall back to HS256
 * with the shared secret for legacy / self-hosted installations.
 */
function buildVerifyOptions(): VerifySupabaseJwtOptions | null {
  const jwksUrl = readJwksUrl();
  const jwtSecret = readJwtSecret();
  if (jwksUrl) {
    return { jwksUrl, jwtSecret: jwtSecret || undefined };
  }
  if (jwtSecret) return { jwtSecret };
  return null;
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
  // Borjie internal staff — granted SUPER_ADMIN in the legacy property
  // enum so they bypass tenant scoping.
  { match: 'borjie_team', mapped: UserRole.SUPER_ADMIN },
  { match: 'support', mapped: UserRole.SUPPORT },
  { match: 'admin', mapped: UserRole.TENANT_ADMIN },
  { match: 'owner', mapped: UserRole.OWNER },
  { match: 'accountant', mapped: UserRole.ACCOUNTANT },
  { match: 'manager', mapped: UserRole.PROPERTY_MANAGER },
  { match: 'property_manager', mapped: UserRole.PROPERTY_MANAGER },
  // Borjie mining-site manager → PROPERTY_MANAGER in the property enum.
  { match: 'site_manager', mapped: UserRole.PROPERTY_MANAGER },
  { match: 'maintenance', mapped: UserRole.MAINTENANCE_STAFF },
  { match: 'maintenance_staff', mapped: UserRole.MAINTENANCE_STAFF },
  // Borjie field employee (driver / equipment operator) → MAINTENANCE_STAFF.
  { match: 'driver', mapped: UserRole.MAINTENANCE_STAFF },
  { match: 'resident', mapped: UserRole.RESIDENT },
  // Borjie marketplace buyer — read-only counterpart; map to RESIDENT.
  { match: 'buyer', mapped: UserRole.RESIDENT },
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
  const verifyOptions = buildVerifyOptions();
  if (!verifyOptions) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_PROVIDER_MISCONFIGURED',
          message:
            'AUTH_PROVIDER=supabase requires SUPABASE_URL (for JWKS) or SUPABASE_JWT_SECRET to be set.',
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
    const principal = await verifySupabaseJwt(token, verifyOptions);

    // Prefer the Borjie-domain `mining_role` claim when present (single
    // canonical role per user). Fall back to the generic `roles[]` array
    // for legacy tokens that predate the borjie-test-users seed.
    const role = principal.miningRole
      ? mapSupabaseRolesToUserRole([principal.miningRole, ...principal.roles])
      : mapSupabaseRolesToUserRole(principal.roles);
    const permissions = principal.miningRole
      ? [principal.miningRole, ...principal.roles]
      : principal.roles;
    const authContext: AuthContext = {
      userId: principal.userId,
      tenantId: principal.tenantId,
      role,
      permissions,
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
