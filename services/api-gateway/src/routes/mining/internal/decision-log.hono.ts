/**
 * /api/v1/mining/internal/decision-log — per-tenant recommendation
 * history with evidence chains, cursor-paginated.
 *
 * SUPER_ADMIN-only. Reads from the existing `decision_traces` table
 * (one row per finalised `DecisionTrace`) and shapes the output for
 * the admin console's decision-log viewer. The evidence chain is
 * surfaced via the `branches` JSONB column plus the chosen branch id.
 *
 * Routes:
 *   GET  /     paginated list (filter: tenantId, junior, outcome, cursor, limit)
 *
 * Cursor: ISO-8601 `startedAt` timestamp of the last row in the prior
 * page; rows older than the cursor are returned newest-first.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { decisionTraces } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { internalDecisionLogListRoute } from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalDecisionLogListRoute, async (c) => {
  const db = c.get('db');
  const { tenantId, junior, outcome, cursor, limit } = c.req.valid('query');
  const conds: SQL[] = [];
  if (tenantId) conds.push(eq(decisionTraces.tenantId, tenantId));
  if (junior) conds.push(eq(decisionTraces.name, junior));
  if (outcome) conds.push(eq(decisionTraces.outcome, outcome));
  if (cursor) conds.push(lt(decisionTraces.startedAt, new Date(cursor)));
  const query = db
    .select({
      id: decisionTraces.id,
      at: decisionTraces.startedAt,
      tenantId: decisionTraces.tenantId,
      name: decisionTraces.name,
      outcome: decisionTraces.outcome,
      chosenBranchId: decisionTraces.chosenBranchId,
      chosenRationale: decisionTraces.chosenRationale,
      branches: decisionTraces.branches,
      attributes: decisionTraces.attributes,
      durationMs: decisionTraces.durationMs,
    })
    .from(decisionTraces)
    .orderBy(desc(decisionTraces.startedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningInternalDecisionLogRouter = app;
