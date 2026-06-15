/**
 * Postgres-backed `KGStorePort` — the REAL durable graph store that makes
 * `@borjie/knowledge-graph` production-grade (no Neo4j, no external graph DB).
 *
 * Implements the SAME store port the package's in-memory default + (stub)
 * Neo4j/Kuzu adapters satisfy — `upsertNode` / `upsertEdge` / `getNode` /
 * `getNeighbors` / `match` / `allNodes` / `allEdges` — over the `kg_nodes` +
 * `kg_edges` tables (migration 0298). Every operation is tenant-scoped:
 *
 *   - Defence-in-depth: every query carries an explicit
 *     `WHERE tenant_id = ${tenantId}` predicate.
 *   - RLS: both tables FORCE row-level security on the canonical
 *     `app.current_tenant_id` GUC. Callers run inside `databaseMiddleware`
 *     (pins the GUC) OR `withTenantContext` (binds it per-tx) so the policy
 *     also filters every row server-side.
 *
 * The package's `Node`/`Edge` shape is validated with the package's own zod
 * schemas (`NodeSchema` / `EdgeSchema`) on the write path — no fabricated data
 * is ever persisted. `props` round-trips the `properties` bag; `entity_ref` /
 * `kind` are mirrored onto node ids so the GraphRAG layer can resolve a node
 * back to a citable source row.
 *
 * Embeddings: this adapter NEVER computes an embedding. The ingestion layer
 * may write a node whose `embedding` is a COPY of an existing
 * `intelligence_corpus_chunks` vector (see ingest.ts) — but that is plain SQL,
 * not a model call. The store port has no embed method.
 *
 * Companion to:
 *   - packages/knowledge-graph (KGStorePort it satisfies)
 *   - packages/database/src/migrations/0298_knowledge_graph.sql
 *   - services/api-gateway/src/composition/knowledge-graph/ingest.ts
 */

import { sql } from 'drizzle-orm';
import {
  EdgeSchema,
  NodeSchema,
  type Edge,
  type GraphQuery,
  type KGStorePort,
  type Node,
  type Subgraph,
} from '@borjie/knowledge-graph';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('postgres-kg-store');

/**
 * Minimal seam over the Drizzle/postgres-js client — only `.execute(sql\`\`)`
 * is required. Matches the seam every other raw-SQL repository in this tree
 * uses (org-team-repository, scenario-repository, …). A pinned-connection
 * route handle (`c.get('db')`) or a `withTenantContext` tx both satisfy it.
 */
export interface KgDbExec {
  execute(query: unknown): Promise<unknown>;
}

// ── row shapes (snake_case as the DB returns them) ──────────────────────────

interface NodeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: string;
  readonly entity_ref: string;
  readonly label: string;
  readonly props: Record<string, unknown> | null;
}

interface EdgeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly src_node_id: string;
  readonly dst_node_id: string;
  readonly relation: string;
  readonly weight: number | string | null;
  readonly props: Record<string, unknown> | null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

function assertTenantId(tid: string): void {
  if (typeof tid !== 'string' || tid.length === 0) {
    throw new Error('KGStorePort(pg): tenantId is required and must be non-empty');
  }
}

/**
 * Build an `ARRAY['a','b']::text[]` SQL fragment for an `= ANY(...)` predicate.
 *
 * A bare `ANY(${jsArray})` makes drizzle SPREAD the array into a record
 * constructor `ANY(($1, $2))` (and `ANY(())` when empty) which PostgreSQL
 * rejects. The explicit ARRAY constructor binds each element as its own
 * param and is empty-safe (`ARRAY[]::text[]`).
 */
function textArray(xs: ReadonlyArray<string>) {
  return sql`ARRAY[${sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  )}]::text[]`;
}

/** Postgres jsonb may arrive already-parsed (object) or as a string. */
function asProps(raw: Record<string, unknown> | null | string): Readonly<Record<string, unknown>> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    class: row.kind,
    tenantId: row.tenant_id,
    properties: asProps(row.props),
  };
}

