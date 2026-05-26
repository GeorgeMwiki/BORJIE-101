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
 * Migrated to `@hono/zod-openapi` (issue #19). Route definitions live
 * in `./_openapi/route-defs.ts`; this file only carries handlers.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { sites } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  sitesListRoute,
  sitesGetRoute,
  sitesCreateRoute,
  sitesUpdateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(sitesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(sites.tenantId, tenantId)];
  if (q.licenceId) conds.push(eq(sites.licenceId, q.licenceId));
  if (q.phase) conds.push(eq(sites.phase, q.phase));
  if (q.status) conds.push(eq(sites.status, q.status));
  const rows = await db
    .select()
    .from(sites)
    .where(and(...conds))
    .orderBy(desc(sites.updatedAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(sitesGetRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { id } = c.req.valid('param');
  const [row] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Site not found' },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: row }, 200);
});

app.openapi(
  sitesCreateRoute,
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
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  sitesUpdateRoute,
  withSecurityEvents(
    { action: 'mining.site.update', resource: 'mining.site', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const [row] = await db
        .update(sites)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Site not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningSitesRouter = app;
