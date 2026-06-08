/**
 * Break-glass enforcement middleware (INV-A / FIRE-1).
 *
 * The STRUCTURAL gate that makes the four INV-A leaks impossible to reach
 * silently. Apply it to any gateway route that would serve a tenant's
 * BUSINESS CONTENT (not platform metadata) to a Borjie-internal principal.
 *
 * On each request it:
 *   1. resolves the TARGET tenant id (from `?tenant` / `?tenantId` / `:tenantId`);
 *   2. requires the caller to be a platform principal (SUPER_ADMIN / ADMIN /
 *      SUPPORT) acting cross-tenant — a tenant's OWN user reaching their OWN
 *      data is out of scope for break-glass (that is the data plane);
 *   3. calls `assertActiveGrant` — DENY-BY-DEFAULT: no active, consented,
 *      non-expired, scope-matching grant → 403 BREAK_GLASS_REQUIRED;
 *   4. on success, stamps `c.set('breakGlassGrant', …)` so the handler can
 *      `recordAccess` with the surfaced row count into the hash chain.
 *
 * Because deny is the default, a route guarded by this middleware returns NO
 * tenant business row unless a tenant-consented, time-boxed grant exists.
 */

import { createMiddleware } from 'hono/factory';
import { isPlatformAdmin, type UserRole } from '../types/user-role';
import { getOperatorAccessStore } from '../break-glass/store-singleton';
import type {
  BreakGlassScope,
  OperatorAccessGrant,
} from '../break-glass/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('break-glass');

declare module 'hono' {
  interface ContextVariableMap {
    breakGlassGrant: OperatorAccessGrant;
    breakGlassTenantId: string;
  }
}

function resolveTargetTenant(c: {
  req: {
    query: (k: string) => string | undefined;
    param: (k: string) => string | undefined;
  };
}): string | undefined {
  const fromQuery = c.req.query('tenant') ?? c.req.query('tenantId');
  if (fromQuery && fromQuery.trim().length > 0) return fromQuery.trim();
  const fromParam = c.req.param('tenantId') ?? c.req.param('id');
  if (fromParam && fromParam.trim().length > 0) return fromParam.trim();
  return undefined;
}

/**
 * Require an active break-glass grant for `scope` over the target tenant.
 * Use AFTER `authMiddleware` + `requireRole(SUPER_ADMIN, ADMIN, …)`.
 */
export function requireBreakGlass(scope: BreakGlassScope) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as
      | { userId: string; role: UserRole }
      | undefined;
    if (!auth) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401,
      );
    }
    if (!isPlatformAdmin(auth.role)) {
      // Non-platform principals never reach a break-glass-gated content route.
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Break-glass access is restricted to platform operators',
          },
        },
        403,
      );
    }

    const tenantId = resolveTargetTenant(c);
    if (!tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'BREAK_GLASS_TENANT_REQUIRED',
            message:
              'A target tenant must be specified to request break-glass content access',
          },
        },
        400,
      );
    }

    const store = getOperatorAccessStore();
    const check = await store.assertActiveGrant({
      operatorId: auth.userId,
      tenantId,
      scope,
    });
    if (!check.ok) {
      logger.warn('break-glass denied', {
        evt: 'break_glass_denied',
        operatorId: auth.userId,
        tenantId,
        scope,
        reason: check.reason,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'BREAK_GLASS_REQUIRED',
            message:
              'Tenant business content requires an active, tenant-consented break-glass grant',
            reason: check.reason,
            scope,
            tenantId,
          },
        },
        403,
      );
    }

    c.set('breakGlassGrant', check.grant);
    c.set('breakGlassTenantId', tenantId);
    await next();
  });
}

/**
 * Append a hash-chained access-log entry for a request that just served
 * tenant business content under an active grant. Call from the handler with
 * the number of business rows surfaced. Best-effort: a logging failure must
 * not corrupt the response, but it IS logged loudly (the access happened).
 */
export async function recordBreakGlassAccess(
  c: {
    get: (k: 'breakGlassGrant') => OperatorAccessGrant | undefined;
  } & { get: (k: 'breakGlassTenantId') => string | undefined },
  args: { route: string; scope: BreakGlassScope; rowCount: number },
): Promise<void> {
  const grant = (c.get as (k: string) => unknown)(
    'breakGlassGrant',
  ) as OperatorAccessGrant | undefined;
  const tenantId = (c.get as (k: string) => unknown)(
    'breakGlassTenantId',
  ) as string | undefined;
  if (!grant || !tenantId) return;
  try {
    const store = getOperatorAccessStore();
    await store.recordAccess({
      grantId: grant.id,
      tenantId,
      operatorId: grant.operatorId,
      route: args.route,
      scope: args.scope,
      rowCount: args.rowCount,
    });
  } catch (error) {
    logger.error('failed to record break-glass access', {
      evt: 'break_glass_record_failed',
      grantId: grant.id,
      tenantId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
