// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/drill-holes — drill / pit / trench logs + down-hole layers.
 *
 * Routes:
 *   GET    /                       list drill holes (filter by siteId, kind)
 *   GET    /:id/layers             list layers for one hole
 *   POST   /                       create (worker-only)
 *   POST   /:id/layers             append a lithological layer
 *
 * Migrated to `@hono/zod-openapi` (issue #60). Route definitions live in
 * `./_openapi/route-defs.ts`; this file only carries handlers.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { drillHoles, drillHoleLayers } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import {
  drillHolesListRoute,
  drillHolesListLayersRoute,
  drillHolesCreateRoute,
  drillHolesCreateLayerRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// Worker = MAINTENANCE_STAFF (closest mapped role) or any tenant staff role.
const WORKER_ROLES = [
  UserRole.MAINTENANCE_STAFF,
  UserRole.PROPERTY_MANAGER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
];

app.openapi(drillHolesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(drillHoles.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(drillHoles.siteId, q.siteId));
  if (q.kind) conds.push(eq(drillHoles.kind, q.kind));
  const rows = await db
    .select()
    .from(drillHoles)
    .where(and(...conds))
    .orderBy(desc(drillHoles.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(drillHolesListLayersRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { id: holeId } = c.req.valid('param');
  const rows = await db
    .select()
    .from(drillHoleLayers)
    .where(
      and(eq(drillHoleLayers.tenantId, tenantId), eq(drillHoleLayers.holeId, holeId)),
    )
    .orderBy(asc(drillHoleLayers.depthFromM));
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  { ...drillHolesCreateRoute, middleware: [requireRole(...WORKER_ROLES)] },
  withSecurityEvents(
    { action: 'mining.drill_hole.create', resource: 'mining.drill_hole', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(drillHoles)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId,
          holeIdExternal: input.holeIdExternal,
          kind: input.kind,
          collarLocation: input.collarLocation ?? null,
          azimuthDeg: input.azimuthDeg ?? null,
          dipDeg: input.dipDeg ?? null,
          totalDepthM: input.totalDepthM ?? null,
          supervisorUserId: userId,
          attributes: input.attributes ?? {},
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  { ...drillHolesCreateLayerRoute, middleware: [requireRole(...WORKER_ROLES)] },
  withSecurityEvents(
    {
      action: 'mining.drill_hole.layer.create',
      resource: 'mining.drill_hole_layer',
      severity: 'info',
    },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const { id: holeId } = c.req.valid('param');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(drillHoleLayers)
        .values({
          id: randomUUID(),
          tenantId,
          holeId,
          depthFromM: input.depthFromM,
          depthToM: input.depthToM,
          lithology: input.lithology ?? null,
          colour: input.colour ?? null,
          grainSize: input.grainSize ?? null,
          isVeinIntersect: input.isVeinIntersect,
          veinWidthM: input.veinWidthM ?? null,
          veinDipDeg: input.veinDipDeg ?? null,
          hostRock: input.hostRock ?? null,
          mineralisationIndicators: input.mineralisationIndicators ?? [],
          photoUrl: input.photoUrl ?? null,
          notes: input.notes ?? null,
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningDrillHolesRouter = app;
