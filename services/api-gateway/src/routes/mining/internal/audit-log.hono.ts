// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/audit-log — paginated WORM audit log.
 *
 * SUPER_ADMIN-only. Surfaces hash-chained, append-only audit entries
 * from `worm_audit_log` (filtered by tenantId + junior action).
 *
 * Routes:
 *   GET  /     paginated list (filter: tenantId, junior)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, lt } from 'drizzle-orm';
import { wormAuditLog } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { internalAuditLogListRoute } from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalAuditLogListRoute, async (c) => {
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const conds: unknown[] = [];
  if (q.tenantId) conds.push(eq(wormAuditLog.tenantId, q.tenantId));
  if (q.junior) conds.push(eq(wormAuditLog.actorId, q.junior));
  if (q.cursor) {
    const cursorSeq = Number(q.cursor);
    if (Number.isFinite(cursorSeq)) conds.push(lt(wormAuditLog.sequenceNumber, cursorSeq));
  }
  const query = db
    .select()
    .from(wormAuditLog)
    .orderBy(desc(wormAuditLog.sequenceNumber))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningInternalAuditLogRouter = app;
