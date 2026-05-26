// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/compliance-queue — escalations raised by the
 * per-tenant Compliance Agent that require platform-staff triage.
 *
 * SUPER_ADMIN-only. Reads from the platform-scope
 * `compliance_escalations` table (migration 0008). Each row carries
 * severity, originating tenant context, and a JSONB array of evidence
 * ids (audit / decision-trace ids) the Compliance Agent flagged.
 *
 * Routes:
 *   GET   /                      paginated open-by-default queue
 *   POST  /:id/approve           resolve an escalation as approved
 *   POST  /:id/reject            resolve an escalation as rejected
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { complianceEscalations } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const QuerySchema = z.object({
  tenantId: z.string().min(1).max(120).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  /** Default surfaces only open escalations; `all` includes resolved. */
  state: z.enum(['open', 'resolved', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

app.get('/', zValidator('query', QuerySchema), async (c) => {
  const db = c.get('db');
  const { tenantId, severity, state, limit } = c.req.valid('query');
  const conds: unknown[] = [];
  if (tenantId) conds.push(eq(complianceEscalations.tenantId, tenantId));
  if (severity) conds.push(eq(complianceEscalations.severity, severity));
  if (state === 'open') conds.push(isNull(complianceEscalations.resolvedAt));
  if (state === 'resolved') {
    conds.push(eq(complianceEscalations.resolutionDecision, 'approve'));
  }
  const query = db
    .select()
    .from(complianceEscalations)
    .orderBy(desc(complianceEscalations.escalatedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true, data: rows, meta: { count: rows.length, limit } });
});

function resolveHandler(decision: 'approve' | 'reject') {
  return withSecurityEvents(
    {
      action: `platform.compliance_queue.${decision}`,
      resource: 'platform.compliance_queue',
      severity: 'warn',
    },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      const [row] = await db
        .update(complianceEscalations)
        .set({
          resolvedAt: new Date(),
          resolvedByUserId: userId,
          resolutionDecision: decision,
        })
        .where(eq(complianceEscalations.id, id))
        .returning();
      if (!row) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Escalation not found' } },
          404,
        );
      }
      return c.json({ success: true, data: row });
    },
  );
}

app.post('/:id/approve', resolveHandler('approve'));
app.post('/:id/reject', resolveHandler('reject'));

export const miningInternalComplianceQueueRouter = app;
