/**
 * `createInMemoryStore` — pure JS in-memory KGStorePort.
 *
 * Default store. Suitable for: tests, low-volume tenants, embedded
 * workflows, evals. NOT suitable for: multi-process deployments,
 * persistence, > 100k nodes per tenant.
 *
 * Tenant isolation is enforced by partitioning all maps by tenantId.
 * No query can cross tenants. Immutable updates throughout.
 */

import type {
  Edge,
  GraphQuery,
  KGStorePort,
  Node,
  Subgraph,
} from '../types.js';

interface TenantPartition {
  readonly nodes: Map<string, Node>;
  readonly edges: Map<string, Edge>;
  /** nodeId -> set of outgoing edge IDs */
  readonly outgoing: Map<string, Set<string>>;
  /** nodeId -> set of incoming edge IDs */
  readonly incoming: Map<string, Set<string>>;
}

function emptyPartition(): TenantPartition {
  return {
    nodes: new Map<string, Node>(),
    edges: new Map<string, Edge>(),
    outgoing: new Map<string, Set<string>>(),
    incoming: new Map<string, Set<string>>(),
  };
}

export interface InMemoryStoreOptions {
  /** Optional seed nodes for tests. */
  readonly seedNodes?: ReadonlyArray<Node>;
  /** Optional seed edges. */
  readonly seedEdges?: ReadonlyArray<Edge>;
}

