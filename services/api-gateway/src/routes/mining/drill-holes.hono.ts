// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/drill-holes — drill / pit / trench logs + down-hole layers.
 *
 * Routes:
 *   GET    /                       list drill holes (filter by siteId, kind)
 *   POST   /                       create (worker-only)
 *   POST   /:id/layers             append a lithological layer
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { drillHoles, drillHoleLayers } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum(['pit', 'shaft', 'rc', 'diamond', 'hand_augur', 'trench', 'channel']);

const CreateHoleSchema = z.object({
  siteId: z.string().min(1),
  holeIdExternal: z.string().min(1).max(80),
  kind: KindEnum,
  collarLocation: z.string().optional(),
  azimuthDeg: z.string().optional(),
  dipDeg: z.string().optional(),
  totalDepthM: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});

const CreateLayerSchema = z.object({
  depthFromM: z.string().min(1),
  depthToM: z.string().min(1),
  lithology: z.string().optional(),
  colour: z.string().optional(),
  grainSize: z.string().optional(),
  isVeinIntersect: z.boolean().default(false),
  veinWidthM: z.string().optional(),
  veinDipDeg: z.string().optional(),
  hostRock: z.string().optional(),
  mineralisationIndicators: z.array(z.string()).optional(),
  photoUrl: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
});

// Worker = MAINTENANCE_STAFF (closest mapped role) or any tenant staff role.
const WORKER_ROLES = [
  UserRole.MAINTENANCE_STAFF,
  UserRole.PROPERTY_MANAGER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
];

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  const kind = c.req.query('kind');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(drillHoles.tenantId, tenantId)];
  if (siteId) conds.push(eq(drillHoles.siteId, siteId));
  if (kind) conds.push(eq(drillHoles.kind, kind));
  const rows = await db
    .select()
    .from(drillHoles)
    .where(and(...conds))
    .orderBy(desc(drillHoles.createdAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.get('/:id/layers', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const holeId = c.req.param('id');
  const rows = await db
    .select()
    .from(drillHoleLayers)
    .where(and(eq(drillHoleLayers.tenantId, tenantId), eq(drillHoleLayers.holeId, holeId)))
    .orderBy(asc(drillHoleLayers.depthFromM));
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  requireRole(...WORKER_ROLES),
  zValidator('json', CreateHoleSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.post(
  '/:id/layers',
  requireRole(...WORKER_ROLES),
  zValidator('json', CreateLayerSchema),
  withSecurityEvents(
    { action: 'mining.drill_hole.layer.create', resource: 'mining.drill_hole_layer', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const holeId = c.req.param('id');
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningDrillHolesRouter = app;
