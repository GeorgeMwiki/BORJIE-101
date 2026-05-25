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
} {
  const app = (payload as Record<string, unknown>).app_metadata as
    | Record<string, unknown>
    | undefined;
  const user = (payload as Record<string, unknown>).user_metadata as
    | Record<string, unknown>
    | undefined;
  const merged = { ...(user ?? {}), ...(app ?? {}) };
  return {
    tenantId:
      typeof merged.tenant_id === 'string' ? merged.tenant_id : undefined,
    roles: Array.isArray(merged.roles)
      ? (merged.roles as string[])
      : undefined,
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
