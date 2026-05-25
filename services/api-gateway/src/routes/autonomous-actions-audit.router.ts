// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal widening.
/**
 * Autonomous-actions audit trail router — Wave-13.
 *
 * Admin-only read endpoint for the `autonomous_action_audit` table:
 *   GET /api/v1/audit/autonomous-actions?domain=...&since=...&limit=...
 *
 * A head of estates (or an auditor acting on their behalf) can walk
 * every action Mr. Mwikila took on his own authority, complete with
 * reasoning, confidence, and the policy rule that matched.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  AutonomousActionAudit,
  InMemoryAutonomousActionAuditRepository,
  type AutonomousActionAuditRepository,
} from '@borjie/ai-copilot/autonomy';
import { authMiddleware } from '../middleware/hono-auth';

const fallbackRepo: AutonomousActionAuditRepository =
  new InMemoryAutonomousActionAuditRepository();
const fallbackAudit = new AutonomousActionAudit({ repository: fallbackRepo });

const ListQuerySchema = z.object({
  domain: z
    .enum(['finance', 'leasing', 'maintenance', 'compliance', 'communications', 'strategic'])
    .optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const autonomousActionsAuditRouter = new Hono();

autonomousActionsAuditRouter.use('*', authMiddleware);

function isAdmin(role: string | undefined): boolean {
  if (!role) return false;
  const normalised = role.toUpperCase();
  return (
    normalised === 'ADMIN' ||
    normalised === 'SUPER_ADMIN' ||
    normalised === 'HEAD_OF_ESTATES' ||
    normalised === 'OWNER' ||
    normalised === 'ESTATE_ADMIN'
  );
}

function getAudit(c): AutonomousActionAudit {
  const candidate = c.get('autonomousActionAudit') as AutonomousActionAudit | undefined;
  return candidate ?? fallbackAudit;
}

autonomousActionsAuditRouter.get(
  '/autonomous-actions',
  zValidator('query', ListQuerySchema),
  async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const auth = c.get('auth') as { role?: string } | undefined;
    if (!tenantId) {
      return c.json({ success: false, error: 'tenant context missing' }, 400);
    }
    if (!isAdmin(auth?.role)) {
      return c.json({ success: false, error: 'forbidden' }, 403);
    }
    const q = c.req.valid('query');
    const since = q.since ? new Date(q.since) : undefined;
    const rows = await getAudit(c).list(tenantId, {
      domain: q.domain,
      since,
      limit: q.limit,
    });
    return c.json({
      success: true,
      data: rows,
      meta: { total: rows.length, page: 1, limit: q.limit ?? rows.length },
    });
  },
);

autonomousActionsAuditRouter.get('/autonomous-actions/stats', async (c) => {
  const tenantId = c.get('tenantId') as string | undefined;
  const auth = c.get('auth') as { role?: string } | undefined;
  if (!tenantId) {
    return c.json({ success: false, error: 'tenant context missing' }, 400);
  }
  if (!isAdmin(auth?.role)) {
    return c.json({ success: false, error: 'forbidden' }, 403);
  }
  const count = await getAudit(c).countThisWeek(tenantId);
  return c.json({ success: true, data: { actionsThisWeek: count } });
});

export default autonomousActionsAuditRouter;