export function createInMemoryStore(opts?: InMemoryStoreOptions): KGStorePort {
  const partitions = new Map<string, TenantPartition>();

  function getPartition(tenantId: string): TenantPartition {
    let p = partitions.get(tenantId);
    if (!p) {
      p = emptyPartition();
      partitions.set(tenantId, p);
    }
    return p;
  }

  function assertTenantId(tid: string): void {
    if (typeof tid !== 'string' || tid.length === 0) {
      throw new Error('KGStorePort: tenantId is required and must be non-empty');
    }
  }

  async function upsertNode(node: Node): Promise<void> {
    assertTenantId(node.tenantId);
    const p = getPartition(node.tenantId);
    p.nodes.set(node.id, node);
    if (!p.outgoing.has(node.id)) p.outgoing.set(node.id, new Set<string>());
    if (!p.incoming.has(node.id)) p.incoming.set(node.id, new Set<string>());
  }

  async function upsertEdge(edge: Edge): Promise<void> {
    assertTenantId(edge.tenantId);
    const p = getPartition(edge.tenantId);
    // Endpoints must exist in same tenant; never auto-create across tenants
    if (!p.nodes.has(edge.fromId)) {
      throw new Error(
        `KGStorePort.upsertEdge: fromId "${edge.fromId}" not found in tenant ${edge.tenantId}`,
      );
    }
    if (!p.nodes.has(edge.toId)) {
      throw new Error(
        `KGStorePort.upsertEdge: toId "${edge.toId}" not found in tenant ${edge.tenantId}`,
      );
    }
    p.edges.set(edge.id, edge);
    let out = p.outgoing.get(edge.fromId);
    if (!out) {
      out = new Set<string>();
      p.outgoing.set(edge.fromId, out);
    }
    out.add(edge.id);
    let inn = p.incoming.get(edge.toId);
    if (!inn) {
      inn = new Set<string>();
      p.incoming.set(edge.toId, inn);
    }
    inn.add(edge.id);
  }

  async function getNode(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<Node | null> {
    assertTenantId(args.tenantId);
    const p = partitions.get(args.tenantId);
    return p?.nodes.get(args.id) ?? null;
  }

  async function getNeighbors(args: {
    readonly tenantId: string;
    readonly nodeId: string;
    readonly edgeLabels?: ReadonlyArray<string>;
    readonly direction?: 'in' | 'out' | 'both';
  }): Promise<Subgraph> {
    assertTenantId(args.tenantId);
    const p = partitions.get(args.tenantId);
    if (!p) return { nodes: [], edges: [], tenantId: args.tenantId };
    const direction = args.direction ?? 'both';
    const labelFilter = args.edgeLabels ? new Set(args.edgeLabels) : null;

    const collectedEdgeIds = new Set<string>();
    if (direction === 'out' || direction === 'both') {
      for (const eid of p.outgoing.get(args.nodeId) ?? []) {
        collectedEdgeIds.add(eid);
      }
    }
    if (direction === 'in' || direction === 'both') {
      for (const eid of p.incoming.get(args.nodeId) ?? []) {
        collectedEdgeIds.add(eid);
      }
    }

    const matchedEdges: Edge[] = [];
    const involvedNodeIds = new Set<string>([args.nodeId]);
    for (const eid of collectedEdgeIds) {
      const e = p.edges.get(eid);
      if (!e) continue;
      if (labelFilter && !labelFilter.has(e.label)) continue;
      matchedEdges.push(e);
      involvedNodeIds.add(e.fromId);
      involvedNodeIds.add(e.toId);
    }
    const nodes = Array.from(involvedNodeIds)
      .map((id) => p.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
    return { nodes, edges: matchedEdges, tenantId: args.tenantId };
  }

  function nodeMatches(
    node: Node,
    classes: ReadonlySet<string> | null,
    props: Readonly<Record<string, unknown>> | undefined,
  ): boolean {
    if (classes && !classes.has(node.class)) return false;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (node.properties[k] !== v) return false;
      }
    }
    return true;
  }

  async function match(query: GraphQuery): Promise<Subgraph> {
    assertTenantId(query.tenantId);
    const p = partitions.get(query.tenantId);
    if (!p) return { nodes: [], edges: [], tenantId: query.tenantId };
    const classes = query.nodeClasses ? new Set(query.nodeClasses) : null;
    const labels = query.edgeLabels ? new Set(query.edgeLabels) : null;

    const seedIds = query.seedNodeIds && query.seedNodeIds.length > 0
      ? new Set(query.seedNodeIds)
      : null;

    const matchedNodes: Node[] = [];
    const matchedNodeIds = new Set<string>();
    for (const n of p.nodes.values()) {
      if (seedIds && !seedIds.has(n.id)) continue;
      if (!nodeMatches(n, classes, query.nodeProperties)) continue;
      matchedNodes.push(n);
      matchedNodeIds.add(n.id);
    }

    // BFS expansion up to maxHops
    const maxHops = query.maxHops ?? 0;
    if (maxHops > 0) {
      let frontier = new Set<string>(matchedNodeIds);
      for (let hop = 0; hop < maxHops; hop++) {
        const next = new Set<string>();
        for (const nid of frontier) {
          for (const eid of [
            ...(p.outgoing.get(nid) ?? []),
            ...(p.incoming.get(nid) ?? []),
          ]) {
            const e = p.edges.get(eid);
            if (!e) continue;
            if (labels && !labels.has(e.label)) continue;
            const otherId = e.fromId === nid ? e.toId : e.fromId;
            if (!matchedNodeIds.has(otherId)) {
              next.add(otherId);
              matchedNodeIds.add(otherId);
              const otherNode = p.nodes.get(otherId);
              if (otherNode) matchedNodes.push(otherNode);
            }
          }
        }
        frontier = next;
        if (frontier.size === 0) break;
      }
    }

    // Collect edges where both endpoints are in matchedNodeIds
    const matchedEdges: Edge[] = [];
    for (const e of p.edges.values()) {
      if (!matchedNodeIds.has(e.fromId) || !matchedNodeIds.has(e.toId)) {
        continue;
      }
      if (labels && !labels.has(e.label)) continue;
      matchedEdges.push(e);
    }

    return {
      nodes: matchedNodes,
      edges: matchedEdges,
      tenantId: query.tenantId,
    };
  }

  async function allNodes(tenantId: string): Promise<ReadonlyArray<Node>> {
    assertTenantId(tenantId);
    const p = partitions.get(tenantId);
    return p ? Array.from(p.nodes.values()) : [];
  }

  async function allEdges(tenantId: string): Promise<ReadonlyArray<Edge>> {
    assertTenantId(tenantId);
    const p = partitions.get(tenantId);
    return p ? Array.from(p.edges.values()) : [];
  }

  // Seed
  if (opts?.seedNodes) {
    for (const n of opts.seedNodes) {
      // direct seed — bypasses async (we're in constructor)
      const p = getPartition(n.tenantId);
      p.nodes.set(n.id, n);
      if (!p.outgoing.has(n.id)) p.outgoing.set(n.id, new Set<string>());
      if (!p.incoming.has(n.id)) p.incoming.set(n.id, new Set<string>());
    }
  }
  if (opts?.seedEdges) {
    for (const e of opts.seedEdges) {
      const p = getPartition(e.tenantId);
      if (!p.nodes.has(e.fromId) || !p.nodes.has(e.toId)) {
        throw new Error(
          `createInMemoryStore.seed: edge "${e.id}" references missing node`,
        );
      }
      p.edges.set(e.id, e);
      let out = p.outgoing.get(e.fromId);
      if (!out) {
        out = new Set<string>();
        p.outgoing.set(e.fromId, out);
      }
      out.add(e.id);
      let inn = p.incoming.get(e.toId);
      if (!inn) {
        inn = new Set<string>();
        p.incoming.set(e.toId, inn);
      }
      inn.add(e.id);
    }
  }

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