function rowToEdge(row: EdgeRow): Edge {
  const props = { ...asProps(row.props) };
  // Surface the stored weight in the edge properties (the port's Edge has no
  // first-class weight field; GraphRAG ranking reads it from properties).
  const weight =
    typeof row.weight === 'string' ? Number(row.weight) : (row.weight ?? 1);
  if (Number.isFinite(weight)) props.weight = weight;
  return {
    id: row.id,
    fromId: row.src_node_id,
    toId: row.dst_node_id,
    label: row.relation,
    tenantId: row.tenant_id,
    properties: props,
  };
}

/**
 * Derive `(kind, entity_ref)` for the unique upsert key. Node ids minted by
 * ingestion are deterministic slugs of the form `<kind>:<entityRef>`; the
 * `class` carries the kind. We prefer the explicit class for `kind` and split
 * the id once on the first `:` to recover the entity_ref, falling back to the
 * whole id when there is no separator.
 */
function deriveKeyParts(node: Node): { kind: string; entityRef: string } {
  const sep = node.id.indexOf(':');
  const entityRef = sep >= 0 ? node.id.slice(sep + 1) : node.id;
  return { kind: node.class, entityRef };
}

// ── factory ─────────────────────────────────────────────────────────────────

/**
 * Build a Postgres-backed `KGStorePort` bound to a tenant-pinned db handle.
 *
 * Pass the request's pinned `c.get('db')` (databaseMiddleware) or a
 * `withTenantContext` tx — both have the tenant GUC bound so RLS applies.
 * The explicit per-query tenant predicate is belt-and-braces on top.
 */
