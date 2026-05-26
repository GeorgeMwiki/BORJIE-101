// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
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
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { maintenanceEvents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  maintenanceListRoute,
  maintenanceCreateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(maintenanceListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(maintenanceEvents.tenantId, tenantId)];
  if (q.assetId) conds.push(eq(maintenanceEvents.assetId, q.assetId));
  if (q.status) conds.push(eq(maintenanceEvents.status, q.status));
  const rows = await db
    .select()
    .from(maintenanceEvents)
    .where(and(...conds))
    .orderBy(desc(maintenanceEvents.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  maintenanceCreateRoute,
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
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningMaintenanceRouter = app;
