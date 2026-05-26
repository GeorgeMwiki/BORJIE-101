// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/samples — lab-bound assay packets.
 *
 * Routes:
 *   GET    /                       list samples (filter by drillHoleId)
 *   POST   /                       create
 *   POST   /:id/assay-result       attach lab result + QA/QC outcome
 *
 * Migrated to `@hono/zod-openapi` (issue #60). Route definitions live in
 * `./_openapi/route-defs.ts`.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { samples } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  samplesListRoute,
  samplesCreateRoute,
  samplesAssayRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(samplesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(samples.tenantId, tenantId)];
  if (q.drillHoleId) conds.push(eq(samples.drillHoleId, q.drillHoleId));
  if (q.passedQaqc !== undefined) {
    conds.push(eq(samples.passedQaqc, q.passedQaqc === 'true'));
  }
  const rows = await db
    .select()
    .from(samples)
    .where(and(...conds))
    .orderBy(desc(samples.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  samplesCreateRoute,
  withSecurityEvents(
    { action: 'mining.sample.create', resource: 'mining.sample', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(samples)
        .values({
          id: randomUUID(),
          tenantId,
          drillHoleId: input.drillHoleId ?? null,
          depthM: input.depthM ?? null,
          sampleTag: input.sampleTag,
          massG: input.massG ?? null,
          labId: input.labId ?? null,
          sentAt: input.sentAt ? new Date(input.sentAt) : null,
          receivedAt: null,
          resultsAt: null,
          results: {},
          qaQc: {},
          passedQaqc: null,
          attributes: input.attributes ?? {},
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  samplesAssayRoute,
  withSecurityEvents(
    { action: 'mining.sample.assay', resource: 'mining.sample', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const [row] = await db
        .update(samples)
        .set({
          results: input.results,
          qaQc: input.qaQc ?? {},
          passedQaqc: input.passedQaqc,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
          resultsAt: input.resultsAt ? new Date(input.resultsAt) : new Date(),
        })
        .where(and(eq(samples.id, id), eq(samples.tenantId, tenantId)))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Sample not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningSamplesRouter = app;
