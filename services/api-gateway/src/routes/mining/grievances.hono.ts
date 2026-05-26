// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/grievances — community / worker complaint log.
 *
 * Routes:
 *   GET   /     list (filter by siteId, status, category)
 *   POST  /     raise grievance
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { grievances } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const RaisedByKindEnum = z.enum([
  'worker', 'villager', 'landowner', 'community_leader', 'local_govt', 'ngo',
]);

const CategoryEnum = z.enum([
  'noise', 'dust', 'water', 'land', 'wages', 'housing', 'access', 'other',
]);

const CreateGrievanceSchema = z.object({
  siteId: z.string().optional(),
  raisedByKind: RaisedByKindEnum,
  raisedByName: z.string().max(200).optional(),
  raisedByContact: z.string().max(200).optional(),
  category: CategoryEnum,
  summary: z.string().min(1).max(4000),
  evidenceIds: z.array(z.string()).optional(),
  attributes: z.record(z.unknown()).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  const status = c.req.query('status');
  const category = c.req.query('category');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(grievances.tenantId, tenantId)];
  if (siteId) conds.push(eq(grievances.siteId, siteId));
  if (status) conds.push(eq(grievances.status, status));
  if (category) conds.push(eq(grievances.category, category));
  const rows = await db
    .select()
    .from(grievances)
    .where(and(...conds))
    .orderBy(desc(grievances.raisedAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateGrievanceSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningGrievancesRouter = app;
