/**
 * Supabase JWT verification for Brain routes.
 *
 * Verifies access tokens issued by Supabase Auth and projects them onto
 * Brain's `AITenantContext` + `AIActor` + `VisibilityViewer` shape.
 *
 * Two signing-key modes are supported:
 *
 *  1. **HS256 + shared secret** — legacy/self-hosted Supabase projects
 *     that still use `SUPABASE_JWT_SECRET` (symmetric HS256). Pass
 *     `{ jwtSecret }` to `VerifyOptions`.
 *
 *  2. **ES256/RS256 via JWKS** — modern Supabase projects (May 2026+
 *     default) that rotated to asymmetric signing. The public JWKS is
 *     served at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` and the
 *     legacy HS256 secret is no longer issued. Pass `{ jwksUrl }` to
 *     `VerifyOptions`.
 *
 *     The BORJIE primary Supabase project is on ES256 — its
 *     `/config/auth/signing-keys` reports HS256 as `previously_used`
 *     and ES256 as `in_use`. Any project with `previously_used` HS256
 *     MUST use the JWKS path; the HS256 secret cannot verify newly-
 *     issued user tokens.
 *
 *  When both `jwtSecret` and `jwksUrl` are provided, `jwksUrl` wins —
 *  this lets callers configure a graceful migration without changing
 *  call sites.
 *
 * No fakes. Missing or invalid token → throws `SupabaseAuthError`.
 *
 * Token claims convention:
 *   sub                       → user id
 *   email                     → optional
 *   app_metadata.tenant_id    → REQUIRED — server-set, immutable to client
 *   app_metadata.roles        → string[] (server-set; preferred over user_metadata.roles)
 *   user_metadata.tenant_name → optional display label
 *   user_metadata.team_ids    → string[]
 *   user_metadata.employee_id → string
 *
 * SECURITY (F6, BORJIE101 Supabase audit):
 * `tenant_id` MUST come from `app_metadata` ONLY. `user_metadata` is
 * client-mutable — a malicious user could self-promote into another tenant
 * by editing their own Supabase profile. If `user_metadata.tenant_id` is
 * present and disagrees with `app_metadata.tenant_id`, the token is rejected
 * with a security-level error.
 */

import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { logger } from '../logger.js';

export interface BrainAuthPrincipal {
  /** Raw JWT subject. */
  userId: string;
  email?: string;
  tenantId: string;
  tenantName?: string;
  environment: 'production' | 'staging' | 'development';
  roles: string[];
  teamIds: string[];
  employeeId?: string;
  /** Original JWT payload — kept for audit/forensics. */
  raw: JWTPayload;
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
    team_ids: z.array(z.string()).optional(),
    employee_id: z.string().optional(),
    environment: z
      .enum(['production', 'staging', 'development'])
      .optional(),
  })
  .partial();

export interface VerifyOptions {
  /**
   * HS256 secret. From `SUPABASE_JWT_SECRET`. Optional when `jwksUrl` is
   * supplied — modern Supabase projects (May 2026+) sign user tokens with
   * ES256 via the JWKS endpoint and do not expose an HS256 secret.
   */
  jwtSecret?: string;
  /**
   * Full URL to the Supabase Auth JWKS endpoint, e.g.
   * `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.
   * When provided, the verifier uses asymmetric (ES256/RS256) verification
   * via `createRemoteJWKSet` and ignores `jwtSecret`.
   */
  jwksUrl?: string | URL;
  /**
   * Algorithms accepted when JWKS verification is active. Defaults to the
   * two algorithms Supabase currently emits (ES256 today, RS256 historical).
   * Ignored on the HS256 path — that path is always pinned to HS256.
   */
  jwksAlgorithms?: ReadonlyArray<'ES256' | 'RS256' | 'EdDSA'>;
  /** Default environment if claim is absent. */
  defaultEnvironment?: 'production' | 'staging' | 'development';
}

// Module-level cache so we don't refetch the JWKS on every verify call.
// `createRemoteJWKSet` already caches internally, but we also memoize the
// JWKSet *function* itself per URL so a hot path avoids the allocation.
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
 * Test-only helper to evict cached JWKS getters. The remote-set helper
 * holds a long-lived cache by URL; tests that mint tokens with a fresh
 * keypair per case need to clear it so each run starts cold.
 */
export function _resetJwksCacheForTests(): void {
  jwksCache.clear();
}

/**
 * Test-only helper to inject a JWKS getter for a specific URL — bypasses
 * the network entirely. Used by the vitest suite to verify the ES256 path
 * without spinning up an HTTPS server. The injected entry is keyed by
 * exact URL string so production calls (different URL) are unaffected.
 */
export function _seedJwksForTests(
  url: string | URL,
  getter: JWTVerifyGetKey
): void {
  const key = typeof url === 'string' ? url : url.toString();
  jwksCache.set(key, getter);
}

