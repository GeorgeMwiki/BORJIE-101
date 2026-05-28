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
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { complianceEscalations } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalComplianceListRoute,
  internalComplianceApproveRoute,
  internalComplianceRejectRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalComplianceListRoute, async (c) => {
  const db = c.get('db');
  const { tenantId, severity, state, limit } = c.req.valid('query');
  const conds: SQL[] = [];
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
  return c.json({ success: true as const, data: rows }, 200);
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
      const { id } = c.req.valid('param');
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
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Escalation not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  );
}

app.openapi(internalComplianceApproveRoute, resolveHandler('approve'));
app.openapi(internalComplianceRejectRoute, resolveHandler('reject'));

export const miningInternalComplianceQueueRouter = app;
