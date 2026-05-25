// @ts-nocheck — hono v4 ContextVariableMap drift; tracked in Docs/TYPE_DEBT.md
/**
 * Graph query + relationship-explorer router — Canonical Property Graph
 * (CPG) HTTP surface. Authenticated, tenant-scoped, read-only.
 *
 *   GET  /api/v1/graph/node/:label/:id
 *        Return the node's attributes + first-ring neighbourhood (depth 1)
 *        scoped to the caller's tenantId. 404 if the node is not in the
 *        tenant's subgraph.
 *
 *   POST /api/v1/graph/neighbourhood
 *        Body: { startLabel, startId, depth (1-3), edgeTypes?, limit? (<=500) }
 *        Return nodes[] + edges[] for a k-hop neighbourhood. Depth capped at
 *        3, edge limit capped at 500 so no caller can runaway-traverse the
 *        tenant graph.
 *
 *   POST /api/v1/graph/query
 *        Body: { queryKey, params? }
 *        Executes ONE of the named, pre-authored queries from the
 *        GraphQueryService (never raw Cypher). The tenantId is always
 *        injected server-side from the authed context; the client never
 *        supplies a tenantId — and if they try, it is ignored.
 *
 *   GET  /api/v1/graph/health
 *        Neo4j reachability, last sync time, node counts per label.
 *        Admin-only — exposed for ops dashboards.
 *
 * Degrades to `503 GRAPH_SERVICE_UNAVAILABLE` when the composition root has
 * not wired `services.graph.queryService` (Neo4j env vars absent). Routers
 * NEVER return mock data.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import type { GraphQueryService } from '@borjie/graph-sync';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * Explicit allow-list of GraphQueryService methods that can be invoked
 * through `POST /graph/query`. NEVER expose raw Cypher — every key here
 * maps to a pre-authored, tenant-parameterised method on the service.
 *
 * Each handler strips any client-supplied `tenantId` out of `params` and
 * re-injects the authed context's tenantId, so a malicious caller cannot
 * cross-tenant probe the graph by forging the body.
 */
const QUERY_KEYS = [
  'getCaseTimeline',
  'getTenantRiskDrivers',
  'getVendorScorecard',
  'getUnitHealth',
  'getParcelCompliance',
  'getPropertyRollup',
  'generateEvidencePack',
  'getPortfolioOverview',
] as const;

type QueryKey = (typeof QUERY_KEYS)[number];

