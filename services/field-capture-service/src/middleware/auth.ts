/**
 * Fastify JWT authentication preHandler for the field-capture-service.
 *
 * Production policy: NO body-supplied `tenantId`. Every authenticated
 * request must carry a Bearer access token. The tenant id, user id, and
 * role are derived from the verified token's claims — never from
 * headers, query parameters, or body. This closes the
 * write-to-wrong-tenant risk flagged in P40 follow-up.
 *
 * Token format expected (matches the platform-wide Supabase Auth flow
 * — see services/payments-ledger/src/middleware/auth.middleware.ts):
 *   - HS256 signed with `SUPABASE_JWT_SECRET`
 *   - `sub` = user id
 *   - `app_metadata.tenant_id` = tenant uuid (preferred over user_metadata)
 *   - `app_metadata.roles` = string[] (first element used as role)
 *
 * Wiring: `app.addHook('preHandler', verifyAuthHook)` from `index.ts`.
 * Skips `/healthz`, `/readyz`, `/metrics` so kube/observability probes
 * don't need a token.
 *
 * Test bypass: pass `BuildAppDeps.testAuthInjector` from `buildApp` to
 * stamp `request.user` directly without a JWT — production deployments
 * never construct the app with that dep.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import { jwtVerify, type JWTPayload } from 'jose';

export interface AuthUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Routes that bypass authentication (kube probes + metrics). */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/healthz',
  '/readyz',
  '/metrics',
]);

function isPublicPath(url: string): boolean {
  // Strip query string before lookup.
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

let cachedSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!raw || raw.length < 10) {
    throw new Error(
      'field-capture-service: SUPABASE_JWT_SECRET (or JWT_SECRET) is required for request authentication.',
    );
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

/** Reset the cached secret. Test-only — production never rotates in-process. */
export function resetSecretCacheForTests(): void {
  cachedSecret = null;
}

function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? '').trim() : null;
}

interface ClaimMetadata {
  readonly tenantId?: string;
  readonly role?: string;
}

function readMetadata(payload: JWTPayload): ClaimMetadata {
  const app = (payload as Record<string, unknown>).app_metadata as
    | Record<string, unknown>
    | undefined;
  const user = (payload as Record<string, unknown>).user_metadata as
    | Record<string, unknown>
    | undefined;
  const merged: Record<string, unknown> = { ...(user ?? {}), ...(app ?? {}) };

  const tenantId =
    typeof merged.tenant_id === 'string' && merged.tenant_id.length > 0
      ? merged.tenant_id
      : typeof (payload as Record<string, unknown>).tenantId === 'string'
        ? ((payload as Record<string, unknown>).tenantId as string)
        : undefined;

  let role: string | undefined;
  if (Array.isArray(merged.roles) && merged.roles.length > 0) {
    const first = merged.roles[0];
    if (typeof first === 'string') role = first;
  } else if (typeof merged.role === 'string') {
    role = merged.role;
  } else if (typeof (payload as Record<string, unknown>).role === 'string') {
    role = (payload as Record<string, unknown>).role as string;
  }

  const result: ClaimMetadata = {
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(role !== undefined ? { role } : {}),
  };
  return result;
}

/**
 * Test-only injector: stamps `request.user` from a function the test
 * supplies. Production constructs `buildApp({})` (no injector) and so
 * the JWT path is always exercised.
 */
export type TestAuthInjector = (
  request: FastifyRequest,
) => AuthUser | undefined;

export interface RegisterAuthOptions {
  /** Test-only — when set, bypasses JWT verification entirely. */
  readonly testAuthInjector?: TestAuthInjector;
}

/**
 * Register the Fastify `preHandler` hook that gates every non-public
 * route on a valid JWT and stamps `request.user`.
 */
export function registerAuthHook(
  app: FastifyInstance,
  options: RegisterAuthOptions = {},
): void {
  app.addHook(
    'preHandler',
    (
      request: FastifyRequest,
      reply: FastifyReply,
      done: HookHandlerDoneFunction,
    ): void => {
      if (isPublicPath(request.url)) {
        done();
        return;
      }

      // Test-only fast path — never enabled in production builds.
      if (options.testAuthInjector) {
        const injected = options.testAuthInjector(request);
        if (injected) {
          request.user = injected;
          done();
          return;
        }
        reply.code(401);
        void reply.send({
          error: { code: 'AUTH_MISSING_TOKEN', message: 'Bearer token required' },
        });
        return;
      }

      const token = extractBearer(request.headers.authorization);
      if (!token) {
        reply.code(401);
        void reply.send({
          error: { code: 'AUTH_MISSING_TOKEN', message: 'Bearer token required' },
        });
        return;
      }

      // Verify asynchronously — wrap in IIFE so the `done` callback shape
      // is preserved for Fastify v4's hook signature.
      void (async () => {
        try {
          const { payload } = await jwtVerify(token, getSecret(), {
            algorithms: ['HS256'],
          });
          const sub = typeof payload.sub === 'string' ? payload.sub : '';
          if (!sub) {
            reply.code(401);
            void reply.send({
              error: {
                code: 'AUTH_INVALID_TOKEN',
                message: 'missing subject',
              },
            });
            return;
          }
          const md = readMetadata(payload);
          if (!md.tenantId) {
            reply.code(403);
            void reply.send({
              error: {
                code: 'AUTH_NO_TENANT',
                message: 'token has no tenant_id',
              },
            });
            return;
          }
          request.user = {
            userId: sub,
            tenantId: md.tenantId,
            role: md.role ?? 'user',
          };
          done();
        } catch (err) {
          reply.code(401);
          void reply.send({
            error: {
              code: 'AUTH_INVALID_TOKEN',
              message:
                err instanceof Error ? err.message : 'token verification failed',
            },
          });
        }
      })();
    },
  );
}

/**
 * Pull the verified `AuthUser` off the request, throwing if the auth
 * hook hasn't run (programming error — only happens if a new route is
 * added but the hook is removed).
 */
export function requireUser(request: FastifyRequest): AuthUser {
  const user = request.user;
  if (!user) {
    throw new Error(
      'requireUser called without registerAuthHook in the preHandler chain',
    );
  }
  return user;
}