/**
 * Re-export of jose's createLocalJWKSet so tests can build a static
 * `JWTVerifyGetKey` from an in-memory JWKS object. Not part of the
 * public production API — kept as a `_test_` prefix to make that clear.
 */
export async function _createLocalJwksForTests(
  jwks: JSONWebKeySet
): Promise<JWTVerifyGetKey> {
  const { createLocalJWKSet } = await import('jose');
  return createLocalJWKSet(jwks) as unknown as JWTVerifyGetKey;
}

/**
 * Verify and project a Supabase access token. Throws SupabaseAuthError on
 * any signature, expiry, or claim-shape failure.
 *
 * SECURITY: `tenant_id` is resolved EXCLUSIVELY from `app_metadata`
 * (server-set, immutable to client). If `user_metadata.tenant_id` is
 * present and differs from `app_metadata.tenant_id`, this is treated as an
 * attempted self-promotion and rejected with a SECURITY-level error.
 */
export async function verifySupabaseJwt(
  token: string,
  opts: VerifyOptions
): Promise<BrainAuthPrincipal> {
  if (!token || typeof token !== 'string') {
    throw new SupabaseAuthError('missing_token', 401);
  }
  if (!opts.jwksUrl && !opts.jwtSecret) {
    // Configuration error — surface as 401 because the caller cannot know
    // (and shouldn't trust) why it's mis-configured. Server logs carry detail.
    logger.error('supabase-auth.verifySupabaseJwt: misconfigured', {
      reason: 'neither jwtSecret nor jwksUrl provided',
    });
    throw new SupabaseAuthError('invalid_token', 401);
  }
  let payload: JWTPayload;
  try {
    if (opts.jwksUrl) {
      // Asymmetric path — modern Supabase ES256 (rotated default).
      // Copy `algorithms` so the readonly default doesn't clash with the
      // mutable string[] that jose's options interface demands.
      const algorithms = [...(opts.jwksAlgorithms ?? ['ES256', 'RS256'])];
      const getKey: JWTVerifyGetKey = getJwksKey(opts.jwksUrl);
      const verified = await jwtVerify(token, getKey, { algorithms });
      payload = verified.payload;
    } else {
      // Symmetric path — legacy/self-hosted HS256.
      const secret = new TextEncoder().encode(opts.jwtSecret!);
      const verified = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
      });
      payload = verified.payload;
    }
  } catch (err) {
    // F9 (BORJIE101 Supabase audit): jose surfaces granular failure
    // reasons (`signature verification failed`, `"exp" claim timestamp
    // check failed`, `unsupported "alg" header value`, etc.). Returning
    // those verbatim creates an oracle for attackers — they can probe to
    // learn whether the secret rotated, the token expired, or the alg
    // is mismatched. In production we collapse to a single opaque code
    // and emit the full detail to the server logger so an operator can
    // still triage from logs. Dev/test keep the verbose path so test
    // assertions can introspect the failure reason without booting a
    // logger.
    const isProduction = process.env.NODE_ENV === 'production';
    const detail = err instanceof Error ? err.message : String(err);
    if (isProduction) {
      logger.error('supabase-auth.verifySupabaseJwt: token rejected', {
        reason: detail,
        name: err instanceof Error ? err.name : 'unknown',
      });
      throw new SupabaseAuthError('invalid_token', 401);
    }
    throw new SupabaseAuthError(`invalid_token: ${detail}`, 401);
  }

  const userId = String(payload.sub ?? '');
  if (!userId) throw new SupabaseAuthError('missing_subject', 401);

  // Supabase puts metadata in `app_metadata` (server-managed, immutable to
  // client) and `user_metadata` (client-modifiable).
  //
  // SECURITY (F6): tenant_id MUST come from app_metadata ONLY. Merging the
  // two maps would allow a malicious user to self-promote into another
  // tenant by editing their own Supabase profile when app_metadata is empty
  // (e.g., trigger failed to populate it).
  const appMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).app_metadata ?? {}
  );
  const userMd = MetadataSchema.safeParse(
    (payload as Record<string, unknown>).user_metadata ?? {}
  );
  const appMetadata = appMd.success ? appMd.data : {};
  const userMetadata = userMd.success ? userMd.data : {};

  // (1) tenant_id is server-side only.
  const tenantId = appMetadata.tenant_id;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new SupabaseAuthError(
      'missing_tenant: app_metadata.tenant_id is required (user_metadata.tenant_id is no longer accepted)',
      403
    );
  }

  // (2) Defense in depth: detect self-promotion attempts.
  // If user_metadata.tenant_id is present AND disagrees with the
  // server-set app_metadata.tenant_id, this is a strong signal that the
  // user tried to move themselves to another tenant via the client-mutable
  // metadata map.
  const userTenantId = userMetadata.tenant_id;
  if (
    typeof userTenantId === 'string' &&
    userTenantId.length > 0 &&
    userTenantId !== tenantId
  ) {
    // SECURITY-level alert. Use console.error so it surfaces in any
    // structured-log pipeline (Sentry, Datadog, CloudWatch, etc.).
    // We intentionally include both values so a security responder can
    // identify the attempted target tenant.
    logger.error('[SECURITY] supabase-auth: tenant_id self-promotion attempt blocked', {
      severity: 'SECURITY',
      event: 'tenant_id_self_promotion_attempt',
      userId,
      appTenantId: tenantId,
      userMetadataTenantId: userTenantId,
    });
    throw new SupabaseAuthError(
      'tenant_mismatch: user_metadata.tenant_id disagrees with app_metadata.tenant_id (self-promotion blocked)',
      403
    );
  }

  // (3) Other fields: roles prefer app_metadata (server-set) over
  // user_metadata. Non-security fields (tenant_name, team_ids,
  // employee_id, environment) may fall through to user_metadata.
  const roles = appMetadata.roles ?? userMetadata.roles ?? [];
  const tenantName = appMetadata.tenant_name ?? userMetadata.tenant_name;
  const teamIds = appMetadata.team_ids ?? userMetadata.team_ids ?? [];
  const employeeId = appMetadata.employee_id ?? userMetadata.employee_id;
  const environment =
    appMetadata.environment ??
    userMetadata.environment ??
    opts.defaultEnvironment ??
    'production';

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  return {
    userId,
    ...(email !== undefined ? { email } : {}),
    tenantId,
    ...(tenantName !== undefined ? { tenantName } : {}),
    environment,
    roles,
    teamIds,
    ...(employeeId !== undefined ? { employeeId } : {}),
    raw: payload,
  };
}

