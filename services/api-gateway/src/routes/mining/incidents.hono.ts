// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/incidents — safety / environmental / community incidents.
 *
 * Routes:
 *   GET   /     list (filter by siteId, kind, severity, status)
 *   POST  /     create incident report
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { incidents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum([
  'safety',
  'environmental',
  'community',
  'near_miss',
  'equipment_failure',
  'fatality',
]);

const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

const CreateIncidentSchema = z.object({
  siteId: z.string().optional(),
  kind: KindEnum,
  severity: SeverityEnum.default('low'),
  occurredAt: z.string().datetime(),
  description: z.string().max(8000).optional(),
  affectedUserIds: z.array(z.string()).optional(),
  fatalities: z.number().int().nonnegative().default(0),
  injuries: z.number().int().nonnegative().default(0),
  location: z.string().optional(),
  rootCause: z.string().max(4000).optional(),
  correctiveActions: z.array(z.record(z.unknown())).optional(),
  photos: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  const kind = c.req.query('kind');
  const severity = c.req.query('severity');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(incidents.tenantId, tenantId)];
  if (siteId) conds.push(eq(incidents.siteId, siteId));
  if (kind) conds.push(eq(incidents.kind, kind));
  if (severity) conds.push(eq(incidents.severity, severity));
  if (status) conds.push(eq(incidents.status, status));
  const rows = await db
    .select()
    .from(incidents)
    .where(and(...conds))
    .orderBy(desc(incidents.occurredAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateIncidentSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningIncidentsRouter = app;
