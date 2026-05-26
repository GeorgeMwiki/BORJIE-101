// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/lmbm — Live Mining Brain Memory (temporal-entity graph).
 *
 * Routes:
 *   GET  /graph                 entities + edges (filter by entity_type)
 *   GET  /traverse?from=X       recursive CTE — outbound relations
 *                               from entity X (depth-bounded)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq, sql } from 'drizzle-orm';
import { temporalEntities, temporalRelationships } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { lmbmGraphRoute, lmbmTraverseRoute } from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(lmbmGraphRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 200), 1000);
  const entityConds = [eq(temporalEntities.tenantId, tenantId)];
  if (q.entity_type) entityConds.push(eq(temporalEntities.entityType, q.entity_type));
  const [entities, edges] = await Promise.all([
    db
      .select()
      .from(temporalEntities)
      .where(and(...entityConds))
      .limit(limit),
    db
      .select()
      .from(temporalRelationships)
      .where(eq(temporalRelationships.tenantId, tenantId))
      .limit(limit),
  ]);
  const entityIds = new Set(entities.map((e) => e.id));
  const filteredEdges = q.entity_type
    ? edges.filter((e) => entityIds.has(e.fromEntityId) || entityIds.has(e.toEntityId))
    : edges;
  return c.json(
    {
      success: true as const,
      data: { entities, edges: filteredEdges },
    },
    200,
  );
});

app.openapi(lmbmTraverseRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { from, depth } = c.req.valid('query');
  const maxDepth = Math.min(Number(depth ?? 4), 8);
  // Recursive CTE traversal — depth-bounded and tenant-scoped via the
  // GUC; the explicit tenant_id predicate is defence-in-depth.
  const rows = await db.execute(sql`
    WITH RECURSIVE walk AS (
      SELECT id, from_entity_id, to_entity_id, relationship, 1 AS depth
      FROM temporal_relationships
      WHERE tenant_id = ${tenantId}
        AND from_entity_id = ${from}
        AND invalidated_at IS NULL
      UNION ALL
      SELECT r.id, r.from_entity_id, r.to_entity_id, r.relationship, walk.depth + 1
      FROM temporal_relationships r
      JOIN walk ON walk.to_entity_id = r.from_entity_id
      WHERE r.tenant_id = ${tenantId}
        AND r.invalidated_at IS NULL
        AND walk.depth < ${maxDepth}
    )
    SELECT id, from_entity_id, to_entity_id, relationship, depth FROM walk
  `);
  const edges = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  return c.json(
    { success: true as const, data: { from, maxDepth, edges } },
    200,
  );
});

export const miningLmbmRouter = app;