const NeighbourhoodBodySchema = z
  .object({
    startLabel: z.string().min(1).max(100),
    startId: z.string().min(1).max(200),
    depth: z.number().int().min(1).max(3),
    edgeTypes: z.array(z.string().min(1).max(100)).max(50).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

const QueryBodySchema = z
  .object({
    queryKey: z.enum(QUERY_KEYS),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Labels and edge types flow into parameterised Cypher via APOC-style
// `apoc.*` calls would be the ideal solution, but APOC is optional in
// managed Neo4j clusters. We defensively sanitise at the boundary so a
// caller can't inject a space / backtick / semicolon into the label.
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sanitiseIdentifier(raw: string): string | null {
  const trimmed = raw.trim();
  if (!IDENTIFIER_RE.test(trimmed)) return null;
  if (trimmed.length > 100) return null;
  return trimmed;
}

function sanitiseEdgeTypeList(
  raw: readonly string[] | undefined,
): string[] | null {
  if (!raw || raw.length === 0) return [];
  const out: string[] = [];
  for (const t of raw) {
    const safe = sanitiseIdentifier(t);
    if (!safe) return null;
    out.push(safe);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

function queryService(c: any): GraphQueryService | null {
  const services = c.get('services') ?? {};
  return services.graph?.queryService ?? null;
}

function unavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'GRAPH_SERVICE_UNAVAILABLE',
        message:
          'Neo4j graph service is not configured on this gateway (NEO4J_URI unset or driver unreachable)',
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// GET /node/:label/:id — single node + 1-hop neighbourhood
// ---------------------------------------------------------------------------

app.get('/node/:label/:id', async (c: any) => {
  const service = queryService(c);
  if (!service) return unavailable(c);

  const auth = c.get('auth');
  const rawLabel = c.req.param('label');
  const rawId = c.req.param('id');

  const label = sanitiseIdentifier(rawLabel ?? '');
  if (!label) {
    return c.json(
      {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'label must be an alphanumeric identifier',
        },
      },
      400,
    );
  }

  const nodeId = String(rawId ?? '').trim();
  if (nodeId.length === 0 || nodeId.length > 200) {
    return c.json(
      {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'id is required',
        },
      },
      400,
    );
  }

  try {
    // The GraphQueryService wraps a Neo4jClient and exposes `readQuery`
    // via the client property. We reach through the service to reuse the
    // same pooled driver (no fresh connections per request).
    const client = (service as unknown as { client: any }).client;
    if (!client || typeof client.readQuery !== 'function') {
      return unavailable(c);
    }

    // Label is parameter-injected via Cypher's ":`<Label>`" syntax after
    // sanitisation. `_tenantId` + `_id` are bound as real parameters so
    // the id can never escape its value context.
    const cypher = `
      MATCH (n:\`${label}\` { _tenantId: $tenantId, _id: $nodeId })
      OPTIONAL MATCH (n)-[r]-(m)
      WHERE m._tenantId = $tenantId
      WITH n,
           collect(DISTINCT {
             nodeId: m._id,
             nodeLabel: head(labels(m)),
             properties: properties(m),
             relationship: type(r),
             direction: CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END
           }) AS neighbours
      RETURN
        n._id AS nodeId,
        head(labels(n)) AS nodeLabel,
        properties(n) AS nodeProperties,
        [x IN neighbours WHERE x.nodeId IS NOT NULL] AS neighbours
      LIMIT 1
    `;

    const rows = await client.readQuery(cypher, {
      tenantId: auth.tenantId,
      nodeId,
    });

    if (!rows || rows.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Node ${label}/${nodeId} not found in tenant subgraph`,
          },
        },
        404,
      );
    }

    const row = rows[0];
    return c.json({
      success: true,
      data: {
        node: {
          id: String(row.nodeId ?? ''),
          label: String(row.nodeLabel ?? label),
          properties: row.nodeProperties ?? {},
        },
        neighbours: Array.isArray(row.neighbours) ? row.neighbours : [],
      },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'GRAPH_QUERY_FAILED',
      status: 500,
      fallback: 'Graph node fetch failed',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /neighbourhood — k-hop expansion (depth <= 3, limit <= 500)
// ---------------------------------------------------------------------------

app.post(
  '/neighbourhood',
  zValidator('json', NeighbourhoodBodySchema),
  withSecurityEvents({ action: 'graph.create', resource: 'graph', severity: 'info' }, async (c: any) => {
    const service = queryService(c);
    if (!service) return unavailable(c);

    const auth = c.get('auth');
    const body = c.req.valid('json');

    const label = sanitiseIdentifier(body.startLabel);
    if (!label) {
      return c.json(
        {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'startLabel must be an alphanumeric identifier',
          },
        },
        400,
      );
    }

    const edgeTypes = sanitiseEdgeTypeList(body.edgeTypes);
    if (edgeTypes === null) {
      return c.json(
        {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'edgeTypes must be alphanumeric relationship identifiers',
          },
        },
        400,
      );
    }

    const depth = body.depth;
    const limit = body.limit ?? 500;

    try {
      const client = (service as unknown as { client: any }).client;
      if (!client || typeof client.readQuery !== 'function') {
        return unavailable(c);
      }

      // Variable-length pattern `-[r*1..$depth]-` uses Cypher's built-in
      // bounded traversal. Depth is an integer validated 1-3 above so it
      // can be embedded directly. Edge-type filter, if supplied, embeds
      // the sanitised types verbatim (each matches IDENTIFIER_RE so no
      // injection surface). The tenantId predicate is applied to every
      // intermediate node so the traversal can never cross tenants.
      const edgeFilter = edgeTypes.length > 0
        ? `:\`${edgeTypes.join('`|`')}\``
        : '';

      const cypher = `
        MATCH (start:\`${label}\` { _tenantId: $tenantId, _id: $startId })
        MATCH path = (start)-[${edgeFilter}*1..${depth}]-(end)
        WHERE ALL(n IN nodes(path) WHERE n._tenantId = $tenantId)
        WITH path
        LIMIT $limit
        UNWIND nodes(path) AS n
        WITH collect(DISTINCT n) AS allNodes, collect(DISTINCT path) AS paths
        UNWIND paths AS p
        UNWIND relationships(p) AS r
        WITH allNodes, collect(DISTINCT r) AS allRels
        RETURN
          [n IN allNodes | {
            id: n._id,
            label: head(labels(n)),
            properties: properties(n)
          }] AS nodes,
          [r IN allRels | {
            type: type(r),
            startNodeId: startNode(r)._id,
            endNodeId: endNode(r)._id,
            properties: properties(r)
          }] AS edges
      `;

      const rows = await client.readQuery(cypher, {
        tenantId: auth.tenantId,
        startId: body.startId,
        limit,
      });

      const result = rows?.[0] ?? { nodes: [], edges: [] };
      const nodes = Array.isArray(result.nodes) ? result.nodes : [];
      const edges = Array.isArray(result.edges) ? result.edges : [];

      // Defence in depth: if the edge count exceeds the cap, truncate and
      // flag the caller. This should only fire if the raw `LIMIT $limit`
      // clause was circumvented (it shouldn't be), but truncating keeps
      // the contract honest.
      const truncated = edges.length > limit;
      return c.json({
        success: true,
        data: {
          nodes,
          edges: truncated ? edges.slice(0, limit) : edges,
          meta: {
            depth,
            limit,
            nodeCount: nodes.length,
            edgeCount: truncated ? limit : edges.length,
            truncated,
          },
        },
      });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'GRAPH_QUERY_FAILED',
        status: 500,
        fallback: 'Graph neighbourhood expansion failed',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /query — named queries only (no raw Cypher)
// ---------------------------------------------------------------------------

type NamedQueryRunner = (
  service: GraphQueryService,
  tenantId: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

const NAMED_QUERIES: Record<QueryKey, NamedQueryRunner> = {
  getCaseTimeline: (svc, tenantId, params) =>
    svc.getCaseTimeline(tenantId, String(params.caseId ?? '')),
  getTenantRiskDrivers: (svc, tenantId, params) =>
    svc.getTenantRiskDrivers(tenantId, String(params.customerId ?? '')),
  getVendorScorecard: (svc, tenantId, params) =>
    svc.getVendorScorecard(
      tenantId,
      String(params.vendorId ?? ''),
      typeof params.windowDays === 'number' ? params.windowDays : 365,
    ),
  getUnitHealth: (svc, tenantId, params) =>
    svc.getUnitHealth(tenantId, String(params.unitId ?? '')),
  getParcelCompliance: (svc, tenantId, params) =>
    svc.getParcelCompliance(tenantId, String(params.parcelId ?? '')),
  getPropertyRollup: (svc, tenantId, params) =>
    svc.getPropertyRollup(tenantId, String(params.propertyId ?? '')),
  generateEvidencePack: (svc, tenantId, params) =>
    svc.generateEvidencePack(tenantId, String(params.caseId ?? '')),
  getPortfolioOverview: (svc, tenantId) => svc.getPortfolioOverview(tenantId),
};

app.post('/query', zValidator('json', QueryBodySchema), withSecurityEvents({ action: 'graph.create', resource: 'graph', severity: 'info' }, async (c: any) => {
  const service = queryService(c);
  if (!service) return unavailable(c);

  const auth = c.get('auth');
  const body = c.req.valid('json');
  const runner = NAMED_QUERIES[body.queryKey as QueryKey];
  if (!runner) {
    // Zod's `z.enum` already blocks unknown keys; belt-and-braces in case
    // the allow-list and the runner table ever drift apart.
    return c.json(
      {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Unknown queryKey: ${body.queryKey}`,
        },
      },
      400,
    );
  }

  // Strip any client-supplied tenantId out of params so it can never
  // override the authed context. The auth tenantId is the only one that
  // reaches the service layer.
  const rawParams = body.params ?? {};
  const { tenantId: _discarded, ...safeParams } = rawParams as Record<
    string,
    unknown
  >;

  try {
    const data = await runner(service, auth.tenantId, safeParams);
    return c.json({
      success: true,
      data,
      meta: { queryKey: body.queryKey },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'GRAPH_QUERY_FAILED',
      status: 500,
      fallback: `Graph query ${body.queryKey} failed`,
    });
  }
}));

// ---------------------------------------------------------------------------
// GET /health — Neo4j reachability + per-label node counts (admin only)
// ---------------------------------------------------------------------------

const adminOnly = new Hono();
adminOnly.use('*', authMiddleware);
adminOnly.use('*', requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

adminOnly.get('/', async (c: any) => {
  const service = queryService(c);
  if (!service) return unavailable(c);

  const auth = c.get('auth');

  try {
    const client = (service as unknown as { client: any }).client;
    const reachable =
      client && typeof client.verifyConnectivity === 'function'
        ? await client.verifyConnectivity()
        : false;

    if (!reachable) {
      return c.json(
        {
          success: true,
          data: {
            reachable: false,
            lastSyncedAt: null,
            nodeCount: {},
            relationshipCount: 0,
          },
        },
        200,
      );
    }

    const stats = await service.getGraphStats(auth.tenantId);
    return c.json({
      success: true,
      data: {
        reachable: true,
        lastSyncedAt: stats.lastSyncedAt,
        nodeCount: stats.nodeCount,
        relationshipCount: stats.relationshipCount,
      },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'GRAPH_HEALTH_FAILED',
      status: 500,
      fallback: 'Graph health probe failed',
    });
  }
});

// Nest the admin-only health sub-router so its role guard runs in place
// of the broader router's guard. Hono's `route()` composes middleware
// on the mount path, so `GET /health` hits `adminOnly` middleware only.
app.route('/health', adminOnly);

export default app;
