/**
 * @borjie/org-graph — traverse.
 *
 * Recursive-CTE traversal helpers. The graph is small (≤100k edges per
 * tenant; 3-hop traversal bounded), so we ride Postgres recursive CTEs
 * over a flat edges table rather than introducing a graph DB.
 *
 * Two surfaces:
 *
 *   - A **port** (`GraphTraversalPort`) that returns generic hop results.
 *     Implementations live in the api-gateway composition root over
 *     Drizzle/`postgres-js`. The package owns the SQL templates only.
 *
 *   - **Pure** helpers (`bfs`, `findAllReachableInMemory`) that operate
 *     over an in-memory edge set — used by tests and by callers that
 *     already hold the edges in hand.
 *
 * All traversal is **bounded by tenant_id**: every SQL template injects
 * the tenant predicate at every step so RLS need not be the only
 * line of defence. The port also expects the GUC to be bound; both
 * paths must agree on the tenant to read anything.
 */

import type { EdgeType, GraphHop, MaterializedPath, OrgGraphEdge } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Port — wire to a Drizzle / postgres-js executor in the api-gateway.
// ─────────────────────────────────────────────────────────────────────

export interface GraphTraversalPort {
  /**
   * Return all ancestors of `entityId` walking `edgeType` upward up
   * to `maxHops` edges.
   *
   *   For `reports_to`: returns the person's chain of managers.
   *   For `managed_by`: returns the asset's responsible-persons chain.
   *
   * `valid_to IS NULL` is implied (current only).
   */
  findAncestors(args: {
    readonly tenantId: string;
    readonly entityId: string;
    readonly edgeType: EdgeType;
    readonly maxHops: number;
  }): Promise<ReadonlyArray<GraphHop>>;

  /**
   * Return all descendants of `entityId` walking `edgeType` downward.
   *
   *   For `subdivides`: returns the parent's children / grandchildren.
   *   For `managed_by` (reversed): all assets a person manages.
   */
  findDescendants(args: {
    readonly tenantId: string;
    readonly entityId: string;
    readonly edgeType: EdgeType;
    readonly maxHops: number;
  }): Promise<ReadonlyArray<GraphHop>>;

  /**
   * Find the shortest path between two entities — used to render
   * "why is this here?" cards in the brief UI.
   *
   * Returns `null` if no path exists within `maxHops`.
   */
  findShortestPath(args: {
    readonly tenantId: string;
    readonly fromEntityId: string;
    readonly toEntityId: string;
    readonly edgeTypes: ReadonlyArray<EdgeType>;
    readonly maxHops: number;
  }): Promise<MaterializedPath | null>;

  /**
   * All entities reachable from `entityId` within `maxHops`,
   * restricted to the given edge types. Used by the brief engine to
   * scope retrieval to the org subtree the executive is responsible for.
   */
  findAllReachable(args: {
    readonly tenantId: string;
    readonly entityId: string;
    readonly edgeTypes: ReadonlyArray<EdgeType>;
    readonly maxHops: number;
  }): Promise<ReadonlyArray<GraphHop>>;
}

// ─────────────────────────────────────────────────────────────────────
// SQL templates — owned by the package so the api-gateway composition
// only wires an executor; the actual recursive CTE shape stays here.
// ─────────────────────────────────────────────────────────────────────

/** Default max hops if the caller doesn't specify. */
export const DEFAULT_MAX_HOPS = 3;

/**
 * Returns a recursive CTE that walks `edge_type` outward from
 * `entityId`. Used by both findAncestors (direction = 'forward') and
 * findDescendants (direction = 'reverse').
 *
 * direction='forward': follow src → dst edges.
 * direction='reverse': follow dst → src edges (treat src/dst inversely).
 *
 * The template uses parameter placeholders ($1..$5) for the executor
 * to bind: tenantId, startEntityId, edgeType, maxHops.
 */
export function buildTraversalCte(direction: 'forward' | 'reverse'): string {
  const seedExpr =
    direction === 'forward'
      ? 'e.dst_entity_id'
      : 'e.src_entity_id';
  const seedFilterExpr =
    direction === 'forward'
      ? 'e.src_entity_id = $2'
      : 'e.dst_entity_id = $2';
  const stepFromExpr =
    direction === 'forward'
      ? 'c.entity_id = e.src_entity_id'
      : 'c.entity_id = e.dst_entity_id';
  const stepToExpr =
    direction === 'forward'
      ? 'e.dst_entity_id'
      : 'e.src_entity_id';

  return `
    WITH RECURSIVE chain AS (
      SELECT
        ${seedExpr}        AS entity_id,
        e.edge_type        AS edge_type,
        1                  AS depth,
        ARRAY[e.id]::text[] AS path
      FROM org_graph_edges e
      WHERE e.tenant_id = $1
        AND e.edge_type = $3
        AND e.valid_to IS NULL
        AND ${seedFilterExpr}

      UNION ALL

      SELECT
        ${stepToExpr}      AS entity_id,
        e.edge_type        AS edge_type,
        c.depth + 1        AS depth,
        c.path || e.id     AS path
      FROM chain c
      JOIN org_graph_edges e
        ON e.tenant_id = $1
       AND e.edge_type = $3
       AND e.valid_to IS NULL
       AND ${stepFromExpr}
      WHERE c.depth < $4
        AND NOT (e.id = ANY(c.path)) -- prevent cycles
    )
    SELECT entity_id, edge_type, depth, path
    FROM chain
    ORDER BY depth ASC, entity_id ASC
  `;
}

/**
 * Shortest-path CTE template across multiple edge types. The executor
 * binds tenantId, fromEntityId, toEntityId, edgeTypes[], maxHops.
 *
 * Returns rows ordered by depth ascending so the caller picks the
 * first (shortest) match.
 */
export function buildShortestPathCte(): string {
  return `
    WITH RECURSIVE chain AS (
      SELECT
        e.dst_entity_id    AS entity_id,
        ARRAY[e.id]::text[] AS path,
        1                  AS depth
      FROM org_graph_edges e
      WHERE e.tenant_id = $1
        AND e.src_entity_id = $2
        AND e.edge_type = ANY($4::text[])
        AND e.valid_to IS NULL

      UNION ALL

      SELECT
        e.dst_entity_id    AS entity_id,
        c.path || e.id     AS path,
        c.depth + 1        AS depth
      FROM chain c
      JOIN org_graph_edges e
        ON e.tenant_id = $1
       AND e.src_entity_id = c.entity_id
       AND e.edge_type = ANY($4::text[])
       AND e.valid_to IS NULL
      WHERE c.depth < $5
        AND NOT (e.id = ANY(c.path))
    )
    SELECT entity_id, depth, path
    FROM chain
    WHERE entity_id = $3
    ORDER BY depth ASC
    LIMIT 1
  `;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory traversal — pure, used by tests and by callers that hold
// edges in hand (e.g. cached brief retrieval).
// ─────────────────────────────────────────────────────────────────────

/**
 * Breadth-first search over an in-memory edge set. Returns all
 * reachable nodes within `maxHops`, deduplicated by entity id (first
 * occurrence kept).
 *
 * Pure — no I/O. Tenant filtering is the caller's responsibility (pass
 * already-tenant-scoped edges).
 */
export function bfs(args: {
  readonly edges: ReadonlyArray<OrgGraphEdge>;
  readonly startEntityId: string;
  readonly edgeTypes: ReadonlyArray<EdgeType>;
  readonly maxHops: number;
  readonly direction?: 'forward' | 'reverse';
}): ReadonlyArray<GraphHop> {
  const direction = args.direction ?? 'forward';
  const edgeTypeSet = new Set<string>(args.edgeTypes);
  // Index edges by src (forward) or dst (reverse) for O(1) neighbour lookup.
  const adjacency = new Map<string, OrgGraphEdge[]>();
  for (const e of args.edges) {
    if (!edgeTypeSet.has(e.edgeType)) continue;
    if (e.validTo !== null) continue; // current only
    const key = direction === 'forward' ? e.srcEntityId : e.dstEntityId;
    const list = adjacency.get(key);
    if (list) {
      list.push(e);
    } else {
      adjacency.set(key, [e]);
    }
  }

  const visited = new Set<string>([args.startEntityId]);
  const results: GraphHop[] = [];
  // FIFO queue with explicit fronts → use array head index to avoid shift().
  const queue: Array<{ entityId: string; depth: number; path: string[] }> = [
    { entityId: args.startEntityId, depth: 0, path: [] },
  ];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head]!;
    head += 1;
    if (node.depth >= args.maxHops) continue;
    const neighbours = adjacency.get(node.entityId) ?? [];
    for (const e of neighbours) {
      const nextId = direction === 'forward' ? e.dstEntityId : e.srcEntityId;
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const hop: GraphHop = {
        entityId: nextId,
        depth: node.depth + 1,
        edgeType: e.edgeType,
        path: [...node.path, e.id],
      };
      results.push(hop);
      queue.push({ entityId: nextId, depth: node.depth + 1, path: hop.path });
    }
  }
  return results;
}

