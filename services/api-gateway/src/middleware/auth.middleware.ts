// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * JWT Authentication Middleware - BORJIE
 *
 * Enhanced JWT validation with:
 * - Tenant extraction from token and headers
 * - Token refresh detection
 * - Session validation
 * - Multi-tenant context setup
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import jwt from 'jsonwebtoken';
import { UserRole } from '../types/user-role';
import { resolveApiKeyLegacyOrRegistry } from './api-key-registry';
import { tokenBlocklist } from './token-blocklist';
import {
  verifySupabaseJwt,
  SupabaseAuthError,
} from '@borjie/ai-copilot';

// ============================================================================
// Configuration
// ============================================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || '';
}

// JWT secrets are read LAZILY (not at module load) so vitest test suites that
// mutate `process.env.*` between imports observe the right value at verify
// time. Production composition roots set these at boot, so the lazy read is
// effectively memoized after first call.
function getJwtAccessSecret(): string {
  return (
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || requireEnv('JWT_SECRET')
  );
}
function getJwtRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET || requireEnv('JWT_REFRESH_SECRET');
}
/**
 * JWT issuer/audience. P84 audit BUG-HI-4: silent fallback `'borjie'`/
 * `'borjie-api'` is dangerous in production — if the deployer forgets
 * to set the env var, tokens issued in one environment will validate in
 * another that shares the JWT secret (cross-env token leakage risk).
 *
 * - In production: fail-fast via `requireEnv` if unset.
 * - In dev/test: fall through to the legacy hardcoded value so existing
 *   workflows keep booting; the hardcoded value is documented and stable
 *   so test fixtures can sign tokens against it.
 */
function getJwtIssuer(): string {
  const v = process.env.JWT_ISSUER;
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV === 'production') return requireEnv('JWT_ISSUER');
  return 'borjie';
}
function getJwtAudience(): string {
  const v = process.env.JWT_AUDIENCE;
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV === 'production') return requireEnv('JWT_AUDIENCE');
  return 'borjie-api';
}

/**
 * Supabase JWT secret — read lazily so dev/test environments without the
 * variable still boot. When unset and a Supabase-issued token arrives, the
 * Supabase path returns INVALID_TOKEN rather than crashing the gateway.
 *
 * MAY-2026 NOTE: modern Supabase projects rotated to ES256 (asymmetric)
 * and no longer expose an HS256 secret. The verifier now prefers the
 * JWKS path when `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` is set; the
 * HS256 secret is only used as a fallback for legacy/self-hosted projects.
 */
function getSupabaseJwtSecret(): string | null {
  return process.env.SUPABASE_JWT_SECRET || null;
}

/**
 * Derive the Supabase Auth JWKS URL from `SUPABASE_URL` (or its
 * `NEXT_PUBLIC_` mirror). Returns `null` when no URL is configured.
 */
