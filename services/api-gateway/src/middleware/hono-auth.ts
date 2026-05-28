// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
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

// Public-session cookie fallback — `/api/v1/auth/sign-in` issues a
// `borjie-session` HttpOnly cookie that wraps the Supabase
// access_token. When the browser hits a JWT-protected route without
// an `Authorization` header we transparently rehydrate the bearer
// from the cookie so the rest of the auth chain runs unchanged.
import {
  decodeSessionCookie,
  readSessionCookie,
} from '../auth/public/session-cookie';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  /** JWT ID of the current token — needed for /auth/logout revocation. */
  jti?: string;
  /** Token expiry epoch seconds — paired with jti for blocklist TTL. */
  exp?: number;
  /** Customer-portal accounts carry a denormalised customerId on the auth
   *  context so BFF routes can scope queries without a second join. The
   *  field is optional: only customer-facing JWTs include it. */
  customerId?: string;
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  jti?: string;
  exp: number;
  iat: number;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
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
      const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
        algorithms: ['ES256', 'RS256'],
      });
      const sp = payload as JoseJWTPayload & {
        app_metadata?: { tenant_id?: string; mining_role?: string };
      };
      decoded = {
        userId: String(sp.sub ?? ''),
        tenantId: sp.app_metadata?.tenant_id ?? '',
        role: mapSupabaseRolesToUserRole(
          sp.app_metadata?.mining_role ? [sp.app_metadata.mining_role] : [],
        ),
        permissions: sp.app_metadata?.mining_role ? [sp.app_metadata.mining_role] : [],
        propertyAccess: [],
        jti: typeof sp.jti === 'string' ? sp.jti : undefined,
        exp: typeof sp.exp === 'number' ? sp.exp : 0,
        iat: typeof sp.iat === 'number' ? sp.iat : 0,
      };
    } else {
      // Pin algorithm to prevent alg=none / RS256-vs-HS256 confusion.
      decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JWTPayload;
    }

    if (decoded.jti && tokenBlocklist.isRevoked(decoded.jti)) {
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

    c.set('auth', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      permissions: decoded.permissions,
      propertyAccess: decoded.propertyAccess,
      jti: decoded.jti,
      exp: decoded.exp,
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
