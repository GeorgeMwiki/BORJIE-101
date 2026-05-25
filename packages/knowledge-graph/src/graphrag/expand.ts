/**
 * `expandFromSeed` — breadth-first subgraph expansion.
 *
 * Given one or more seed node IDs, traverse the graph outwards
 * collecting every reachable node within `depth` hops, optionally
 * filtering edges by label.
 *
 * Implements the "neighbourhood expansion" half of GraphRAG; the
 * "vector retrieval" half lives in `embeddings/hybrid-search.ts`.
 */

import type { Edge, KGStorePort, Node, Subgraph } from '../types.js';

export interface ExpandFromSeedArgs {
  readonly tenantId: string;
  readonly seedNodeIds: ReadonlyArray<string>;
  readonly store: KGStorePort;
  /** Max hops. Default 2. */
  readonly depth?: number;
  /** Optional edge-label allow-list. */
  readonly edgeFilters?: ReadonlyArray<string>;
}

export async function expandFromSeed(
  args: ExpandFromSeedArgs,
): Promise<Subgraph> {
  if (!args.tenantId) {
    throw new Error('expandFromSeed: tenantId is required');
  }
  if (args.seedNodeIds.length === 0) {
    return { nodes: [], edges: [], tenantId: args.tenantId };
  }
  const depth = args.depth ?? 2;
  const labelAllow = args.edgeFilters && args.edgeFilters.length > 0
    ? new Set(args.edgeFilters)
    : null;

  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const visited = new Set<string>();

  // Hydrate seeds
  for (const sid of args.seedNodeIds) {
    const node = await args.store.getNode({ tenantId: args.tenantId, id: sid });
    if (node) {
      nodes.set(sid, node);
      visited.add(sid);
    }
  }

  let frontier: ReadonlySet<string> = new Set(visited);
  for (let h = 0; h < depth; h++) {
    const next = new Set<string>();
    for (const nid of frontier) {
      const sub = await args.store.getNeighbors({
        tenantId: args.tenantId,
        nodeId: nid,
        ...(labelAllow ? { edgeLabels: Array.from(labelAllow) } : {}),
      });
      for (const n of sub.nodes) {
        nodes.set(n.id, n);
        if (!visited.has(n.id)) {
          next.add(n.id);
          visited.add(n.id);
        }
      }
      for (const e of sub.edges) {
        if (labelAllow && !labelAllow.has(e.label)) continue;
        edges.set(e.id, e);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    tenantId: args.tenantId,
  };
}
