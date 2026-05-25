/**
 * Community detection + summarisation — Microsoft GraphRAG's
 * "hierarchical communities" pattern.
 *
 * Algorithm: connected-component based.
 *   - We use a lightweight UnionFind to identify connected sub-
 *     graphs in O(E * α(N)).
 *   - For LARGER datasets, swap this for Louvain or Leiden; the
 *     port (`detectCommunities`) is the same.
 *
 * Each community gets summarised via the `KGBrainPort.summarize()`
 * call — the brain receives a list of facts and returns a paragraph.
 *
 * In tests we wire a mock brain that just joins the facts.
 */

import type {
  CommunitySummary,
  Edge,
  KGBrainPort,
  Node,
  Subgraph,
} from '../types.js';

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const p = this.parent.get(id);
    if (p === undefined) {
      this.add(id);
      return id;
    }
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rkA = this.rank.get(ra) ?? 0;
    const rkB = this.rank.get(rb) ?? 0;
    if (rkA < rkB) {
      this.parent.set(ra, rb);
    } else if (rkA > rkB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rkA + 1);
    }
  }
}

export function detectCommunities(
  subgraph: Subgraph,
): ReadonlyArray<{
  readonly communityId: string;
  readonly nodeIds: ReadonlyArray<string>;
}> {
  if (subgraph.nodes.length === 0) return [];
  const uf = new UnionFind();
  for (const n of subgraph.nodes) uf.add(n.id);
  for (const e of subgraph.edges) {
    uf.add(e.fromId);
    uf.add(e.toId);
    uf.union(e.fromId, e.toId);
  }
  const groups = new Map<string, string[]>();
  for (const n of subgraph.nodes) {
    const root = uf.find(n.id);
    let arr = groups.get(root);
    if (!arr) {
      arr = [];
      groups.set(root, arr);
    }
    arr.push(n.id);
  }
  // Deterministic order — sort by smallest nodeId in the group.
  const out = Array.from(groups.entries())
    .map(([root, ids]) => {
      const sorted = ids.slice().sort();
      return {
        communityId: `community::${sorted[0] ?? root}`,
        nodeIds: sorted as ReadonlyArray<string>,
      };
    })
    .sort((a, b) => a.communityId.localeCompare(b.communityId));
  return out;
}

export interface SummarizeCommunityArgs {
  readonly subgraph: Subgraph;
  readonly brain: KGBrainPort;
  /** Optional prompt prefix. */
  readonly prompt?: string;
}

function factForNode(node: Node): string {
  const props = Object.entries(node.properties)
    .slice(0, 5) // keep prompts small
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
  return `${node.class}#${node.id} { ${props} }`;
}

function factForEdge(edge: Edge, nodeById: ReadonlyMap<string, Node>): string {
  const fromClass = nodeById.get(edge.fromId)?.class ?? '?';
  const toClass = nodeById.get(edge.toId)?.class ?? '?';
  return `${fromClass}#${edge.fromId} --[${edge.label}]--> ${toClass}#${edge.toId}`;
}

export async function summarizeCommunity(
  args: SummarizeCommunityArgs,
): Promise<CommunitySummary> {
  if (args.subgraph.nodes.length === 0) {
    throw new Error('summarizeCommunity: empty subgraph');
  }
  const nodeById = new Map(args.subgraph.nodes.map((n) => [n.id, n]));
  const facts: string[] = [];
  for (const n of args.subgraph.nodes) facts.push(factForNode(n));
  for (const e of args.subgraph.edges) facts.push(factForEdge(e, nodeById));

  const prompt = args.prompt
    ?? 'Summarise the following knowledge-graph facts in 2 sentences.';
  const summary = await args.brain.summarize({ prompt, facts });

  const classCounts = new Map<string, number>();
  for (const n of args.subgraph.nodes) {
    classCounts.set(n.class, (classCounts.get(n.class) ?? 0) + 1);
  }
  const topClasses = Array.from(classCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0])
    .slice(0, 5);

  const sortedIds = args.subgraph.nodes
    .map((n) => n.id)
    .slice()
    .sort();
  const communityId = `community::${sortedIds[0] ?? 'unknown'}`;

  return {
    communityId,
    nodeIds: sortedIds,
    summary,
    topClasses,
  };
}
