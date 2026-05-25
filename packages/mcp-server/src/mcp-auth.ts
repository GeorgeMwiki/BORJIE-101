/**
 * MCP Auth — tenant-scoped authentication.
 *
 * Supports two schemes:
 *   - `X-Api-Key: bnk_...` — looks up a registered MCP API key and
 *     resolves it to a tenant / tier / scope set.
 *   - `Authorization: Bearer <jwt>` — verifies a JWT signed with a
 *     shared HS256 secret and reads tenantId + tier + scopes from
 *     its claims.
 *
 * The module never talks to a database directly — a caller supplies an
 * `ApiKeyRegistry` port so this package is testable in isolation and
 * can plug into whatever user-directory the gateway provides.
 *
 * Tenant isolation: the returned `McpAuthContext` carries `tenantId`.
 * EVERY downstream tool handler MUST scope queries to that tenant.
 */

import type {
  AuthPort,
  AuthRequestLike,
  AuthFailure,
  McpAuthContext,
  McpScope,
  McpTier,
} from './types.js';

// ============================================================================
// API-Key Registry Port
// ============================================================================

export interface ApiKeyRecord {
  readonly keyPrefix: string;
  readonly keyHash: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly tier: McpTier;
  readonly scopes: ReadonlyArray<McpScope>;
  readonly status: 'active' | 'revoked' | 'suspended';
  readonly expiresAt?: number;
}

export interface ApiKeyRegistry {
  lookupByHash(hash: string): Promise<ApiKeyRecord | null>;
}

// ============================================================================
// JWT Verifier Port (minimal — no dep on `jsonwebtoken`)
// ============================================================================

export interface JwtClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly tier: McpTier;
  readonly scopes: ReadonlyArray<McpScope>;
  readonly iat: number;
  readonly exp: number;
}

export interface JwtVerifier {
  verify(token: string): Promise<JwtClaims | null>;
}

// ============================================================================
// SHA-256 hashing (uses Web Crypto — available in Node 20+)
// ============================================================================

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateApiKey(): string {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return `bnk_mcp_${a}${b}`;
}

// ============================================================================
// Shared helpers
// ============================================================================

function failure(
  status: number,
  errorCode: string,
  error: string,
): AuthFailure {
  return Object.freeze({ ok: false, status, errorCode, error });
}

function getHeader(
  headers: AuthRequestLike['headers'],
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()] ?? headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function getCorrelationId(headers: AuthRequestLike['headers']): string {
  return (
    getHeader(headers, 'x-request-id') ??
    getHeader(headers, 'x-correlation-id') ??
    crypto.randomUUID()
  );
}

// ============================================================================
// Factory
// ============================================================================

export interface McpAuthDeps {
  readonly apiKeys?: ApiKeyRegistry;
  readonly jwt?: JwtVerifier;
  readonly now?: () => number;
}

export function createMcpAuth(deps: McpAuthDeps): AuthPort {
  const now = deps.now ?? (() => Date.now());

  return {
    async authenticate(request) {
      const correlationId = getCorrelationId(request.headers);

      const apiKey = getHeader(request.headers, 'x-api-key');
      const bearer = getHeader(request.headers, 'authorization');

      if (!apiKey && !bearer) {
        return failure(
          401,
          'AUTH_REQUIRED',
          'Provide X-Api-Key or Authorization: Bearer <jwt>.',
        );
      }

      if (apiKey) {
        if (!deps.apiKeys) {
          return failure(
            500,
            'AUTH_NOT_CONFIGURED',
            'API-key authentication is not configured on this server.',
          );
        }
        const keyHash = await hashApiKey(apiKey);
        const record = await deps.apiKeys.lookupByHash(keyHash);
        if (!record) {
          return failure(401, 'AUTH_INVALID_KEY', 'Invalid API key.');
        }
        if (record.status === 'revoked') {
          return failure(
            401,
            'AUTH_REVOKED',
            'API key has been revoked.',
          );
        }
        if (record.status === 'suspended') {
          return failure(
            401,
            'AUTH_SUSPENDED',
            'API key is suspended. Contact support.',
          );
        }
        if (record.expiresAt && record.expiresAt < now()) {
          return failure(401, 'AUTH_EXPIRED', 'API key has expired.');
        }
        const base = {
          tenantId: record.tenantId,
          principalId: record.principalId,
          principalType: 'api-key' as const,
          tier: record.tier,
          scopes: Object.freeze([...record.scopes]),
          issuedAt: now(),
          correlationId,
        };
        const ctx: McpAuthContext =
          record.expiresAt !== undefined
            ? Object.freeze({ ...base, expiresAt: record.expiresAt })
            : Object.freeze(base);
        return ctx;
      }

      // Bearer token
      if (!deps.jwt) {
        return failure(
          500,
          'AUTH_NOT_CONFIGURED',
          'JWT authentication is not configured on this server.',
        );
      }
      const token = bearer!.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        return failure(401, 'AUTH_INVALID_TOKEN', 'Missing bearer token.');
      }
      const claims = await deps.jwt.verify(token);
      if (!claims) {
        return failure(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired JWT.');
      }
      if (claims.exp * 1000 < now()) {
        return failure(401, 'AUTH_EXPIRED', 'JWT has expired.');
      }
      const jwtCtx: McpAuthContext = Object.freeze({
        tenantId: claims.tenantId,
        principalId: claims.sub,
        principalType: 'jwt' as const,
        tier: claims.tier,
        scopes: Object.freeze([...claims.scopes]),
        issuedAt: claims.iat * 1000,
        expiresAt: claims.exp * 1000,
        correlationId,
      });
      return jwtCtx;
    },
  };
}

// ============================================================================
// Scope guard — call before invoking a tool handler.
// ============================================================================

export function assertScopes(
  context: McpAuthContext,
  required: ReadonlyArray<McpScope>,
): void {
  const missing = required.filter((s) => !context.scopes.includes(s));
  if (missing.length > 0) {
    throw new McpAuthError(
      403,
      'AUTH_SCOPE_DENIED',
      `Missing required scopes: ${missing.join(', ')}`,
    );
  }
}

export class McpAuthError extends Error {
  readonly status: number;
  readonly errorCode: string;
  constructor(status: number, errorCode: string, message: string) {
    super(message);
    this.name = 'McpAuthError';
    this.status = status;
    this.errorCode = errorCode;
  }
}