export function createPostgresKgStore(db: KgDbExec): KGStorePort {
  async function upsertNode(node: Node): Promise<void> {
    assertTenantId(node.tenantId);
    // Validate against the package's own contract — never persist a malformed
    // node (evidence-required: ids/refs must be real).
    NodeSchema.parse(node);
    const { kind, entityRef } = deriveKeyParts(node);
    const label =
      typeof node.properties.label === 'string'
        ? node.properties.label
        : typeof node.properties.name === 'string'
          ? node.properties.name
          : '';
    const propsJson = JSON.stringify(node.properties ?? {});
    await db.execute(sql`
      INSERT INTO kg_nodes (id, tenant_id, kind, entity_ref, label, props, updated_at)
      VALUES (
        ${node.id}, ${node.tenantId}, ${kind}, ${entityRef}, ${label},
        ${propsJson}::jsonb, now()
      )
      ON CONFLICT (tenant_id, kind, entity_ref) DO UPDATE
        SET label = EXCLUDED.label,
            props = EXCLUDED.props,
            updated_at = now()
    `);
  }

  async function upsertEdge(edge: Edge): Promise<void> {
    assertTenantId(edge.tenantId);
    EdgeSchema.parse(edge);
    const weight =
      typeof edge.properties.weight === 'number' &&
      Number.isFinite(edge.properties.weight)
        ? edge.properties.weight
        : 1;
    const propsJson = JSON.stringify(edge.properties ?? {});
    // Endpoints must exist in the SAME tenant; the FK + RLS enforce this, but
    // we guard explicitly so a missing endpoint surfaces a clear error rather
    // than an opaque FK violation.
    const exists = extractRows<{ n: number }>(
      await db.execute(sql`
        SELECT count(*)::int AS n
          FROM kg_nodes
         WHERE tenant_id = ${edge.tenantId}
           AND id IN (${edge.fromId}, ${edge.toId})
      `),
    );
    if ((exists[0]?.n ?? 0) < 2) {
      throw new Error(
        `KGStorePort(pg).upsertEdge: both endpoints must exist in tenant ${edge.tenantId} (from=${edge.fromId} to=${edge.toId})`,
      );
    }
    await db.execute(sql`
      INSERT INTO kg_edges (id, tenant_id, src_node_id, dst_node_id, relation, weight, props, updated_at)
      VALUES (
        ${edge.id}, ${edge.tenantId}, ${edge.fromId}, ${edge.toId},
        ${edge.label}, ${weight}, ${propsJson}::jsonb, now()
      )
      ON CONFLICT (tenant_id, src_node_id, dst_node_id, relation) DO UPDATE
        SET weight = EXCLUDED.weight,
            props = EXCLUDED.props,
            updated_at = now()
    `);
  }

  async function getNode(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<Node | null> {
    assertTenantId(args.tenantId);
    const rows = extractRows<NodeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, kind, entity_ref, label, props
          FROM kg_nodes
         WHERE tenant_id = ${args.tenantId} AND id = ${args.id}
         LIMIT 1
      `),
    );
    const row = rows[0];
    return row ? rowToNode(row) : null;
  }

  async function getNeighbors(args: {
    readonly tenantId: string;
    readonly nodeId: string;
    readonly edgeLabels?: ReadonlyArray<string>;
    readonly direction?: 'in' | 'out' | 'both';
  }): Promise<Subgraph> {
    assertTenantId(args.tenantId);
    const direction = args.direction ?? 'both';
    const wantOut = direction === 'out' || direction === 'both';
    const wantIn = direction === 'in' || direction === 'both';
    const labels =
      args.edgeLabels && args.edgeLabels.length > 0 ? args.edgeLabels : null;
    const labelPred = labels
      ? sql`AND relation = ANY(${textArray(labels)})`
      : sql``;
    // Collect edges touching the node in the requested direction(s).
    const dirPred = wantOut && wantIn
      ? sql`(src_node_id = ${args.nodeId} OR dst_node_id = ${args.nodeId})`
      : wantOut
        ? sql`src_node_id = ${args.nodeId}`
        : sql`dst_node_id = ${args.nodeId}`;
    const edgeRows = extractRows<EdgeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, src_node_id, dst_node_id, relation, weight, props
          FROM kg_edges
         WHERE tenant_id = ${args.tenantId}
           AND ${dirPred}
           ${labelPred}
      `),
    );
    const edges = edgeRows.map(rowToEdge);
    const nodeIds = new Set<string>([args.nodeId]);
    for (const e of edges) {
      nodeIds.add(e.fromId);
      nodeIds.add(e.toId);
    }
    const nodes = await hydrateNodes(args.tenantId, Array.from(nodeIds));
    return { nodes, edges, tenantId: args.tenantId };
  }

  async function match(query: GraphQuery): Promise<Subgraph> {
    assertTenantId(query.tenantId);
    const classes =
      query.nodeClasses && query.nodeClasses.length > 0 ? query.nodeClasses : null;
    const seeds =
      query.seedNodeIds && query.seedNodeIds.length > 0 ? query.seedNodeIds : null;
    const classPred = classes ? sql`AND kind = ANY(${textArray(classes)})` : sql``;
    const seedPred = seeds ? sql`AND id = ANY(${textArray(seeds)})` : sql``;

    const seedRows = extractRows<NodeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, kind, entity_ref, label, props
          FROM kg_nodes
         WHERE tenant_id = ${query.tenantId}
           ${classPred}
           ${seedPred}
      `),
    );
    // Apply node-property filters in app code (jsonb @> would need careful
    // typing; the seed set is already class/seed-narrowed and small).
    const propFilter = query.nodeProperties;
    const matchedNodes = seedRows
      .map(rowToNode)
      .filter((n) =>
        propFilter
          ? Object.entries(propFilter).every(([k, v]) => n.properties[k] === v)
          : true,
      );

    const matchedNodeIds = new Set<string>(matchedNodes.map((n) => n.id));
    const labels =
      query.edgeLabels && query.edgeLabels.length > 0 ? query.edgeLabels : null;

    // BFS expansion up to maxHops, honouring the edge-label allow-list.
    const maxHops = query.maxHops ?? 0;
    let frontier = new Set<string>(matchedNodeIds);
    for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
      const next = new Set<string>();
      // eslint-disable-next-line no-await-in-loop
      const hopEdges = await edgesTouching(query.tenantId, Array.from(frontier), labels);
      for (const e of hopEdges) {
        for (const other of [e.fromId, e.toId]) {
          if (!matchedNodeIds.has(other)) {
            matchedNodeIds.add(other);
            next.add(other);
          }
        }
      }
      frontier = next;
    }

    const allNodesHydrated = await hydrateNodes(
      query.tenantId,
      Array.from(matchedNodeIds),
    );
    // Edges where BOTH endpoints are in the matched set (honour label filter).
    const edges = await edgesWithin(query.tenantId, Array.from(matchedNodeIds), labels);
    return { nodes: allNodesHydrated, edges, tenantId: query.tenantId };
  }

  async function allNodes(tenantId: string): Promise<ReadonlyArray<Node>> {
    assertTenantId(tenantId);
    const rows = extractRows<NodeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, kind, entity_ref, label, props
          FROM kg_nodes
         WHERE tenant_id = ${tenantId}
      `),
    );
    return rows.map(rowToNode);
  }

  async function allEdges(tenantId: string): Promise<ReadonlyArray<Edge>> {
    assertTenantId(tenantId);
    const rows = extractRows<EdgeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, src_node_id, dst_node_id, relation, weight, props
          FROM kg_edges
         WHERE tenant_id = ${tenantId}
      `),
    );
    return rows.map(rowToEdge);
  }

  // ── internal helpers (tenant-scoped) ──────────────────────────────────────

  async function hydrateNodes(
    tenantId: string,
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Node>> {
    if (ids.length === 0) return [];
    const rows = extractRows<NodeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, kind, entity_ref, label, props
          FROM kg_nodes
         WHERE tenant_id = ${tenantId} AND id = ANY(${textArray([...ids])})
      `),
    );
    return rows.map(rowToNode);
  }

  async function edgesTouching(
    tenantId: string,
    nodeIds: ReadonlyArray<string>,
    labels: ReadonlyArray<string> | null,
  ): Promise<ReadonlyArray<Edge>> {
    if (nodeIds.length === 0) return [];
    const labelPred = labels ? sql`AND relation = ANY(${textArray(labels)})` : sql``;
    const nodeIdArr = textArray([...nodeIds]);
    const rows = extractRows<EdgeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, src_node_id, dst_node_id, relation, weight, props
          FROM kg_edges
         WHERE tenant_id = ${tenantId}
           AND (src_node_id = ANY(${nodeIdArr}) OR dst_node_id = ANY(${nodeIdArr}))
           ${labelPred}
      `),
    );
    return rows.map(rowToEdge);
  }

  async function edgesWithin(
    tenantId: string,
    nodeIds: ReadonlyArray<string>,
    labels: ReadonlyArray<string> | null,
  ): Promise<ReadonlyArray<Edge>> {
    if (nodeIds.length === 0) return [];
    const labelPred = labels ? sql`AND relation = ANY(${textArray(labels)})` : sql``;
    const nodeIdArr = textArray([...nodeIds]);
    const rows = extractRows<EdgeRow>(
      await db.execute(sql`
        SELECT id, tenant_id, src_node_id, dst_node_id, relation, weight, props
          FROM kg_edges
         WHERE tenant_id = ${tenantId}
           AND src_node_id = ANY(${nodeIdArr})
           AND dst_node_id = ANY(${nodeIdArr})
           ${labelPred}
      `),
    );
    return rows.map(rowToEdge);
  }

  logger.debug('postgres-kg-store initialised');

  return {
    upsertNode,
    upsertEdge,
    getNode,
    getNeighbors,
    match,
    allNodes,
    allEdges,
  };
}