/**
 * Convenience — like `bfs` but returns a deduplicated set of reachable
 * entity ids. Used by the brief engine to scope retrieval.
 */
export function findAllReachableInMemory(args: {
  readonly edges: ReadonlyArray<OrgGraphEdge>;
  readonly startEntityId: string;
  readonly edgeTypes: ReadonlyArray<EdgeType>;
  readonly maxHops: number;
  readonly direction?: 'forward' | 'reverse';
}): ReadonlyArray<string> {
  const hops = bfs(args);
  const out = new Set<string>();
  for (const h of hops) out.add(h.entityId);
  return Array.from(out);
}

/**
 * Find the shortest path between two entities in an in-memory edge
 * set. Returns null if no path within `maxHops`.
 */
export function findShortestPathInMemory(args: {
  readonly edges: ReadonlyArray<OrgGraphEdge>;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly edgeTypes: ReadonlyArray<EdgeType>;
  readonly maxHops: number;
}): MaterializedPath | null {
  // BFS but stop when we hit toEntityId.
  const edgeTypeSet = new Set<string>(args.edgeTypes);
  const adjacency = new Map<string, OrgGraphEdge[]>();
  for (const e of args.edges) {
    if (!edgeTypeSet.has(e.edgeType)) continue;
    if (e.validTo !== null) continue;
    const list = adjacency.get(e.srcEntityId);
    if (list) {
      list.push(e);
    } else {
      adjacency.set(e.srcEntityId, [e]);
    }
  }

  const visited = new Set<string>([args.fromEntityId]);
  const queue: Array<{ entityId: string; depth: number; hops: GraphHop[] }> = [
    { entityId: args.fromEntityId, depth: 0, hops: [] },
  ];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head]!;
    head += 1;
    if (node.entityId === args.toEntityId && node.depth > 0) {
      return {
        fromEntityId: args.fromEntityId,
        toEntityId: args.toEntityId,
        hops: node.hops,
        totalDepth: node.depth,
      };
    }
    if (node.depth >= args.maxHops) continue;
    const neighbours = adjacency.get(node.entityId) ?? [];
    for (const e of neighbours) {
      if (visited.has(e.dstEntityId)) continue;
      visited.add(e.dstEntityId);
      const hop: GraphHop = {
        entityId: e.dstEntityId,
        depth: node.depth + 1,
        edgeType: e.edgeType,
        path: node.hops.flatMap((h) => h.path).concat([e.id]),
      };
      queue.push({
        entityId: e.dstEntityId,
        depth: node.depth + 1,
        hops: [...node.hops, hop],
      });
    }
  }
  return null;
}
