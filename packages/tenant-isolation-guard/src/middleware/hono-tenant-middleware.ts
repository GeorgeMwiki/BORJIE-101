/**
 * Hono v4 middleware that binds the per-request TenantContext.
 *
 * Extracts the tenant claim from the JWT (Supabase shape — claim
 * lives at `app_metadata.tenant_id`). Rejects requests that
 * either omit the claim or carry a malformed one.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { runInTenantContext } from '../context/tenant-context.js';
import {
  asTenantId,
  IsolationViolation,
  type TenantContext,
  type TenantId,
} from '../types.js';

/**
 * Minimal subset of the Hono context surface we need. Defined
 * locally so the guard package does not import Hono (keeps the
 * package's dependency surface tiny + testable).
 */
export interface HonoLike {
  readonly req: {
    header(name: string): string | undefined;
    /** Request-id middleware sets this earlier in the chain. */
    readonly raw: { headers: { get(name: string): string | null } } | unknown;
  };
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  json(body: unknown, status: number): Response;
}

export type HonoNext = () => Promise<void>;

/**
 * Shape of the decoded Supabase JWT we depend on. Only the
 * `app_metadata.tenant_id` field is mandatory; everything else
 * is best-effort.
 */
export interface DecodedJwt {
  readonly sub?: string;
  readonly app_metadata?: {
    readonly tenant_id?: unknown;
    readonly actor_tenant_id?: unknown;
  };
  readonly aud?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export interface HonoTenantMiddlewareOptions {
  /**
   * Resolver that returns the verified JWT for the current
   * request. The caller is responsible for signature validation
   * (Supabase JWKS / HS256). The guard only checks claim shape.
   */
  readonly resolveJwt: (c: HonoLike) => Promise<DecodedJwt | null>;
  /**
   * Resolver that returns a request id. Defaults to the
   * `x-request-id` header.
   */
  readonly resolveRequestId?: (c: HonoLike) => string;
  /**
   * If false, no context is bound and the request is allowed
   * through (used for public health endpoints).
   */
  readonly require?: boolean;
}

function defaultRequestId(c: HonoLike): string {
  const h = c.req.header('x-request-id');
  if (typeof h === 'string' && h.length > 0) return h;
  // crypto.randomUUID is in node 19+ and works at the edge.
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns a Hono middleware function. Reject 401 if a tenant
 * claim is missing or malformed; otherwise binds a TenantContext
 * for the entire request lifetime.
 */
export function honoTenantMiddleware(
  opts: HonoTenantMiddlewareOptions,
): (c: HonoLike, next: HonoNext) => Promise<Response | void> {
  return async (c: HonoLike, next: HonoNext): Promise<Response | void> => {
    const jwt = await opts.resolveJwt(c);
    if (!jwt) {
      if (opts.require === false) {
        return next();
      }
      return c.json(
        {
          error: 'unauthorized',
          reason: 'missing_jwt',
        },
        401,
      );
    }

    const rawTenant = jwt.app_metadata?.tenant_id;
    if (typeof rawTenant !== 'string') {
      return c.json(
        {
          error: 'unauthorized',
          reason: 'tenant_claim_missing_or_malformed',
        },
        401,
      );
    }

    const tenantId = asTenantId(rawTenant);
    if (!tenantId) {
      return c.json(
        {
          error: 'unauthorized',
          reason: 'tenant_claim_failed_validation',
        },
        401,
      );
    }

    const actorRaw = jwt.app_metadata?.actor_tenant_id;
    const actorTenantId: TenantId =
      typeof actorRaw === 'string' && asTenantId(actorRaw) !== null
        ? (asTenantId(actorRaw) as TenantId)
        : tenantId;

    const requestId = (opts.resolveRequestId ?? defaultRequestId)(c);

    const ctx: TenantContext = {
      tenantId,
      actorTenantId,
      requestId,
    };
    c.set('tenantContext', ctx);

    return runInTenantContext(ctx, async () => {
      await next();
    }) as Promise<void>;
  };
}

/**
 * Diagnostic helper — surface why a request was rejected. Used
 * in tests + the leak signal sink.
 */
export function describeRejection(c: HonoLike): string | null {
  const jwt = c.get('decodedJwt') as DecodedJwt | undefined;
  if (!jwt) return 'jwt_not_resolved';
  if (!jwt.app_metadata) return 'app_metadata_missing';
  if (typeof jwt.app_metadata.tenant_id !== 'string')
    return 'tenant_claim_not_string';
  if (!asTenantId(jwt.app_metadata.tenant_id))
    return 'tenant_claim_failed_validation';
  return null;
}

/** Re-export so callers can catch IsolationViolation typed. */
export { IsolationViolation };