function getSupabaseJwksUrl(): string | null {
  const base =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    null;
  if (!base) return null;
  // Tolerate trailing slash — `new URL` would carry it through.
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/auth/v1/.well-known/jwks.json`;
}

// ============================================================================
// Audit logging — structured JSON for SOC visibility (per audit F1)
// ============================================================================

type AuthPath = 'supabase' | 'gateway';

/**
 * Emit a structured audit-log line for a resolved principal. The
 * `auth_path` field is the trust domain that authorized the request so
 * SOC dashboards can split Supabase-origin traffic from gateway-origin
 * traffic when investigating incidents. Failures (non-authorized) are
 * logged at warn level with `outcome: 'reject'`.
 */
function auditAuthResolution(args: {
  outcome: 'allow' | 'reject';
  authPath: AuthPath;
  userId?: string;
  tenantId?: string;
  reason?: string;
}): void {
  const line = JSON.stringify({
    event: 'auth_principal_resolved',
    auth_path: args.authPath,
    outcome: args.outcome,
    user_id: args.userId,
    tenant_id: args.tenantId,
    reason: args.reason,
    ts: new Date().toISOString(),
  });
  // eslint-disable-next-line no-console
  if (args.outcome === 'allow') console.info(line);
  // eslint-disable-next-line no-console
  else console.warn(line);
}

// ============================================================================
// Types
// ============================================================================

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  email?: string;
  sessionId?: string;
  tokenExp?: number;
  tokenIat?: number;
}

export interface JWTPayload {
  sub?: string;
  userId?: string;
  tenantId: string;
  role: UserRole;
  email?: string;
  permissions: string[];
  propertyAccess: string[];
  sessionId?: string;
  exp: number;
  iat: number;
  iss?: string;
  aud?: string | string[];
}

export interface TokenValidationResult {
  valid: boolean;
  expired: boolean;
  payload?: JWTPayload;
  error?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId?: string;
  exp: number;
  iat: number;
}

// ============================================================================
// Token Validation Utilities
// ============================================================================

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

// ============================================================================
// Dual-Path Token Detection (Supabase vs Gateway)
// ============================================================================

/**
 * Peek at a JWT's claims WITHOUT verifying its signature. Used only to
 * route to the right verifier — never to trust the values. The chosen
 * verifier still has to confirm the signature with its own secret.
 *
 * Returns `null` if the token cannot be decoded at all (malformed input).
 */
export function peekJwtClaims(
  token: string
): {
  iss?: string;
  hasAppMetadata: boolean;
} | null {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') return null;
    const obj = decoded as Record<string, unknown>;
    return {
      iss: typeof obj.iss === 'string' ? obj.iss : undefined,
      hasAppMetadata:
        typeof obj.app_metadata === 'object' && obj.app_metadata !== null,
    };
  } catch {
    return null;
  }
}

/**
 * Heuristic: does this token look like a Supabase-issued access token?
 *
 * - Supabase issues `iss` claims containing `supabase.co`, `supabase.in`,
 *   or the literal string `supabase` (self-hosted) — the GoTrue server
 *   sets `iss` to its own URL.
 * - Customer-app / estate-manager-app pass Supabase tokens that carry
 *   `app_metadata` (server-managed tenant assignment); the gateway-issued
 *   JWTs do not use that shape.
 *
 * We accept EITHER signal so we route correctly even when Supabase
 * truncates the `iss` or a self-hosted Supabase has a non-supabase.co
 * hostname.
 */
export function looksLikeSupabaseToken(
  claims: { iss?: string; hasAppMetadata: boolean } | null
): boolean {
  if (!claims) return false;
  const iss = claims.iss?.toLowerCase() ?? '';
  if (iss.includes('supabase')) return true;
  // Self-hosted Supabase often sets iss to its own GoTrue URL. Fall back
  // to the shape check so we don't misroute to the gateway verifier and
  // produce a misleading "JsonWebTokenError: invalid signature".
  if (claims.hasAppMetadata && !iss.includes(getJwtIssuer())) return true;
  return false;
}

/**
 * Map a Supabase `roles: string[]` claim onto the gateway's single
 * `UserRole` enum. The first matching role wins; an unknown role
 * defaults to RESIDENT (the customer-app default) because customer-app
 * is the primary Supabase-token issuer.
 */
function mapSupabaseRoleToUserRole(roles: string[]): UserRole {
  const upper = roles.map((r) => r.toUpperCase());
  for (const role of upper) {
    if (role in UserRole) {
      return UserRole[role as keyof typeof UserRole];
    }
  }
  return UserRole.RESIDENT;
}

/**
 * Verify a Supabase-issued token and project it onto the gateway's
 * AuthContext. Returns `{ valid: false, error }` on any failure so the
 * caller can convert it to a 401 response identical to the gateway path.
 *
 * Audit F6 hardening: even though the underlying `verifySupabaseJwt`
 * accepts a tenant_id from `user_metadata` when `app_metadata` is
 * missing, we REJECT that case at the gateway boundary. `user_metadata`
 * is client-modifiable in Supabase; only `app_metadata` is server-
 * managed and trustworthy for tenant assignment.
 */
async function verifyAndProjectSupabaseToken(token: string): Promise<{
  valid: boolean;
  error?: string;
  context?: AuthContext;
}> {
  const secret = getSupabaseJwtSecret();
  const jwksUrl = getSupabaseJwksUrl();
  if (!secret && !jwksUrl) {
    return { valid: false, error: 'Supabase auth not configured' };
  }
  try {
    // Prefer JWKS/ES256 when SUPABASE_URL is available (modern projects).
    // Fall back to HS256 only when no JWKS URL is configured — legacy /
    // self-hosted Supabase installations.
    const principal = await verifySupabaseJwt(
      token,
      jwksUrl
        ? { jwksUrl, jwtSecret: secret ?? undefined }
        : { jwtSecret: secret! }
    );

    // F6 protection: re-check the raw JWT to ensure tenant_id came from
    // `app_metadata`, NOT `user_metadata`. The ai-copilot helper merges
    // them with app_metadata winning, but does not REJECT a token that
    // only has user_metadata.tenant_id — we do that here.
    const raw = principal.raw as Record<string, unknown>;
    const appMd =
      typeof raw.app_metadata === 'object' && raw.app_metadata !== null
        ? (raw.app_metadata as Record<string, unknown>)
        : {};
    const appTenant =
      typeof appMd.tenant_id === 'string' ? appMd.tenant_id : null;
    if (!appTenant) {
      return {
        valid: false,
        error:
          'tenant_id must be in app_metadata (server-managed); user_metadata is not trusted',
      };
    }
    if (appTenant !== principal.tenantId) {
      // Defensive: the projected tenantId disagrees with app_metadata.
      // Refuse rather than fall through with the lower-trust value.
      return {
        valid: false,
        error: 'tenant_id mismatch between app_metadata and projected principal',
      };
    }

    const context: AuthContext = {
      userId: principal.userId,
      tenantId: appTenant,
      role: mapSupabaseRoleToUserRole(principal.roles),
      permissions: principal.roles,
      propertyAccess: [],
      email: principal.email,
      sessionId: undefined,
      tokenExp:
        typeof raw.exp === 'number' ? (raw.exp as number) : undefined,
      tokenIat:
        typeof raw.iat === 'number' ? (raw.iat as number) : undefined,
    };
    return { valid: true, context };
  } catch (err) {
    if (err instanceof SupabaseAuthError) {
      return { valid: false, error: err.message };
    }
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Supabase token validation failed',
    };
  }
}

/**
 * Validate JWT access token.
 *
 * HIGH-11 (audit .audit/post-pr90-api-mcp-bug-sweep.md): the two
 * gateway auth middlewares had divergent security properties.
 * `hono-auth.ts` pinned algorithm HS256 and consulted the token
 * blocklist; this file did neither. Routes mounting THIS flavor were
 * vulnerable to (a) algorithm-confusion / alg=none attacks and
 * (b) revoked-token reuse. The blocklist is the only thing that makes
 * `/auth/logout` actually invalidate a token. Both checks added here.
 */
export function validateAccessToken(token: string): TokenValidationResult {
  try {
    const payload = jwt.verify(token, getJwtAccessSecret(), {
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
      // HIGH-11: pin algorithm to prevent alg=none / RS256-vs-HS256.
      algorithms: ['HS256'],
    }) as JWTPayload & { jti?: string };

    // HIGH-11: reject tokens that have been explicitly revoked
    // (e.g. via /auth/logout). The blocklist is keyed by jti.
    if (payload.jti && tokenBlocklist.isRevoked(payload.jti)) {
      return {
        valid: false,
        expired: false,
        error: 'Token has been revoked',
      };
    }

    return {
      valid: true,
      expired: false,
      payload,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Decode without verification to get payload for refresh
      const decoded = jwt.decode(token) as JWTPayload | null;
      return {
        valid: false,
        expired: true,
        payload: decoded || undefined,
        error: 'Token has expired',
      };
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return {
        valid: false,
        expired: false,
        error: error.message,
      };
    }

    return {
      valid: false,
      expired: false,
      error: 'Token validation failed',
    };
  }
}

/**
 * Validate JWT refresh token
 */
export function validateRefreshToken(token: string): TokenValidationResult {
  try {
    const payload = jwt.verify(token, getJwtRefreshSecret(), {
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
    }) as RefreshTokenPayload;

    return {
      valid: true,
      expired: false,
      payload: payload as unknown as JWTPayload,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return {
        valid: false,
        expired: true,
        error: 'Refresh token has expired',
      };
    }

    return {
      valid: false,
      expired: false,
      error: error instanceof Error ? error.message : 'Token validation failed',
    };
  }
}

/**
 * Generate new access token
 */
export function generateAccessToken(payload: Omit<JWTPayload, 'exp' | 'iat' | 'iss' | 'aud'>): string {
  return jwt.sign(
    {
      userId: payload.userId || payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      permissions: payload.permissions,
      propertyAccess: payload.propertyAccess,
      sessionId: payload.sessionId,
    },
    getJwtAccessSecret(),
    {
      expiresIn: '15m',
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
      subject: payload.sub || payload.userId,
    }
  );
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(userId: string, sessionId?: string): string {
  return jwt.sign(
    { sessionId },
    getJwtRefreshSecret(),
    {
      expiresIn: '7d',
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
      subject: userId,
    }
  );
}

/**
 * Generate token pair
 */
export function generateTokenPair(
  payload: Omit<JWTPayload, 'exp' | 'iat' | 'iss' | 'aud'>
): { accessToken: string; refreshToken: string; expiresIn: number } {
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload.sub || payload.userId || '', payload.sessionId);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
  };
}

/**
 * Extract tenant ID from request.
 * FIXED H-1: JWT `tenantId` claim is the ONLY accepted source. The
 * X-Tenant-ID header and ?tenantId= query parameter are no longer honored
 * because they were attacker-controlled cross-tenant vectors. Service-to-
 * service calls should use the API-key registry (see api-key-registry.ts).
 */
function extractTenantId(_c: Context, payload?: JWTPayload): string | null {
  if (payload?.tenantId) return payload.tenantId;
  return null;
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Main authentication middleware
 * Validates JWT and extracts auth context.
 *
 * AUDIT F1: dual-path verification.
 *  - Supabase-issued tokens (customer-app, estate-manager-app) are
 *    verified against `SUPABASE_JWT_SECRET` with F6 protection
 *    (tenant_id MUST come from app_metadata, not user_metadata).
 *  - Gateway-issued tokens are verified against `JWT_ACCESS_SECRET`
 *    with algorithm pinned to HS256 and blocklist enforcement.
 * After either path, downstream middleware sees the SAME AuthContext —
 * trust-domain attribution is preserved in the audit log.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid authorization header',
        },
      },
      401
    );
  }

  // Peek at claims to choose the verifier. The peek itself does not
  // grant any trust — both verifiers do their own signature checks.
  const claims = peekJwtClaims(token);
  if (!claims) {
    auditAuthResolution({
      outcome: 'reject',
      authPath: 'gateway',
      reason: 'malformed_token',
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Malformed authentication token',
        },
      },
      401
    );
  }

  const authPath: AuthPath = looksLikeSupabaseToken(claims)
    ? 'supabase'
    : 'gateway';

  if (authPath === 'supabase') {
    const result = await verifyAndProjectSupabaseToken(token);
    if (!result.valid || !result.context) {
      auditAuthResolution({
        outcome: 'reject',
        authPath: 'supabase',
        reason: result.error,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: result.error || 'Invalid Supabase token',
          },
        },
        401
      );
    }
    auditAuthResolution({
      outcome: 'allow',
      authPath: 'supabase',
      userId: result.context.userId,
      tenantId: result.context.tenantId,
    });
    c.set('auth', result.context);
    await next();
    return;
  }

  // Gateway path (existing behavior, unchanged).
  const validation = validateAccessToken(token);

  if (!validation.valid) {
    if (validation.expired) {
      auditAuthResolution({
        outcome: 'reject',
        authPath: 'gateway',
        reason: 'token_expired',
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired',
            refreshRequired: true,
          },
        },
        401
      );
    }

    auditAuthResolution({
      outcome: 'reject',
      authPath: 'gateway',
      reason: validation.error,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: validation.error || 'Invalid authentication token',
        },
      },
      401
    );
  }

  const payload = validation.payload!;
  const tenantId = extractTenantId(c, payload);

  if (!tenantId) {
    auditAuthResolution({
      outcome: 'reject',
      authPath: 'gateway',
      reason: 'missing_tenant',
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_TENANT',
          message: 'Tenant context is required',
        },
      },
      400
    );
  }

  // Set auth context
  const authContext: AuthContext = {
    userId: payload.sub || payload.userId || '',
    tenantId,
    role: payload.role,
    permissions: payload.permissions || [],
    propertyAccess: payload.propertyAccess || [],
    email: payload.email,
    sessionId: payload.sessionId,
    tokenExp: payload.exp,
    tokenIat: payload.iat,
  };

  auditAuthResolution({
    outcome: 'allow',
    authPath: 'gateway',
    userId: authContext.userId,
    tenantId: authContext.tenantId,
  });

  c.set('auth', authContext);

  await next();
});

/**
 * Optional authentication middleware
 * Sets auth context if token is present, but doesn't require it
 */
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = extractBearerToken(authHeader);

  if (token) {
    const validation = validateAccessToken(token);

    if (validation.valid && validation.payload) {
      const payload = validation.payload;
      const tenantId = extractTenantId(c, payload);

      if (tenantId) {
        const authContext: AuthContext = {
          userId: payload.sub || payload.userId || '',
          tenantId,
          role: payload.role,
          permissions: payload.permissions || [],
          propertyAccess: payload.propertyAccess || [],
          email: payload.email,
          sessionId: payload.sessionId,
          tokenExp: payload.exp,
          tokenIat: payload.iat,
        };

        c.set('auth', authContext);
      }
    }
  }

  await next();
});

/**
 * Require fresh token (recently issued)
 * Use for sensitive operations
 */
export const requireFreshToken = (maxAgeSeconds: number = 300) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;

    if (!auth) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401
      );
    }

    if (!auth.tokenIat) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FRESH_TOKEN_REQUIRED',
            message: 'A fresh authentication token is required for this operation',
          },
        },
        401
      );
    }

    const tokenAge = Math.floor(Date.now() / 1000) - auth.tokenIat;
    if (tokenAge > maxAgeSeconds) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FRESH_TOKEN_REQUIRED',
            message: `Token must be less than ${maxAgeSeconds} seconds old for this operation`,
            reauthRequired: true,
          },
        },
        401
      );
    }

    await next();
  });
};

/**
 * API Key authentication middleware
 * For service-to-service communication
 */
export const apiKeyAuthMiddleware = createMiddleware(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key is required',
        },
      },
      401
    );
  }

  // FIXED C-1: resolve API key to a registry record with bound tenantId/role/scopes.
  // Legacy API_KEYS env var still supported via shim with deprecation warning.
  // X-Tenant-ID header is NEVER honored for API-key auth.
  const record = resolveApiKeyLegacyOrRegistry(apiKey);
  if (!record) {
    return c.json(
      { success: false, error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } },
      401,
    );
  }
  c.set('auth', {
    userId: `service:${record.serviceName}`,
    tenantId: record.tenantId,
    role: record.role,
    permissions: record.scopes,
    propertyAccess: record.scopes.includes('*') ? ['*'] : [],
  } as AuthContext);

  await next();
});

/**
 * Combined auth middleware that accepts both JWT and API key
 */
export const flexibleAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const apiKey = c.req.header('X-API-Key');

  if (apiKey) {
    // FIXED C-1: use registry, never header-supplied tenant
    const record = resolveApiKeyLegacyOrRegistry(apiKey);
    if (record) {
      c.set('auth', {
        userId: `service:${record.serviceName}`,
        tenantId: record.tenantId,
        role: record.role,
        permissions: record.scopes,
        propertyAccess: record.scopes.includes('*') ? ['*'] : [],
      } as AuthContext);

      await next();
      return;
    }
  }

  if (authHeader) {
    const token = extractBearerToken(authHeader);

    if (token) {
      const validation = validateAccessToken(token);

      if (validation.valid && validation.payload) {
        const payload = validation.payload;
        const tenantId = extractTenantId(c, payload);

        if (tenantId) {
          c.set('auth', {
            userId: payload.sub || payload.userId || '',
            tenantId,
            role: payload.role,
            permissions: payload.permissions || [],
            propertyAccess: payload.propertyAccess || [],
            email: payload.email,
            sessionId: payload.sessionId,
            tokenExp: payload.exp,
            tokenIat: payload.iat,
          } as AuthContext);

          await next();
          return;
        }
      }
    }
  }

  return c.json(
    {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Valid authentication is required',
      },
    },
    401
  );
});

// ============================================================================
// Hono Context Type Extension
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export type { UserRole };
// @ts-nocheck
