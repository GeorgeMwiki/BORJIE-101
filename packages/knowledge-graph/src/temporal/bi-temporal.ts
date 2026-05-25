/**
 * Bi-temporal facts — every node / edge carries:
 *   - `validFrom`, `validTo` — when the fact is true in the real world
 *   - `recordedAt`           — when we learned about the fact
 *
 * This module exposes:
 *   - `getStateAt(timestamp)` — rebuild a tenant subgraph as it was
 *     known at a given moment.
 *   - `compareStates(t1, t2)` — return the diff between two moments.
 *
 * Why bi-temporal:
 *   - Retroactive correction. We can record today that a tenant moved
 *     out last week without rewriting yesterday's history.
 *   - Audit trail. "What did we believe on the day this contract was
 *     signed?" is answerable.
 *
 * Reference: temporal RDF + bi-temporal LPG patterns (Snodgrass 1999,
 * Allen's interval algebra).
 */

import type {
  Edge,
  KGStorePort,
  Node,
  Subgraph,
  SubgraphDiff,
} from '../types.js';

/**
 * Reconstruct the subgraph state at `timestamp`. A node/edge is
 * present when:
 *   - `recordedAt` ≤ timestamp (or unset)
 *   - `validFrom` ≤ timestamp (or unset)
 *   - `validTo` > timestamp (or unset / null)
 */
export async function getStateAt(args: {
  readonly store: KGStorePort;
  readonly tenantId: string;
  readonly timestamp: string;
}): Promise<Subgraph> {
  if (!args.tenantId) {
    throw new Error('getStateAt: tenantId is required');
  }
  if (!args.timestamp) {
    throw new Error('getStateAt: timestamp is required');
  }
  const ts = new Date(args.timestamp).getTime();
  if (!Number.isFinite(ts)) {
    throw new Error(`getStateAt: invalid timestamp "${args.timestamp}"`);
  }

  const allNodes = await args.store.allNodes(args.tenantId);
  const allEdges = await args.store.allEdges(args.tenantId);

  const liveNodes = allNodes.filter((n) => isLive(n, ts));
  const liveNodeIds = new Set(liveNodes.map((n) => n.id));
  // Edges only survive when (a) the edge itself is live AND (b) both
  // endpoints are live at the same moment.
  const liveEdges = allEdges.filter(
    (e) => isLive(e, ts) && liveNodeIds.has(e.fromId) && liveNodeIds.has(e.toId),
  );

  return { nodes: liveNodes, edges: liveEdges, tenantId: args.tenantId };
}

function isLive(item: Node | Edge, ts: number): boolean {
  if (item.recordedAt) {
    const r = new Date(item.recordedAt).getTime();
    if (Number.isFinite(r) && r > ts) return false;
  }
  if (item.validFrom) {
    const f = new Date(item.validFrom).getTime();
    if (Number.isFinite(f) && f > ts) return false;
  }
  if (item.validTo) {
    const t = new Date(item.validTo).getTime();
    if (Number.isFinite(t) && t <= ts) return false;
  }
  return true;
}

export interface CompareStatesArgs {
  readonly store: KGStorePort;
  readonly tenantId: string;
  readonly t1: string;
  readonly t2: string;
}

export async function compareStates(
  args: CompareStatesArgs,
): Promise<SubgraphDiff> {
  const s1 = await getStateAt({
    store: args.store,
    tenantId: args.tenantId,
    timestamp: args.t1,
  });
  const s2 = await getStateAt({
    store: args.store,
    tenantId: args.tenantId,
    timestamp: args.t2,
  });

  const ids1 = new Set(s1.nodes.map((n) => n.id));
  const ids2 = new Set(s2.nodes.map((n) => n.id));
  const eids1 = new Set(s1.edges.map((e) => e.id));
  const eids2 = new Set(s2.edges.map((e) => e.id));

  const addedNodeIds = Array.from(ids2).filter((id) => !ids1.has(id));
  const removedNodeIds = Array.from(ids1).filter((id) => !ids2.has(id));
  const addedEdgeIds = Array.from(eids2).filter((id) => !eids1.has(id));
  const removedEdgeIds = Array.from(eids1).filter((id) => !eids2.has(id));

  // Detect property changes — same nodeId in both states with
  // different recordedAt OR different properties.
  const nodesById1 = new Map(s1.nodes.map((n) => [n.id, n]));
  const nodesById2 = new Map(s2.nodes.map((n) => [n.id, n]));
  const changedNodeIds: string[] = [];
  for (const id of ids1) {
    if (!ids2.has(id)) continue;
    const n1 = nodesById1.get(id);
    const n2 = nodesById2.get(id);
    if (!n1 || !n2) continue;
    if (!shallowEqualProps(n1.properties, n2.properties)) {
      changedNodeIds.push(id);
    }
  }

  return {
    addedNodeIds: addedNodeIds.sort(),
    removedNodeIds: removedNodeIds.sort(),
    addedEdgeIds: addedEdgeIds.sort(),
    removedEdgeIds: removedEdgeIds.sort(),
    changedNodeIds: changedNodeIds.sort(),
  };
}

function shallowEqualProps(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    const key = ka[i];
    if (key === undefined) continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}
