// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches.

/**
 * /api/v1/support — owner-portal SupportToolingPage skeleton.
 *
 * Wave-2 commit 0ee27a0 converted SupportToolingPage to render a
 * `MissingBackendNotice` declaring `GET /api/v1/support/tickets` as the
 * missing endpoint. Until a real ticketing service (or Zendesk/Intercom
 * adapter) is wired, this returns an empty list with
 * `X-Backend-Status: degraded` so the page renders the empty state.
 *
 * Follow-up api-gateway, SUPPORT-001 (#33): wire support tickets.
 *   Concrete next-step:
 *     1. Decide between (a) self-hosted `support_tickets` table or
 *        (b) external integration. The migration shape would be
 *        ({ id, tenantId, subject, status, priority, requesterUserId,
 *           assignedTo, createdAt, updatedAt, closedAt }).
 *     2. Add `SupportService.listTickets(tenantId, filters)` in
 *        @borjie/domain-services.
 *     3. Replace the degraded payload with the real read.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const NEXT_STEP =
  'create support_tickets table (or external adapter) + SupportService.listTickets(tenantId, filters) and replace this skeleton';

const FLAG_KEY = 'flag.bff.support.tickets';

const app = new Hono();
app.use('*', authMiddleware);
// Support tooling is admin/owner-only. RESIDENTS open tickets via a
// separate `/support/my-tickets` flow (not part of this skeleton).
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

app.get('/tickets', async (c) => {
  const auth = c.get('auth');
  if (!(await isFlagOn(c, FLAG_KEY))) {
    return notImplementedFlagged(c, FLAG_KEY, NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, NEXT_STEP));
});

export const supportRouter = app;
