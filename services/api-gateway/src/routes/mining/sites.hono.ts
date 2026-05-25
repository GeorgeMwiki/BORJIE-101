// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/sites — physical mining locations within a licence area.
 *
 * Routes:
 *   GET    /                list sites (filter by licenceId, phase, status)
 *   GET    /:id             fetch one
 *   POST   /                create
 *   PATCH  /:id             update phase / manager / status / geometry
 *
 * Auth + tenant scoped via authMiddleware + databaseMiddleware
 * (RLS-bound at the DB layer via the `app.current_tenant_id` GUC).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { sites } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const PhaseEnum = z.enum([
  'pre_licence',
  'exploration',
  'access_prep',
  'sampling',
  'trenching',
  'shafting',
  'vein_search',
  'confirmation',
  'expansion',
  'extraction',
  'sorting',
  'processing',
  'transport',
  'sale',
  'rehab',
  'renewal_conversion',
]);

const StatusEnum = z.enum(['active', 'paused', 'abandoned', 'under_rehab']);

const CreateSiteSchema = z.object({
  licenceId: z.string().min(1),
  name: z.string().min(1).max(200),
  mineral: z.string().min(1).max(80),
  location: z.string().optional(),
  polygon: z.string().optional(),
  phase: PhaseEnum.default('pre_licence'),
  managerUserId: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});

const UpdateSiteSchema = z.object({
  name: z.string().optional(),
  mineral: z.string().optional(),
  location: z.string().optional(),
  polygon: z.string().optional(),
  phase: PhaseEnum.optional(),
  managerUserId: z.string().optional(),
  geologyConfidence: z.string().optional(),
  status: StatusEnum.optional(),
  attributes: z.record(z.unknown()).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const licenceId = c.req.query('licenceId');
  const phase = c.req.query('phase');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(sites.tenantId, tenantId)];
  if (licenceId) conds.push(eq(sites.licenceId, licenceId));
  if (phase) conds.push(eq(sites.phase, phase));
  if (status) conds.push(eq(sites.status, status));
  const rows = await db
    .select()
    .from(sites)
    .where(and(...conds))
    .orderBy(desc(sites.updatedAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.get('/:id', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)))
    .limit(1);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  return c.json({ success: true, data: row });
});

app.post(
  '/',
  zValidator('json', CreateSiteSchema),
  withSecurityEvents(
    { action: 'mining.site.create', resource: 'mining.site', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .insert(sites)
        .values({
          id: randomUUID(),
          tenantId,
          licenceId: input.licenceId,
          name: input.name,
          mineral: input.mineral,
          location: input.location ?? null,
          polygon: input.polygon ?? null,
          phase: input.phase,
          managerUserId: input.managerUserId ?? null,
          status: 'active',
          attributes: input.attributes ?? {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.patch(
  '/:id',
  zValidator('json', UpdateSiteSchema),
  withSecurityEvents(
    { action: 'mining.site.update', resource: 'mining.site', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const id = c.req.param('id');
      const input = c.req.valid('json');
      const [row] = await db
        .update(sites)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)))
        .returning();
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningSitesRouter = app;
