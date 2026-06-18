/**
 * Supabase JWT verification middleware for the payments-ledger service.
 *
 * Production policy: NO `x-tenant-id` header trust. Every authenticated
 * request must carry a Bearer access token issued by Supabase Auth. The
 * tenant id is derived from the verified token's `app_metadata.tenant_id`
 * claim — never from headers, query parameters, or body.
 *
 * Wired in `server.ts` via `app.use(verifySupabaseAuthMiddleware)` for all
 * protected routes; webhook callbacks have their own signature verification.
 */

import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, type JWTPayload } from 'jose';

export interface VerifiedPrincipal {
  userId: string;
  email?: string;
  tenantId: string;
  roles: string[];
  raw: JWTPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: VerifiedPrincipal;
    }
  }
}

let cachedSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw || raw.length < 10) {
    throw new Error(
      'payments-ledger: SUPABASE_JWT_SECRET is required for request authentication.'
    );
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function readMetadata(payload: JWTPayload): {
  tenantId?: string;
  roles?: string[];
  tenantConflict: boolean;
} {
  const app = (payload as Record<string, unknown>).app_metadata as
    | Record<string, unknown>
    | undefined;
  const user = (payload as Record<string, unknown>).user_metadata as
    | Record<string, unknown>
    | undefined;
  // Authoritative tenant/roles come from app_metadata ONLY. user_metadata is
  // client-writable (supabase.auth.updateUser({ data })), so a fall-through to
  // it would let a user self-grant a tenant or role. Mirrors the canonical
  // gateway (hono-auth / supabase-jwt-verify) which rejects, never trusts,
  // user_metadata for authorization.
  const appTenant =
    typeof app?.tenant_id === 'string' ? (app.tenant_id as string) : undefined;
  const userTenant =
    typeof user?.tenant_id === 'string'
      ? (user.tenant_id as string)
      : undefined;
  return {
    tenantId: appTenant,
    roles: Array.isArray(app?.roles) ? (app.roles as string[]) : undefined,
    // A client-supplied tenant that disagrees with (or appears without) the
    // trusted app_metadata tenant is a privilege-escalation attempt.
    tenantConflict: userTenant !== undefined && userTenant !== appTenant,
  };
}

export async function verifySupabaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        error: { code: 'AUTH_MISSING_TOKEN', message: 'Bearer token required' },
      });
      return;
    }
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
    });
    const sub = String(payload.sub ?? '');
    if (!sub) {
      res.status(401).json({
        error: { code: 'AUTH_INVALID_TOKEN', message: 'missing subject' },
      });
      return;
    }
    const md = readMetadata(payload);
    if (md.tenantConflict) {
      res.status(403).json({
        error: {
          code: 'AUTH_TENANT_CONFLICT',
          message: 'client tenant claim disagrees with the trusted tenant',
        },
      });
      return;
    }
    if (!md.tenantId) {
      res.status(403).json({
        error: { code: 'AUTH_NO_TENANT', message: 'token has no tenant_id' },
      });
      return;
    }
    req.principal = {
      userId: sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      tenantId: md.tenantId,
      roles: md.roles ?? [],
      raw: payload,
    };
    next();
  } catch (err) {
    res.status(401).json({
      error: {
        code: 'AUTH_INVALID_TOKEN',
        message: err instanceof Error ? err.message : 'token verification failed',
      },
    });
  }
}

/**
 * Convenience accessor for route handlers — pulls the verified tenant id
 * out of the request principal. Throws if used before the middleware.
 */
export function requireTenantId(req: Request): string {
  const tid = req.principal?.tenantId;
  if (!tid) {
    throw new Error(
      'requireTenantId called without verifySupabaseAuthMiddleware in the chain'
    );
  }
  return tid;
}
