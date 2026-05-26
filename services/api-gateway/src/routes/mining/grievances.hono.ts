/**
 * /api/v1/mining/grievances — community / worker complaint log.
 *
 * Routes:
 *   GET   /     list (filter by siteId, status, category)
 *   POST  /     raise grievance
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { grievances } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  grievancesListRoute,
  grievancesCreateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(grievancesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(grievances.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(grievances.siteId, q.siteId));
  if (q.status) conds.push(eq(grievances.status, q.status));
  if (q.category) conds.push(eq(grievances.category, q.category));
  const rows = await db
    .select()
    .from(grievances)
    .where(and(...conds))
    .orderBy(desc(grievances.raisedAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  grievancesCreateRoute,
  withSecurityEvents(
    { action: 'mining.grievance.create', resource: 'mining.grievance', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(grievances)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId ?? null,
          raisedByKind: input.raisedByKind,
          raisedByName: input.raisedByName ?? null,
          raisedByContact: input.raisedByContact ?? null,
          category: input.category,
          summary: input.summary,
          status: 'open',
          raisedAt: new Date(),
          evidenceIds: input.evidenceIds ?? [],
          attributes: input.attributes ?? {},
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningGrievancesRouter = app;
