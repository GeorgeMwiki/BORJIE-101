/**
 * Hono-compatible auth middleware
 * Extracts JWT from Authorization header and provides tenant-scoped auth context
 */

import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { jwtVerify, createRemoteJWKSet, type JWTPayload as JoseJWTPayload } from 'jose';
import type { UserRole } from '../types/user-role';
import { getJwtSecret } from '../config/jwt';
import { tokenBlocklist } from './token-blocklist';
import { mapSupabaseRolesToUserRole } from '../auth/supabase/supabase-auth-middleware';

const JWT_SECRET = getJwtSecret();

// Borjie hard-fork: accept Supabase Auth ES256 tokens via JWKS. The .well-known/jwks.json
// endpoint is public — the project's JWKS contains an EC P-256 key per kid.
const SUPABASE_BASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_JWKS_URL = SUPABASE_BASE_URL
  ? `${SUPABASE_BASE_URL.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
  : '';
const SUPABASE_JWKS = SUPABASE_JWKS_URL
  ? createRemoteJWKSet(new URL(SUPABASE_JWKS_URL))
  : null;

// SEC-G2 — derive the canonical issuer once. A signature-valid Supabase JWT
// from a DIFFERENT project (or with `aud != authenticated`) must be rejected
// even though its EC key chains to a valid kid; binding `iss`/`aud` closes
// that cross-project acceptance hole. The issuer is `<SUPABASE_URL>/auth/v1`
// per the Supabase JWT spec. When SUPABASE_URL is unset the issuer is empty
// and the check is skipped (no behaviour change), but ES256 verification
// already cannot proceed without the JWKS URL anyway.
const SUPABASE_ISSUER = SUPABASE_BASE_URL
  ? `${SUPABASE_BASE_URL.replace(/\/+$/, '')}/auth/v1`
  : '';
const SUPABASE_AUDIENCE = 'authenticated';
// Flag (default ON when an issuer is derivable). Set BORJIE_JWT_ISS_AUD=off
// for incident rollback to the pre-G2 signature-only acceptance.
const ISS_AUD_ENFORCED =
  SUPABASE_ISSUER.length > 0 &&
  (process.env.BORJIE_JWT_ISS_AUD ?? 'on').toLowerCase() !== 'off';

// Public-session cookie fallback — `/api/v1/auth/sign-in` issues a
// `borjie-session` HttpOnly cookie that wraps the Supabase
// access_token. When the browser hits a JWT-protected route without
// an `Authorization` header we transparently rehydrate the bearer
// from the cookie so the rest of the auth chain runs unchanged.
import {
  decodeSessionCookie,
  readSessionCookie,
} from '../auth/public/session-cookie';
// SC-2 — validated multi-org active-tenant override (the single reader of
// the `borjie-active-tenant` cookie / `X-Borjie-Active-Tenant` header).
import {
  expiredActiveTenantCookie,
  resolveActiveTenantOverride,
} from './active-tenant-override';
import { getDatabaseClient } from './database';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  /** JWT ID of the current token — needed for /auth/logout revocation. */
  jti?: string | undefined;
  /** Token expiry epoch seconds — paired with jti for blocklist TTL. */
  exp?: number | undefined;
  /** Customer-portal accounts carry a denormalised customerId on the auth
   *  context so BFF routes can scope queries without a second join. The
   *  field is optional: only customer-facing JWTs include it. */
  customerId?: string | undefined;
  /** Email projected onto AuthContext in the cross-cutting `auth.middleware.ts`
   *  flavor; included here for shape compatibility with the shared
   *  `ContextVariableMap.auth` augmentation. */
  email?: string | undefined;
  /** Token expiry epoch seconds — duplicate of `exp` carried by the auth.middleware
   *  variant under the name `tokenExp`. */
  tokenExp?: number | undefined;
  tokenIat?: number | undefined;
  sessionId?: string | undefined;
  /** E.164-ish phone claim from the Supabase token (phone-OTP principals) —
   *  consumed by identity provisioning on the membership routes (SC-2). */
  phone?: string | undefined;
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  jti?: string | undefined;
  exp: number;
  iat: number;
  /** Supabase phone / email claims — identity provisioning inputs (SC-2). */
  phone?: string | undefined;
  email?: string | undefined;
}

/**
 * Validate + normalise a signature-verified legacy HS256 payload into the
 * app's `JWTPayload` shape. Throws when a required claim (`userId` /
 * `tenantId`) is missing or empty so the caller's catch surfaces a 401
 * `INVALID_TOKEN` rather than letting an under-specified token through.
 */
function coerceVerifiedJwtPayload(verified: unknown): JWTPayload {
  if (typeof verified !== 'object' || verified === null) {
    throw new Error('jwt payload is not an object');
  }
  const p = verified as Record<string, unknown>;
  const userId = typeof p.userId === 'string' ? p.userId : '';
  const tenantId = typeof p.tenantId === 'string' ? p.tenantId : '';
  const role = p.role as UserRole;
  // The PUBLIC role is the anonymous marketing visitor — intentionally
  // tenant-less (the marketing widget mints { role: 'PUBLIC', tenantId: null }).
  // Every OTHER role MUST carry a tenantId so the RLS GUC + authz checks are
  // never mis-scoped by a signature-valid token that would otherwise flow
  // downstream as tenantId: undefined. PUBLIC reaches only public routes,
  // which touch no tenant data, so a tenant-less PUBLIC token is safe.
  if (userId.length === 0) {
    throw new Error('jwt payload missing userId claim');
  }
  if (String(role) !== 'PUBLIC' && tenantId.length === 0) {
    throw new Error('jwt payload missing tenantId claim');
  }
  return {
    userId,
    tenantId,
    role,
    permissions: Array.isArray(p.permissions)
      ? (p.permissions as string[])
      : [],
    propertyAccess: Array.isArray(p.propertyAccess)
      ? (p.propertyAccess as string[])
      : [],
    jti: typeof p.jti === 'string' ? p.jti : undefined,
    exp: typeof p.exp === 'number' ? p.exp : 0,
    iat: typeof p.iat === 'number' ? p.iat : 0,
    phone:
      typeof p.phone === 'string' && p.phone.length > 0 ? p.phone : undefined,
    email:
      typeof p.email === 'string' && p.email.length > 0 ? p.email : undefined,
  };
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  // Resolve the bearer token: prefer the explicit Authorization header
  // (for service-to-service calls), fall back to the `borjie-session`
  // cookie issued by the public `/api/v1/auth/sign-in` flow. Browser
  // clients use the cookie path exclusively so they never need to
  // marshal the Authorization header themselves.
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else {
    const cookieValue = readSessionCookie(c.req.header('Cookie'));
    const decoded = cookieValue ? decodeSessionCookie(cookieValue) : null;
    if (decoded?.accessToken) {
      token = decoded.accessToken;
    }
  }

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

  try {
    // Borjie: detect Supabase ES256 tokens by header alg + iss, verify via JWKS.
    // Falls back to legacy HS256 (jsonwebtoken + JWT_SECRET) for service-to-service
    // tokens minted by Borjie itself.
    let decoded: JWTPayload;
    const headerB64 = token.split('.')[0];
    const headerAlg = headerB64
      ? JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')).alg
      : '';

    if (headerAlg === 'ES256' || headerAlg === 'RS256') {
      if (!SUPABASE_JWKS) {
        throw new Error('SUPABASE_URL not set — cannot verify ES256 tokens');
      }
      // SEC-G2: bind `iss` + `aud` so a signature-valid token minted for a
      // DIFFERENT Supabase project / audience cannot pass. jose throws
      // `JWTClaimValidationFailed` on mismatch → caught below → 401
      // INVALID_TOKEN (no new branch needed). Skipped only when the flag is
      // off or no issuer is derivable (pre-G2 behaviour).
      const { payload } = await jwtVerify(
        token,
        SUPABASE_JWKS,
        ISS_AUD_ENFORCED
          ? {
              algorithms: ['ES256', 'RS256'],
              issuer: SUPABASE_ISSUER,
              audience: SUPABASE_AUDIENCE,
            }
          : { algorithms: ['ES256', 'RS256'] },
      );
      const sp = payload as JoseJWTPayload & {
        app_metadata?: { tenant_id?: string; mining_role?: string };
        user_metadata?: { tenant_id?: string };
      };
      // SEC-G2: tenant_id is trusted ONLY from server-managed `app_metadata`.
      // `user_metadata` is user-writable, so a token carrying a tenant_id only
      // in `user_metadata` must be rejected — never silently flow downstream
      // as `tenantId: ''` (which would mis-scope the RLS GUC) nor be promoted
      // from the user-controlled field.
      const appTenantId = sp.app_metadata?.tenant_id;
      const userTenantId = sp.user_metadata?.tenant_id;
      if (
        (appTenantId === undefined || appTenantId.length === 0) &&
        typeof userTenantId === 'string' &&
        userTenantId.length > 0
      ) {
        throw new Error('tenant_id must come from app_metadata, not user_metadata');
      }
      const spClaims = sp as JoseJWTPayload & {
        phone?: string;
        email?: string;
      };
      // A signature-valid token with no `sub` must NOT flow downstream as an
      // empty userId — some reads (e.g. the buyer ReBAC inquiry read) key
      // authorization on userId, so an empty one is a privilege hole. Reject it
      // here exactly as the HS256 path does.
      if (!sp.sub || String(sp.sub).length === 0) {
        throw new Error('jwt payload missing sub claim');
      }
      decoded = {
        userId: String(sp.sub),
        tenantId: appTenantId ?? '',
        role: mapSupabaseRolesToUserRole(
          sp.app_metadata?.mining_role ? [sp.app_metadata.mining_role] : [],
        ),
        permissions: sp.app_metadata?.mining_role ? [sp.app_metadata.mining_role] : [],
        propertyAccess: [],
        jti: typeof sp.jti === 'string' ? sp.jti : undefined,
        exp: typeof sp.exp === 'number' ? sp.exp : 0,
        iat: typeof sp.iat === 'number' ? sp.iat : 0,
        phone:
          typeof spClaims.phone === 'string' && spClaims.phone.length > 0
            ? spClaims.phone
            : undefined,
        email:
          typeof spClaims.email === 'string' && spClaims.email.length > 0
            ? spClaims.email
            : undefined,
      };
    } else {
      // Pin algorithm to prevent alg=none / RS256-vs-HS256 confusion.
      const verified = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      });
      // Validate the claim shape at this trust boundary instead of an
      // unchecked `as JWTPayload`. A signature-valid token that lacks
      // `tenantId` / `userId` must be rejected (401) — never allowed to
      // flow downstream as `tenantId: undefined`, which would silently
      // mis-scope the RLS GUC + authz checks.
      decoded = coerceVerifiedJwtPayload(verified);
    }

    // SEC-G3: cross-replica revocation check. `isRevokedAsync` consults the
    // shared Redis store when wired (a logout on ANY replica revokes here),
    // falling back to the local Map otherwise. The middleware is already
    // async so this is a non-breaking await.
    if (decoded.jti && (await tokenBlocklist.isRevokedAsync(decoded.jti))) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Authentication token has been revoked',
          },
        },
        401
      );
    }

    // SC-2 — validated multi-org switch. The requested active tenant
    // (header for mobile Bearer clients, cookie for web) is honored ONLY
    // when the membership graph authorizes it: an ACTIVE employment-class
    // org_membership in the target tenant, resolved through the caller's
    // auth principal. On success BOTH tenantId and userId are rebound (the
    // shadow user is the caller's `users` row IN that tenant); on failure
    // the request fails CLOSED with 403 + a cookie clear (a silent fallback
    // to the home tenant would mis-scope writes — confused deputy). PUBLIC
    // (tenant-less marketing) tokens never carry a switch.
    if (String(decoded.role) !== 'PUBLIC' && decoded.userId.length > 0) {
      const resolution = await resolveActiveTenantOverride({
        c,
        db:
          (c.get('db') as Parameters<
            typeof resolveActiveTenantOverride
          >[0]['db']) ?? getDatabaseClient(),
        supabaseUserId: decoded.userId,
        jwtTenantId: decoded.tenantId,
      });
      if (resolution.kind === 'denied') {
        c.header('Set-Cookie', expiredActiveTenantCookie());
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_SWITCH_INVALID',
              message:
                'You are not an active member of the requested tenant. ' +
                'The active-tenant selection has been reset.',
            },
          },
          403
        );
      }
      if (resolution.kind === 'switched') {
        decoded = {
          ...decoded,
          tenantId: resolution.grant.tenantId,
          userId: resolution.grant.shadowUserId,
        };
      }
    }

    c.set('auth', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      permissions: decoded.permissions,
      propertyAccess: decoded.propertyAccess,
      jti: decoded.jti,
      exp: decoded.exp,
      phone: decoded.phone,
      email: decoded.email,
    });

    // Flat accessors — legacy routers look up `tenantId`/`userId`
    // directly via `c.get('tenantId')`. Populate these here (the
    // service-context middleware cannot because it runs BEFORE this
    // per-router middleware).
    c.set('tenantId', decoded.tenantId);
    c.set('userId', decoded.userId);

    await next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired',
          },
        },
        401
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid authentication token',
        },
      },
      401
    );
  }
});

/** Require at least one of the given roles (use after authMiddleware) */
export const requireRole = (...roles: UserRole[]) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401
      );
    }
    if (!roles.includes(auth.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        },
        403
      );
    }
    await next();
  });
};
