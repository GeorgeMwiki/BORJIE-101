/**
 * requireService middleware factory — KI-003 closure.
 *
 * Many Hono route handlers do:
 *
 *   const svc = c.get('renewalService');
 *   const result = await svc.foo(...);   // throws TypeError if svc is undefined
 *
 * In production the composition root always wires every service when
 * `DATABASE_URL` is set, so the access never fails. In dev / demo / sandbox
 * deployments some services are intentionally omitted (e.g. payments
 * worker is off), and an unguarded handler responds with an opaque 500
 * instead of a structured 503.
 *
 * This factory short-circuits to a `SERVICE_UNAVAILABLE` envelope the
 * moment the bound service is missing, BEFORE the handler runs. It works
 * with both the legacy per-key context shape (`c.get('renewalService')`)
 * and the newer `c.get('services').renewalService` shape — try both.
 *
 * Usage:
 *
 *   import { requireService } from '../middleware/require-service.js';
 *
 *   router.post('/propose',
 *     requireService('renewalService'),
 *     async (c) => { ... }
 *   );
 *
 *   // Multiple services in one guard:
 *   router.post('/run',
 *     requireService(['renewalService', 'ledgerService']),
 *     async (c) => { ... }
 *   );
 */
import { createMiddleware } from 'hono/factory';

type ServiceKey = string;

interface ServicesBag {
  readonly [key: string]: unknown;
}

function hasNonNullValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function lookupService(
  c: { get(key: string): unknown },
  key: ServiceKey,
): unknown {
  // Newer shape: c.get('services').xxx
  const bag = c.get('services') as ServicesBag | undefined;
  if (bag && hasNonNullValue(bag[key])) return bag[key];

  // Legacy shape: c.get('renewalService') directly
  // Hono's ContextVariableMap is strict; cast through `as never` to avoid
  // requiring every consumer to declare the lookup key in its own typing.
  const direct = c.get(key as never);
  if (hasNonNullValue(direct)) return direct;

  return undefined;
}

/**
 * Middleware factory that returns a 503 envelope if any required service
 * isn't bound on the request context.
 *
 * @param required  Single service key or an array of keys.
 */
export const requireService = (required: ServiceKey | readonly ServiceKey[]) => {
  const keys = Array.isArray(required) ? required : [required as ServiceKey];

  return createMiddleware(async (c, next) => {
    const missing: string[] = [];
    for (const key of keys) {
      const value = lookupService(c, key);
      if (!hasNonNullValue(value)) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message:
              missing.length === 1
                ? `Service '${missing[0]}' is not configured on this deployment.`
                : `Services ${missing.map((k) => `'${k}'`).join(', ')} are not configured on this deployment.`,
            details: { missing },
          },
        },
        503,
      );
    }

    await next();
  });
};

/**
 * Predicate variant — useful inside a handler when the route serves a
 * degraded payload (200 with an empty list) rather than 503ing.
 */
export function hasService(
  c: { get(key: string): unknown },
  key: ServiceKey,
): boolean {
  return hasNonNullValue(lookupService(c, key));
}
