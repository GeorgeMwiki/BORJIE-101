/**
 * JWT minting for integration tests.
 *
 * Signs a token with the same `JWT_SECRET` the gateway verifies against
 * (set in test-env.ts). The payload mirrors what /auth/login would
 * produce so the token looks identical to a production login token.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

export interface MintJwtInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly role?: string;
  readonly permissions?: readonly string[];
  readonly propertyAccess?: readonly string[];
  /** Override expiry, default 1 hour. */
  readonly expiresIn?: string | number;
}

export function mintJwt(input: MintJwtInput): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('mintJwt: JWT_SECRET not configured');
  }
  const payload = {
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role ?? 'TENANT_ADMIN',
    permissions: input.permissions ?? ['*'],
    propertyAccess: input.propertyAccess ?? ['*'],
  };
  return jwt.sign(payload, secret, {
    expiresIn: input.expiresIn ?? '1h',
    jwtid: randomUUID(),
    algorithm: 'HS256',
  });
}

/** Auth header builder so tests can `.set('Authorization', authHeader(token))`. */
export function authHeader(token: string): string {
  return `Bearer ${token}`;
}
