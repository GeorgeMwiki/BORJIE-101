// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/samples — lab-bound assay packets.
 *
 * Routes:
 *   GET    /                       list samples (filter by drillHoleId)
 *   POST   /                       create
 *   POST   /:id/assay-result       attach lab result + QA/QC outcome
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { samples } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const CreateSampleSchema = z.object({
  drillHoleId: z.string().optional(),
  depthM: z.string().optional(),
  sampleTag: z.string().min(1).max(120),
  massG: z.string().optional(),
  labId: z.string().optional(),
  sentAt: z.string().datetime().optional(),
  attributes: z.record(z.unknown()).optional(),
});

const AssayResultSchema = z.object({
  results: z.record(z.union([z.number(), z.string()])),
  qaQc: z.record(z.unknown()).optional(),
  passedQaqc: z.boolean(),
  receivedAt: z.string().datetime().optional(),
  resultsAt: z.string().datetime().optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const drillHoleId = c.req.query('drillHoleId');
  const passedQaqc = c.req.query('passedQaqc');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(samples.tenantId, tenantId)];
  if (drillHoleId) conds.push(eq(samples.drillHoleId, drillHoleId));
  if (passedQaqc !== undefined) conds.push(eq(samples.passedQaqc, passedQaqc === 'true'));
  const rows = await db
    .select()
    .from(samples)
    .where(and(...conds))
    .orderBy(desc(samples.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateSampleSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.post(
  '/:id/assay-result',
  zValidator('json', AssayResultSchema),
  withSecurityEvents(
    { action: 'mining.sample.assay', resource: 'mining.sample', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const id = c.req.param('id');
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
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Sample not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningSamplesRouter = app;
