/**
 * Capability Gate — Wave 26 Agent Z5.
 *
 * Fine-grained authorization layer that complements `requireRole` (coarse
 * first gate) by delegating action/resource decisions to the shared
 * `RbacEngine` from `@borjie/authz-policy`. This is the production
 * adoption point for the previously-unused authz-policy package.
 *
 * Intent:
 *   - `requireRole(TENANT_ADMIN)` keeps out non-staff.
 *   - `requireCapability('create', 'lease')` asks the RBAC engine whether
 *     the caller's role actually grants that action on that resource,
 *     reading from the canonical role matrix in `@borjie/authz-policy`.
 *
 * Why this exists:
 *   The gateway historically had two sources of truth for role→permission
 *   mappings: the in-gateway `PERMISSIONS` map in `authorization.ts` and
 *   the unused `@borjie/authz-policy` package. This middleware makes
 *   `@borjie/authz-policy` the single source of truth for capability
 *   decisions so future ABAC/row-level rules have a home.
 */

import { createMiddleware } from 'hono/factory';
import { RbacEngine, type Action, type Resource } from '@borjie/authz-policy';
import { UserRole } from '../types/user-role';

/**
 * Map the gateway's ALL_CAPS `UserRole` enum to the kebab-case role names
 * used inside the authz-policy default role matrix.
 */
const ROLE_TO_POLICY_ROLE: Record<UserRole, string[]> = {
  SUPER_ADMIN: ['super-admin'],
  ADMIN: ['super-admin'],
  SUPPORT: ['caretaker'], // read-mostly
  TENANT_ADMIN: ['property-owner'],
  PROPERTY_MANAGER: ['property-manager'],
  ACCOUNTANT: ['accountant'],
  MAINTENANCE_STAFF: ['caretaker'],
  OWNER: ['property-owner'],
  RESIDENT: ['tenant'],
};

/**
 * Shared singleton engine. Registering the gateway's role mapping once on
 * module load keeps per-request calls O(1) and avoids building a fresh
 * engine per middleware invocation.
 */
const engine = new RbacEngine();

/**
 * Build a User shape the RbacEngine understands from the gateway's
 * per-request `AuthContext` (which stores role as a single ALL_CAPS enum
 * value on `c.get('auth')`).
 */
function buildRbacUser(auth: {
  userId: string;
  tenantId: string;
  role: UserRole;
  propertyAccess: string[];
}) {
  return {
    id: auth.userId,
    roles: ROLE_TO_POLICY_ROLE[auth.role] ?? [],
    tenantId: auth.tenantId,
    propertyIds: auth.propertyAccess,
  };
}

/**
 * Fine-grained permission gate layered on top of `requireRole`.
 *
 * Usage:
 *   app.post(
 *     '/',
 *     requireRole(UserRole.TENANT_ADMIN, UserRole.PROPERTY_MANAGER),
 *     requireCapability('create', 'lease'),
 *     handler
 *   );
 *
 * Returns 403 with a standard FORBIDDEN envelope if the caller's role does
 * not grant `action` on `resource` per the shared RBAC matrix.
 */
export const requireCapability = (action: Action, resource: Resource) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');

    if (!auth) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401
      );
    }

    const user = buildRbacUser(auth);
    const result = engine.checkPermission(user, action, resource);

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: result.reason ?? `Missing capability ${action}:${resource}`,
          },
        },
        403
      );
    }

    await next();
  });
};

/**
 * Programmatic capability check for use inside handlers (e.g. to gate a
 * specific branch without short-circuiting the request).
 */
export function hasCapability(
  auth: { userId: string; tenantId: string; role: UserRole; propertyAccess: string[] },
  action: Action,
  resource: Resource,
  context?: Record<string, unknown>
): boolean {
  const user = buildRbacUser(auth);
  return engine.checkPermission(user, action, resource, context).allowed;
}

export { engine as capabilityEngine };
