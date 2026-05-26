// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/maintenance — asset maintenance events.
 *
 * NOTE: distinct from the BossNyumba-era `/maintenance` router which
 * deals with property-maintenance requests. This one manages
 * `maintenance_events` rows on `assets` (excavators, compressors, ...).
 *
 * Routes:
 *   GET   /     list (filter by assetId, status)
 *   POST  /     create event
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { maintenanceEvents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum([
  'scheduled_service',
  'repair',
  'inspection',
  'breakdown',
  'overhaul',
  'tyre_change',
  'other',
]);

const StatusEnum = z.enum(['open', 'in_progress', 'completed', 'cancelled']);

const CreateEventSchema = z.object({
  assetId: z.string().min(1),
  kind: KindEnum,
  status: StatusEnum.default('open'),
  summary: z.string().max(2000).optional(),
  downtimeHours: z.string().optional(),
  costTzs: z.string().optional(),
  partsUsed: z.array(z.record(z.unknown())).optional(),
  scheduledFor: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  evidenceIds: z.array(z.string()).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const assetId = c.req.query('assetId');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(maintenanceEvents.tenantId, tenantId)];
  if (assetId) conds.push(eq(maintenanceEvents.assetId, assetId));
  if (status) conds.push(eq(maintenanceEvents.status, status));
  const rows = await db
    .select()
    .from(maintenanceEvents)
    .where(and(...conds))
    .orderBy(desc(maintenanceEvents.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateEventSchema),
  withSecurityEvents(
    {
      action: 'mining.maintenance_event.create',
      resource: 'mining.maintenance_event',
      severity: 'info',
    },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(maintenanceEvents)
        .values({
          id: randomUUID(),
          tenantId,
          assetId: input.assetId,
          kind: input.kind,
          status: input.status,
          summary: input.summary ?? null,
          downtimeHours: input.downtimeHours ?? null,
          costTzs: input.costTzs ?? null,
          partsUsed: input.partsUsed ?? [],
          performedByUserId: userId,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          startedAt: input.startedAt ? new Date(input.startedAt) : null,
          completedAt: input.completedAt ? new Date(input.completedAt) : null,
          evidenceIds: input.evidenceIds ?? [],
          attributes: {},
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningMaintenanceRouter = app;
