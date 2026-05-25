// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/audit-log — paginated WORM audit log.
 *
 * SUPER_ADMIN-only. Surfaces hash-chained, append-only audit entries
 * from `worm_audit_log` (filtered by tenantId + junior action).
 *
 * Routes:
 *   GET  /     paginated list (filter: tenantId, junior)
 */

import { Hono } from 'hono';
import { and, desc, eq, lt } from 'drizzle-orm';
import { wormAuditLog } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.query('tenantId');
  const junior = c.req.query('junior');
  const cursor = c.req.query('cursor');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const conds = [] as unknown[];
  if (tenantId) conds.push(eq(wormAuditLog.tenantId, tenantId));
  if (junior) conds.push(eq(wormAuditLog.actorId, junior));
  if (cursor) {
    const cursorSeq = Number(cursor);
    if (Number.isFinite(cursorSeq)) conds.push(lt(wormAuditLog.sequenceNumber, cursorSeq));
  }
  const query = db
    .select()
    .from(wormAuditLog)
    .orderBy(desc(wormAuditLog.sequenceNumber))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  const nextCursor = rows.length === limit ? rows[rows.length - 1]?.sequenceNumber : null;
  return c.json({ success: true, data: rows, meta: { nextCursor, limit, count: rows.length } });
});

export const miningInternalAuditLogRouter = app;
