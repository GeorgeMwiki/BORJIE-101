// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
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
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, lt } from 'drizzle-orm';
import { decisionTraces } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const QuerySchema = z.object({
  tenantId: z.string().min(1).max(120).optional(),
  junior: z.string().min(1).max(200).optional(),
  outcome: z
    .enum(['approved', 'rejected', 'executed', 'refused', 'failed'])
    .optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

app.get('/', zValidator('query', QuerySchema), async (c) => {
  const db = c.get('db');
  const { tenantId, junior, outcome, cursor, limit } = c.req.valid('query');
  const conds: unknown[] = [];
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
  const nextCursor =
    rows.length === limit ? rows[rows.length - 1]?.at?.toISOString() ?? null : null;
  return c.json({
    success: true,
    data: rows,
    meta: { nextCursor, limit, count: rows.length },
  });
});

export const miningInternalDecisionLogRouter = app;
