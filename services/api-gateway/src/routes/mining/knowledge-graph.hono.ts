/**
 * /api/v1/mining/knowledge-graph — REAL Postgres-backed knowledge graph,
 * backed by `@borjie/knowledge-graph`'s `KGStorePort` over the durable tables
 * `kg_nodes` + `kg_edges` (migration 0298). No Neo4j / no external graph DB.
 *
 * Routes:
 *   POST /ingest               (re)build this tenant's graph from REAL rows —
 *                              estate / staff / vendors / ore parcels +
 *                              corpus-chunk nodes that COPY the existing
 *                              pgvector embeddings (no new embedder, no OpenAI
 *                              credential). Idempotent: re-running converges.
 *   GET  /stats                node/edge counts per kind for this tenant.
 *   GET  /neighbors/:id        1–2 hop neighbourhood around a node (debug /
 *                              viz; `?depth=1|2` clamps to [1,2]).
 *
 * Idempotency: ingestion upserts ON CONFLICT, so a cron / on-demand trigger can
 * run it as often as it likes. The route is the on-demand surface; a scheduler
 * can POST /ingest per tenant on a cadence.
 *
 * RLS: `databaseMiddleware` reserves a connection and binds
 * `app.current_tenant_id`, so the FORCE-RLS policy on kg_nodes/kg_edges (and on
 * every source table read during ingestion) filters every row to this tenant.
 * The store/ingest layer ALSO carries an explicit `tenant_id` predicate
 * (defence in depth). All inputs validated with zod.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { expandFromSeed } from '@borjie/knowledge-graph';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { createPostgresKgStore, type KgDbExec } from '../../composition/knowledge-graph/postgres-kg-store';
import { ingestKnowledgeGraph } from '../../composition/knowledge-graph/ingest';

const moduleLogger = createLogger('mining-knowledge-graph');

function unavailable(c: { json: (b: unknown, s: number) => Response }): Response {
  return c.json(
    { success: false as const, error: { code: 'KG_DB_UNAVAILABLE' } },
    503,
  );
}

const DepthQuery = z.coerce.number().int().min(1).max(2).catch(2);

export const miningKnowledgeGraphRouter = new Hono();
miningKnowledgeGraphRouter.use('*', authMiddleware);
miningKnowledgeGraphRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /ingest — (re)build this tenant's graph from real rows. Idempotent.
// ---------------------------------------------------------------------------
miningKnowledgeGraphRouter.post('/ingest', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db') as KgDbExec | null;
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    // databaseMiddleware already pinned the connection + bound the tenant GUC,
    // so the source reads + kg writes are all RLS-scoped to this tenant.
    const result = await ingestKnowledgeGraph({ db, tenantId: auth.tenantId });
    return c.json({ success: true as const, data: result }, 200);
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'kg_ingest_failed');
    return c.json(
      { success: false as const, error: { code: 'KG_INGEST_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /stats — node/edge counts per kind for this tenant.
// ---------------------------------------------------------------------------
miningKnowledgeGraphRouter.get('/stats', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db') as KgDbExec | null;
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const store = createPostgresKgStore(db);
    const [nodes, edges] = await Promise.all([
      store.allNodes(auth.tenantId),
      store.allEdges(auth.tenantId),
    ]);
    const byKind: Record<string, number> = {};
    for (const n of nodes) byKind[n.class] = (byKind[n.class] ?? 0) + 1;
    const byRelation: Record<string, number> = {};
    for (const e of edges) byRelation[e.label] = (byRelation[e.label] ?? 0) + 1;
    return c.json(
      {
        success: true as const,
        data: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          byKind,
          byRelation,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'kg_stats_failed');
    return c.json(
      { success: false as const, error: { code: 'KG_STATS_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /neighbors/:id — 1–2 hop neighbourhood around a node (debug / viz).
// ---------------------------------------------------------------------------
miningKnowledgeGraphRouter.get('/neighbors/:id', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db') as KgDbExec | null;
  if (!db || !auth?.tenantId) return unavailable(c);
  const id = c.req.param('id');
  const depth = DepthQuery.parse(c.req.query('depth'));
  try {
    const store = createPostgresKgStore(db);
    const sub = await expandFromSeed({
      tenantId: auth.tenantId,
      seedNodeIds: [id],
      store,
      depth,
    });
    return c.json(
      {
        success: true as const,
        data: {
          nodes: sub.nodes,
          edges: sub.edges,
          nodeCount: sub.nodes.length,
          edgeCount: sub.edges.length,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId, id }, 'kg_neighbors_failed');
    return c.json(
      { success: false as const, error: { code: 'KG_NEIGHBORS_FAILED' } },
      500,
    );
  }
});
