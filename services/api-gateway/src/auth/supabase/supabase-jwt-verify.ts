/**
 * Standalone Supabase JWT verification.
 *
 * Mirrors `packages/ai-copilot/src/config/supabase-auth.ts` but is
 * inlined here so the api-gateway has a single source of truth for
 * the auth path without a cross-package dependency on ai-copilot's
 * private exports. Keep the two in sync — if behaviour diverges,
 * promote this file to a shared package.
 *
 * Two signing-key modes:
 *  1. HS256 + shared secret — legacy / self-hosted Supabase. Pass
 *     `{ jwtSecret }`.
 *  2. ES256/RS256 via JWKS — modern Supabase projects (May 2026+).
 *     Pass `{ jwksUrl }`.
 *
 * When both are provided, `jwksUrl` wins.
 */

import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';

export interface SupabaseAuthPrincipal {
  readonly userId: string;
  readonly email?: string | undefined;
  readonly tenantId: string;
  readonly tenantName?: string | undefined;
  readonly environment: 'production' | 'staging' | 'development';
  readonly roles: string[];
  /**
   * Borjie-domain role pulled from `app_metadata.mining_role`. Distinct
   * from the generic `roles[]` array — Borjie's RBAC keys off a single
   * canonical mining role per user (owner, site_manager, driver, etc.).
   */
  readonly miningRole?: string | undefined;
  readonly teamIds: string[];
  readonly employeeId?: string | undefined;
  readonly raw: JWTPayload;
}

export class SupabaseAuthError extends Error {
  readonly kind = 'SupabaseAuthError' as const;
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = 'SupabaseAuthError';
    this.status = status;
  }
}

const MetadataSchema = z
  .object({
    tenant_id: z.string().optional(),
    tenant_name: z.string().optional(),
    roles: z.array(z.string()).optional(),
    mining_role: z.string().optional(),
    team_ids: z.array(z.string()).optional(),
    employee_id: z.string().optional(),
    environment: z
      .enum(['production', 'staging', 'development'])
      .optional(),
  })
  .partial();

export interface VerifySupabaseJwtOptions {
  /** HS256 secret. Optional when `jwksUrl` is set. */
  readonly jwtSecret?: string;
  /**
   * Full URL to the Supabase Auth JWKS endpoint, e.g.
   * `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.
   * When set, asymmetric verification (ES256/RS256) is used.
   */
  readonly jwksUrl?: string | URL;
  readonly jwksAlgorithms?: ReadonlyArray<'ES256' | 'RS256' | 'EdDSA'>;
  readonly defaultEnvironment?: 'production' | 'staging' | 'development';
}

// Module-level cache so we don't refetch the JWKS on every verify call.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwksKey(url: string | URL): JWTVerifyGetKey {
  const key = typeof url === 'string' ? url : url.toString();
  let getter = jwksCache.get(key);
  if (!getter) {
    getter = createRemoteJWKSet(new URL(key));
    jwksCache.set(key, getter);
  }
  return getter;
}

/**
 * Test-only: evict cached JWKS getters so each test can mint fresh keys.
 */
export function _resetJwksCacheForTests(): void {
  jwksCache.clear();
}

/**
 * Test-only: inject a JWKS getter for a URL, bypassing the network.
 */
export function _seedJwksForTests(
  url: string | URL,
  getter: JWTVerifyGetKey,
): void {
  const key = typeof url === 'string' ? url : url.toString();
  jwksCache.set(key, getter);
}

export async function verifySupabaseJwt(
  token: string,
  opts: VerifySupabaseJwtOptions,
): Promise<SupabaseAuthPrincipal> {
  if (!token || typeof token !== 'string') {
    throw new SupabaseAuthError('missing_token', 401);
  }
  if (!opts.jwksUrl && !opts.jwtSecret) {
    throw new SupabaseAuthError('invalid_token', 401);
  }

  let payload: JWTPayload;
  try {
    if (opts.jwksUrl) {
      const algorithms = [...(opts.jwksAlgorithms ?? ['ES256', 'RS256'])];
      const getKey: JWTVerifyGetKey = getJwksKey(opts.jwksUrl);
      const verified = await jwtVerify(token, getKey, { algorithms });
      payload = verified.payload;
    } else {
      const secret = new TextEncoder().encode(opts.jwtSecret!);
      const verified = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      });
      payload = verified.payload;
    }
  } catch (err) {
    throw new SupabaseAuthError(
      `invalid_token: ${err instanceof Error ? err.message : String(err)}`,
      401,
    );
  }

  const userId = String(payload.sub ?? '');
  if (!userId) throw new SupabaseAuthError('missing_subject', 401);

  // F6: tenant_id MUST be from app_metadata (server-managed). user_metadata
  // is client-mutable and not trustworthy for tenant assignment.
  const appMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).app_metadata ?? {},
  );
  const userMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).user_metadata ?? {},
  );
  const app = appMd.success ? appMd.data : {};
  const user = userMd.success ? userMd.data : {};

  const tenantId = app.tenant_id;
  if (!tenantId) {
    throw new SupabaseAuthError(
      'missing_tenant: app_metadata.tenant_id is required (user_metadata.tenant_id is not trusted)',
      403,
    );
  }

  // Defense-in-depth: reject self-promotion attempts.
  if (
    typeof user.tenant_id === 'string' &&
    user.tenant_id.length > 0 &&
    user.tenant_id !== tenantId
  ) {
    throw new SupabaseAuthError(
      'tenant_mismatch: user_metadata.tenant_id disagrees with app_metadata.tenant_id (self-promotion blocked)',
      403,
    );
  }

  return {
    userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    tenantId,
    tenantName: app.tenant_name ?? user.tenant_name,
    environment:
      app.environment ?? user.environment ?? opts.defaultEnvironment ?? 'production',
    // Roles prefer app_metadata (server-set). mining_role is Borjie-specific
    // and lives in app_metadata only (see seed: borjie-test-users.seed.ts).
    roles: app.roles ?? user.roles ?? [],
    miningRole: app.mining_role,
    teamIds: app.team_ids ?? user.team_ids ?? [],
    employeeId: app.employee_id ?? user.employee_id,
    raw: payload,
  };
}

export function extractBearer(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}
