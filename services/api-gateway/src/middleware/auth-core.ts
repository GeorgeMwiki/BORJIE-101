/**
 * Shared JWT verification — SCAFFOLDED 10
 *
 * Both the Express (`auth.ts`) and Hono (`hono-auth.ts`) middlewares
 * previously duplicated JWT verification logic. Any drift between the two
 * was a correctness+security risk — e.g. if only one pinned the algorithm,
 * an attacker could route around the stricter handler.
 *
 * This module centralizes the verification decision so both adapters share
 * one source of truth. Behavior (algorithm pinning, revocation check,
 * typed error mapping) is unchanged from the current Express impl.
 */

import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';
import { tokenBlocklist } from './token-blocklist';
import type { UserRole } from '../types/user-role';

export interface VerifiedJwtPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  jti?: string;
  exp: number;
  iat: number;
}

export type VerifyJwtResult =
  | { ok: true; payload: VerifiedJwtPayload }
  | {
      ok: false;
      code: 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' | 'INVALID_TOKEN';
      message: string;
    };

export function verifyJwt(token: string | undefined): VerifyJwtResult {
  if (!token || typeof token !== 'string' || token.length === 0) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' };
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as VerifiedJwtPayload;

    if (payload.jti && tokenBlocklist.isRevoked(payload.jti)) {
      return {
        ok: false,
        code: 'TOKEN_REVOKED',
        message: 'Authentication token has been revoked',
      };
    }

    return { ok: true, payload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, code: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
    }
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid authentication token' };
  }
}

/**
 * Helper: extract the bearer token from an `Authorization` header.
 * Returns undefined when header is missing or malformed; the caller then
 * passes undefined to `verifyJwt` which produces the UNAUTHORIZED error.
 */
export function extractBearerToken(authHeader: string | undefined | null): string | undefined {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}
