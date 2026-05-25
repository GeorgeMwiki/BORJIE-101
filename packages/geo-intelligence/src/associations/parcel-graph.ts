/**
 * Parcel association graph.
 *
 * Typed in-memory graph indexed by (kind, id). The constructor takes
 * raw nodes + edges and returns an immutable graph with:
 *
 *   - `getAssociations(parcelId)` — 1-hop subgraph anchored on a parcel
 *   - `traverseFrom({ nodeKind, nodeId, hops, edgeFilter })` — BFS
 *     traversal returning a subgraph
 *   - Bidirectional navigation: from a tenant -> all parcels held;
 *     from a document -> parcel + tenant + lease + ...
 *
 * The graph is undirected for traversal (every edge contributes in both
 * directions); `relation` labels still indicate the meaningful direction.
 */

import type {
  AssociationSubgraph,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  ParcelId,
} from '../types.js';

function nodeKey(node: { readonly kind: GraphNodeKind; readonly id: string }): string {
  return `${node.kind}:${node.id}`;
}

export interface ParcelGraph {
  readonly getNode: (kind: GraphNodeKind, id: string) => GraphNode | null;
  readonly getAssociations: (parcelId: ParcelId) => AssociationSubgraph;
  readonly traverseFrom: (args: {
    readonly nodeKind: GraphNodeKind;
    readonly nodeId: string;
    readonly hops: number;
    readonly edgeFilter?: (edge: GraphEdge) => boolean;
  }) => AssociationSubgraph;
  readonly addNode: (node: GraphNode) => ParcelGraph;
  readonly addEdge: (edge: GraphEdge) => ParcelGraph;
}

interface GraphCore {
  readonly nodes: Map<string, GraphNode>;
  readonly adjacency: Map<string, GraphEdge[]>;
}

function emptyCore(): GraphCore {
  return {
    nodes: new Map<string, GraphNode>(),
    adjacency: new Map<string, GraphEdge[]>(),
  };
}

function indexEdge(core: GraphCore, edge: GraphEdge): void {
  const fromKey = nodeKey(edge.from);
  const toKey = nodeKey(edge.to);
  if (!core.adjacency.has(fromKey)) core.adjacency.set(fromKey, []);
  if (!core.adjacency.has(toKey)) core.adjacency.set(toKey, []);
  (core.adjacency.get(fromKey) as GraphEdge[]).push(edge);
  // Index the reverse edge for undirected traversal.
  (core.adjacency.get(toKey) as GraphEdge[]).push({
    ...edge,
    from: edge.to,
    to: edge.from,
    relation: `inverse_${edge.relation}`,
  });
}

function bfs(
  core: GraphCore,
  start: { readonly kind: GraphNodeKind; readonly id: string },
  hops: number,
  edgeFilter?: (edge: GraphEdge) => boolean,
): AssociationSubgraph {
  const visited = new Set<string>();
  const collectedNodes = new Map<string, GraphNode>();
  const collectedEdges: GraphEdge[] = [];
  const queue: Array<{ readonly key: string; readonly depth: number }> = [];

  const startKey = nodeKey(start);
  visited.add(startKey);
  const startNode = core.nodes.get(startKey);
  if (startNode) collectedNodes.set(startKey, startNode);
  queue.push({ key: startKey, depth: 0 });

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    if (item.depth >= hops) continue;
    const edges = core.adjacency.get(item.key) ?? [];
    for (const edge of edges) {
      if (edgeFilter && !edgeFilter(edge)) continue;
      collectedEdges.push(edge);
      const otherKey = nodeKey(edge.to);
      const otherNode = core.nodes.get(otherKey);
      if (otherNode) collectedNodes.set(otherKey, otherNode);
      if (!visited.has(otherKey)) {
        visited.add(otherKey);
        queue.push({ key: otherKey, depth: item.depth + 1 });
      }
    }
  }
  return Object.freeze({
    nodes: Array.from(collectedNodes.values()),
    edges: collectedEdges,
  });
}

function buildGraph(core: GraphCore): ParcelGraph {
  const frozen = core;
  return Object.freeze({
    getNode(kind: GraphNodeKind, id: string): GraphNode | null {
      return frozen.nodes.get(nodeKey({ kind, id })) ?? null;
    },
    getAssociations(parcelId: ParcelId): AssociationSubgraph {
      return bfs(frozen, { kind: 'parcel', id: parcelId }, 1);
    },
    traverseFrom(args: {
      readonly nodeKind: GraphNodeKind;
      readonly nodeId: string;
      readonly hops: number;
      readonly edgeFilter?: (edge: GraphEdge) => boolean;
    }): AssociationSubgraph {
      return bfs(
        frozen,
        { kind: args.nodeKind, id: args.nodeId },
        args.hops,
        args.edgeFilter,
      );
    },
    addNode(node: GraphNode): ParcelGraph {
      const next: GraphCore = {
        nodes: new Map(frozen.nodes),
        adjacency: new Map(frozen.adjacency),
      };
      next.nodes.set(nodeKey(node), node);
      return buildGraph(next);
    },
    addEdge(edge: GraphEdge): ParcelGraph {
      const next: GraphCore = {
        nodes: new Map(frozen.nodes),
        adjacency: new Map(frozen.adjacency),
      };
      // Ensure endpoint nodes exist.
      const fromKey = nodeKey(edge.from);
      const toKey = nodeKey(edge.to);
      if (!next.nodes.has(fromKey)) next.nodes.set(fromKey, edge.from);
      if (!next.nodes.has(toKey)) next.nodes.set(toKey, edge.to);
      indexEdge(next, edge);
      return buildGraph(next);
    },
  });
}

export function createParcelGraph(args: {
  readonly nodes?: ReadonlyArray<GraphNode>;
  readonly edges?: ReadonlyArray<GraphEdge>;
} = {}): ParcelGraph {
  const core = emptyCore();
  for (const n of args.nodes ?? []) {
    core.nodes.set(nodeKey(n), n);
  }
  for (const e of args.edges ?? []) {
    const fromKey = nodeKey(e.from);
    const toKey = nodeKey(e.to);
    if (!core.nodes.has(fromKey)) core.nodes.set(fromKey, e.from);
    if (!core.nodes.has(toKey)) core.nodes.set(toKey, e.to);
    indexEdge(core, e);
  }
  return buildGraph(core);
}
