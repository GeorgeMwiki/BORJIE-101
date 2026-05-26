// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/incidents — safety / environmental / community incidents.
 *
 * Routes:
 *   GET   /     list (filter by siteId, kind, severity, status)
 *   POST  /     create incident report
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { incidents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  incidentsListRoute,
  incidentsCreateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(incidentsListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(incidents.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(incidents.siteId, q.siteId));
  if (q.kind) conds.push(eq(incidents.kind, q.kind));
  if (q.severity) conds.push(eq(incidents.severity, q.severity));
  if (q.status) conds.push(eq(incidents.status, q.status));
  const rows = await db
    .select()
    .from(incidents)
    .where(and(...conds))
    .orderBy(desc(incidents.occurredAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  incidentsCreateRoute,
  withSecurityEvents(
    { action: 'mining.incident.create', resource: 'mining.incident', severity: 'warn' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(incidents)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId ?? null,
          kind: input.kind,
          severity: input.severity,
          occurredAt: new Date(input.occurredAt),
          description: input.description ?? null,
          affectedUserIds: input.affectedUserIds ?? [],
          fatalities: input.fatalities,
          injuries: input.injuries,
          location: input.location ?? null,
          status: 'open',
          rootCause: input.rootCause ?? null,
          correctiveActions: input.correctiveActions ?? [],
          reportedByUserId: userId,
          photos: input.photos ?? [],
          evidenceIds: input.evidenceIds ?? [],
          attributes: {},
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningIncidentsRouter = app;
