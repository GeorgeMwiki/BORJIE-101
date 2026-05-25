/**
 * Hybrid vector + graph retrieval.
 *
 * Combines two retrieval signals (Microsoft GraphRAG + neo4j-graphrag
 * playbook):
 *   1. Vector similarity — embed the question, score each node
 *      against it, take top-K seeds.
 *   2. Graph expansion — expand each seed by ≤ N hops to get a
 *      context subgraph.
 *
 * Returns a list of `RankedSubgraph` sorted by score desc. The caller
 * (typically `answerWithKG`) feeds the top results to the LLM.
 */

import type {
  KGEmbedderPort,
  KGStorePort,
  Node,
  RankedSubgraph,
  Subgraph,
} from '../types.js';
import { cosineSimilarity } from './embedders.js';

export interface FindRelevantArgs {
  readonly question: string;
  readonly tenantId: string;
  readonly store: KGStorePort;
  readonly embedder: KGEmbedderPort;
  /** How many top-scored seed nodes to expand. Default 5. */
  readonly topK?: number;
  /** How many hops to expand from each seed. Default 1. */
  readonly maxHops?: number;
  /** Optional node-class filter — restrict seeds to these classes. */
  readonly seedClasses?: ReadonlyArray<string>;
  /** Optional pre-computed node embeddings keyed by nodeId. */
  readonly nodeEmbeddings?: ReadonlyMap<string, ReadonlyArray<number>>;
}

export async function findRelevant(
  args: FindRelevantArgs,
): Promise<ReadonlyArray<RankedSubgraph>> {
  if (!args.tenantId) {
    throw new Error('findRelevant: tenantId is required');
  }
  if (!args.question || args.question.trim().length === 0) {
    throw new Error('findRelevant: question is required');
  }

  const topK = args.topK ?? 5;
  const maxHops = args.maxHops ?? 1;

  // 1. Embed the question by wrapping it in a synthetic node.
  const questionNode: Node = {
    id: '__query__',
    class: 'Query',
    tenantId: args.tenantId,
    properties: { text: args.question },
  };
  const queryEmbedding = await args.embedder.embedNode({
    node: questionNode,
    neighbors: [],
  });

  // 2. Score all candidate nodes.
  const allNodes = await args.store.allNodes(args.tenantId);
  const candidates = args.seedClasses
    ? allNodes.filter((n) => args.seedClasses!.includes(n.class))
    : allNodes;

  const scored: Array<{ node: Node; score: number }> = [];
  for (const n of candidates) {
    let nodeVec: ReadonlyArray<number> | undefined;
    if (args.nodeEmbeddings) {
      nodeVec = args.nodeEmbeddings.get(n.id);
    }
    if (!nodeVec) {
      const neighbourSub = await args.store.getNeighbors({
        tenantId: args.tenantId,
        nodeId: n.id,
      });
      const neighbours = neighbourSub.nodes.filter((x) => x.id !== n.id);
      const ev = await args.embedder.embedNode({
        node: n,
        neighbors: neighbours,
      });
      nodeVec = ev.vector;
    }
    const score = cosineSimilarity(queryEmbedding.vector, nodeVec);
    scored.push({ node: n, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const seeds = scored.slice(0, topK);

  // 3. Expand each seed.
  const ranked: RankedSubgraph[] = [];
  for (const s of seeds) {
    const sub = await expandFromNode({
      store: args.store,
      tenantId: args.tenantId,
      seedId: s.node.id,
      maxHops,
    });
    ranked.push({ subgraph: sub, score: s.score, seedNodeId: s.node.id });
  }
  return ranked;
}

async function expandFromNode(args: {
  readonly store: KGStorePort;
  readonly tenantId: string;
  readonly seedId: string;
  readonly maxHops: number;
}): Promise<Subgraph> {
  const visited = new Set<string>([args.seedId]);
  const collectedNodes = new Map<string, Node>();
  const collectedEdges = new Map<string, ReturnType<typeof Object>>();
  const seedNode = await args.store.getNode({
    tenantId: args.tenantId,
    id: args.seedId,
  });
  if (!seedNode) {
    return { nodes: [], edges: [], tenantId: args.tenantId };
  }
  collectedNodes.set(seedNode.id, seedNode);

  let frontier: ReadonlySet<string> = new Set([args.seedId]);
  for (let hop = 0; hop < args.maxHops; hop++) {
    const next = new Set<string>();
    for (const nid of frontier) {
      const neigh = await args.store.getNeighbors({
        tenantId: args.tenantId,
        nodeId: nid,
      });
      for (const n of neigh.nodes) {
        collectedNodes.set(n.id, n);
        if (!visited.has(n.id)) {
          next.add(n.id);
          visited.add(n.id);
        }
      }
      for (const e of neigh.edges) {
        collectedEdges.set(e.id, e);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return {
    nodes: Array.from(collectedNodes.values()),
    edges: Array.from(collectedEdges.values()) as ReadonlyArray<
      Awaited<ReturnType<KGStorePort['getNeighbors']>>['edges'][number]
    >,
    tenantId: args.tenantId,
  };
}
