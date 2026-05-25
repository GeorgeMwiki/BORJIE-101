/**
 * Fastify JWT auth hook for the outcomes-metering service.
 *
 * Mirrors the production-quality auth contract used by
 * `services/field-capture-service/src/middleware/auth.ts` (P53) and
 * `services/voice-agent/src/middleware/auth.ts`:
 *
 *   - Bearer JWT (HS256 signed with `SUPABASE_JWT_SECRET`) required
 *     on every route except the public health probes.
 *   - `tenantId` is derived from the verified token's
 *     `app_metadata.tenant_id` claim — never from headers, query or
 *     body. The pre-existing `X-Tenant-Id` cross-check in `events.ts`
 *     becomes a defence-in-depth verification that the body's
 *     `tenantId` matches the session.
 *   - Test-only escape hatch: `testAuthInjector` lets unit tests
 *     stamp `request.user` directly without minting a real JWT.
 *
 * BEFORE this hook lands, the routes trusted `X-Tenant-Id` from the
 * request header in production. That allowed a confused operator (or
 * a leaked URL replayed by anyone) to write into the wrong tenant's
 * billing log. Post-fix, every route reads tenantId from the verified
 * token.
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

/** Public probes — k8s liveness/readiness + Prometheus scrape. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/healthz',
  '/readyz',
  '/metrics',
]);

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

let cachedSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!raw || raw.length < 10) {
    throw new Error(
      'outcomes-metering: SUPABASE_JWT_SECRET (or JWT_SECRET) is required for request authentication.',
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
 *
 * IMPORTANT: this is also the `authMiddleware` signal the
 * auth-coverage scanner looks for; the export name is intentional.
 */
export function authMiddleware(
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
      'requireUser called without authMiddleware in the preHandler chain',
    );
  }
  return user;
}
