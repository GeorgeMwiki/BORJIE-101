// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches.

/**
 * /api/v1/admin/users — owner-portal UsersPage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted UsersPage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/admin/users` as the
 * missing endpoint. The user-administration domain (list/create/update
 * tenant users with role + property access) is partially covered by the
 * top-level `/users` router, but the owner-portal calls a different
 * shape (paginated list + role filter + status filter) that needs its
 * own surface.
 *
 * Note: `/api/v1/admin/roles` already exists via `bff/admin-portal.ts`
 * with an honest-empty `[]` response, so the FE for UserRolesPage does
 * not 404 today. We deliberately do NOT register a second `/admin/roles`
 * here to avoid masking the existing handler.
 *
 * Mounted at `/admin` in index.ts AFTER `adminPortalRouter`. Hono falls
 * through to this router for `/admin/users` because the existing
 * adminPortalRouter does not claim that path.
 *
 * Follow-up api-gateway, ADMIN-USERS-001 (Docs/TODO_BACKLOG.md): wire the admin-user list endpoint.
 *   Concrete next-step:
 *     1. Add `repos.users.findManyForAdmin(tenantId, { page, limit,
 *        roleFilter, statusFilter })` returning
 *        `{ items, total, page, limit }`.
 *     2. Replace the degraded payload below with the real query.
 *     3. Add POST/PATCH/DELETE handlers for the full CRUD declared in
 *        the UsersPage header comment.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'add repos.users.findManyForAdmin(tenantId, filters) returning paginated user rows + replace this skeleton with real CRUD';

const FLAG_KEY = 'flag.bff.admin_users.list';

const app = new Hono();
app.use('*', authMiddleware);
// User administration is gated to tenant-admin and platform admin
// roles. OWNER role is granted view access (matching admin-portal's
// own gate) so the owner-portal UsersPage can render at all.
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

app.get('/users', async (c) => {
  const auth = c.get('auth');
  const services = c.get('services') ?? {};

  // Real wire: the platform users service exposes `listUsers({ tenantId,
  // role, limit, cursor })`. We adapt to the admin UI's expected shape
  // (paginated rows + total). This is the same service the HQ tool
  // surface uses (B1), so we're not divergent.
  const usersSvc = services?.platformUsers;
  if (usersSvc && typeof usersSvc.listUsers === 'function') {
    try {
      const limitParam = c.req.query('limit');
      const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam))) : 50;
      const cursor = c.req.query('cursor') ?? null;
      const role = c.req.query('role') ?? null;
      const result = await usersSvc.listUsers({
        tenantId: auth.tenantId,
        role,
        limit,
        cursor,
      });
      return c.json({
        success: true,
        data: result.rows ?? [],
        pagination: { nextCursor: result.nextCursor ?? null, returned: result.totalReturned ?? (result.rows?.length ?? 0) },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'users service failed';
      return c.json(
        { success: false, error: { code: 'USERS_SERVICE_ERROR', message } },
        503,
      );
    }
  }

  // Loud-failure path: 501 unless an operator turns the dev-mode flag on.
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, NEXT_STEP));
});

export const adminUsersRouter = app;
