/**
 * Hono-compatible auth middleware
 * Uses jose for JWT verification (same as Express auth)
 */

import { createMiddleware } from 'hono/factory';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '../types/user-role';

const JWT_SECRET = new TextEncoder().encode(
  (() => {
    const s = process.env.JWT_SECRET;
    if (!s && process.env.NODE_ENV === 'production') throw new Error('Missing required: JWT_SECRET');
    return s || '';
  })()
);

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  exp: number;
  iat: number;
}

export const honoAuthMiddleware = createMiddleware<{
  Variables: { auth: AuthContext };
  Bindings: Record<string, unknown>;
}>(async (c, next) => {
  const authHeader = c.req.header('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
      },
      401
    );
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const decoded = payload as unknown as JWTPayload;

    c.set('auth', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      permissions: decoded.permissions ?? [],
      propertyAccess: decoded.propertyAccess ?? [],
    });

    await next();
  } catch (error) {
    const message = error instanceof Error && error.name === 'JWTExpired'
      ? 'Authentication token has expired'
      : 'Invalid authentication token';
    const code = error instanceof Error && error.name === 'JWTExpired'
      ? 'TOKEN_EXPIRED'
      : 'INVALID_TOKEN';

    return c.json(
      {
        success: false,
        error: { code, message },
      },
      401
    );
  }
});

export const getAuth = (c: { get: (key: 'auth') => AuthContext }) => c.get('auth');