/**
 * Extract the bearer token from an Authorization header.
 */
export function extractBearer(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m && m[1] !== undefined ? m[1].trim() : null;
}

/**
 * Project a verified principal into the Brain's `AITenantContext` /
 * `AIActor` / `VisibilityViewer` triple.
 *
 * The principal's `tenantId` is already guaranteed by `verifySupabaseJwt`
 * to come from `app_metadata.tenant_id` (server-set, immutable to client);
 * never from `user_metadata.tenant_id`. See F6 security note in this file.
 */
export function principalToBrainContexts(p: BrainAuthPrincipal): {
  tenant: {
    tenantId: string;
    tenantName: string;
    environment: 'production' | 'staging' | 'development';
  };
  actor: {
    type: 'user';
    id: string;
    email?: string;
    roles: string[];
  };
  viewer: {
    userId: string;
    roles: string[];
    teamIds: string[];
    employeeId?: string;
    isAdmin: boolean;
    isManagement: boolean;
  };
} {
  const isAdmin = p.roles.includes('admin');
  const isManagement =
    isAdmin ||
    p.roles.includes('manager') ||
    p.roles.includes('team_leader');
  return {
    tenant: {
      tenantId: p.tenantId,
      tenantName: p.tenantName ?? p.tenantId,
      environment: p.environment,
    },
    actor: {
      type: 'user' as const,
      id: p.userId,
      ...(p.email !== undefined ? { email: p.email } : {}),
      roles: p.roles,
    },
    viewer: {
      userId: p.userId,
      roles: p.roles,
      teamIds: p.teamIds,
      ...(p.employeeId !== undefined ? { employeeId: p.employeeId } : {}),
      isAdmin,
      isManagement,
    },
  };
}

// ---------------------------------------------------------------------------
// Visibility scope authorization
// ---------------------------------------------------------------------------

export type VisibilityRequest = 'private' | 'team' | 'management' | 'public';

/**
 * Decide whether a principal is authorized to publish at a requested
 * visibility scope. Used by Brain routes to clamp client-supplied
 * `defaultVisibility` so an employee cannot promote a coworker thread to
 * `management` without permission.
 *
 * Rules:
 *  - Admin: anything.
 *  - Manager / team_leader: private | team | management.
 *  - Employee (no special role): private | team only.
 *  - Anyone explicitly requesting `public` requires admin or a tenant-level
 *    "publish_public" role — `public` is the broadcast tier and rarely
 *    appropriate for a single-thread message.
 */
export function maxPermittedVisibility(
  p: Pick<BrainAuthPrincipal, 'roles'>
): VisibilityRequest {
  if (p.roles.includes('admin') || p.roles.includes('publish_public'))
    return 'public';
  if (p.roles.includes('manager') || p.roles.includes('team_leader'))
    return 'management';
  return 'team';
}

const SCOPE_ORDER: Record<VisibilityRequest, number> = {
  private: 0,
  team: 1,
  management: 2,
  public: 3,
};

export function clampVisibility(
  requested: VisibilityRequest | undefined,
  p: Pick<BrainAuthPrincipal, 'roles'>
): VisibilityRequest {
  const cap = maxPermittedVisibility(p);
  if (!requested) return 'private';
  return SCOPE_ORDER[requested] <= SCOPE_ORDER[cap] ? requested : cap;
}
