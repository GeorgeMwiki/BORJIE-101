/**
 * Community detection — lightweight Louvain-style modularity-greedy
 * partitioner.
 *
 * v1 ships connected-components + label-propagation as a stable
 * stand-in for Louvain/Leiden. The function signature is the same
 * one Microsoft GraphRAG expects, so a future swap to
 * `graphology-communities-louvain` or `-leiden` is a single-line
 * dependency change.
 *
 * Hierarchy: we produce two levels — fine-grained label-propagation
 * communities at Level 0, and the union of two adjacent Level-0
 * communities (connected by the heaviest cross-community edge) at
 * Level 1. That is enough hierarchy for the router to decide
 * `graph_local` vs `graph_global` without burning Leiden's full cost.
 *
 * Pure / immutable.
 */

import { createHash } from 'node:crypto';
import type {
  Community,
  Id,
  KnowledgeGraph,
} from '../types.js';

interface Adjacency {
  readonly neighbours: ReadonlyMap<Id, ReadonlyArray<{ id: Id; weight: number }>>;
}

function buildAdjacency(graph: KnowledgeGraph): Adjacency {
  const map = new Map<Id, { id: Id; weight: number }[]>();
  for (const n of graph.nodes) map.set(n.id, []);
  for (const e of graph.edges) {
    map.get(e.fromId)?.push({ id: e.toId, weight: e.weight });
    map.get(e.toId)?.push({ id: e.fromId, weight: e.weight });
  }
  return { neighbours: map };
}

/** Stable signature for a community (sha256 of sorted member ids). */
export function signatureHash(memberIds: ReadonlyArray<Id>): string {
  const sorted = [...memberIds].sort();
  return createHash('sha256').update(sorted.join('|')).digest('hex');
}

/**
 * Label propagation — assign each node the label most common among
 * its neighbours, iterating until stable or `maxIter` is reached.
 * Deterministic given the input order.
 */
function labelPropagation(
  graph: KnowledgeGraph,
  adj: Adjacency,
  maxIter: number,
): Map<Id, Id> {
  const labels = new Map<Id, Id>();
  for (const n of graph.nodes) labels.set(n.id, n.id);
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (const n of graph.nodes) {
      const neighbours = adj.neighbours.get(n.id) ?? [];
      if (neighbours.length === 0) continue;
      const counts = new Map<Id, number>();
      for (const nb of neighbours) {
        const lab = labels.get(nb.id);
        if (lab === undefined) continue;
        counts.set(lab, (counts.get(lab) ?? 0) + nb.weight);
      }
      let bestLabel: Id | null = null;
      let bestWeight = -1;
      const sortedEntries = Array.from(counts.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });
      const first = sortedEntries[0];
      if (first !== undefined) {
        bestLabel = first[0];
        bestWeight = first[1];
      }
      if (bestLabel !== null && bestWeight > 0 && labels.get(n.id) !== bestLabel) {
        labels.set(n.id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}

interface DetectArgs {
  readonly tenantId: string;
  readonly graph: KnowledgeGraph;
  readonly maxIter?: number;
}

/**
 * Detect communities at Level 0 (fine) and Level 1 (aggregate). Every
 * returned community has a deterministic id derived from
 * `(tenantId, level, signatureHash)` — the same graph rebuilt always
 * yields the same community ids, so re-runs that find no drift are a
 * no-op.
 */
export function detectCommunities(args: DetectArgs): ReadonlyArray<Community> {
  if (args.graph.nodes.length === 0) return [];
  const adj = buildAdjacency(args.graph);
  const labels = labelPropagation(args.graph, adj, args.maxIter ?? 12);

  // Level 0 — group by label.
  const level0Groups = new Map<Id, Id[]>();
  for (const [nodeId, label] of labels) {
    const arr = level0Groups.get(label) ?? [];
    arr.push(nodeId);
    level0Groups.set(label, arr);
  }
  const level0: Community[] = [];
  for (const [label, members] of level0Groups) {
    const sig = signatureHash(members);
    const id = createHash('sha256')
      .update(`${args.tenantId}|0|${sig}`)
      .digest('hex')
      .slice(0, 32);
    level0.push({
      id,
      level: 0,
      parentCommunityId: null,
      memberEntityIds: [...members].sort(),
      signatureHash: sig,
    });
    // suppress unused label warning
    void label;
  }

  // Level 1 — merge each L0 community with its heaviest-edge neighbour
  // L0 community (only once per pair). Lightweight hierarchy stand-in.
  const labelOf = (nodeId: Id): Id => labels.get(nodeId) ?? nodeId;
  const crossWeights = new Map<string, number>();
  for (const e of args.graph.edges) {
    const a = labelOf(e.fromId);
    const b = labelOf(e.toId);
    if (a === b) continue;
    const pair = [a, b].sort().join('::');
    crossWeights.set(pair, (crossWeights.get(pair) ?? 0) + e.weight);
  }
  const merged = new Set<Id>();
  const level1: Community[] = [];
  const sortedPairs = Array.from(crossWeights.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [pair] of sortedPairs) {
    const [a, b] = pair.split('::') as [Id, Id];
    if (merged.has(a) || merged.has(b)) continue;
    const membersA = level0Groups.get(a) ?? [];
    const membersB = level0Groups.get(b) ?? [];
    const members = [...membersA, ...membersB].sort();
    const sig = signatureHash(members);
    const id = createHash('sha256')
      .update(`${args.tenantId}|1|${sig}`)
      .digest('hex')
      .slice(0, 32);
    level1.push({
      id,
      level: 1,
      parentCommunityId: null,
      memberEntityIds: members,
      signatureHash: sig,
    });
    merged.add(a);
    merged.add(b);
  }
  return [...level0, ...level1];
}
