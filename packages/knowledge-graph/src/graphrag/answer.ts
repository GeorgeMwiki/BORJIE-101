/**
 * `answerWithKG` — end-to-end GraphRAG pipeline.
 *
 * Pipeline (Microsoft GraphRAG + LightRAG dual-level retrieval):
 *   1. Hybrid retrieval: find seed nodes via vector similarity,
 *      expand each by 1-2 hops.
 *   2. Detect communities within the union of retrieved subgraphs.
 *   3. Summarise each community via the brain port.
 *   4. Ask the brain to answer the question with the community
 *      summaries + the per-fact citation paths.
 *
 * Returns an `AnswerWithKG` with the natural-language answer plus
 * machine-readable citation paths so callers can render footnotes
 * pointing to exact KG facts.
 */

import type {
  AnswerWithKG,
  CitationPath,
  CommunitySummary,
  KGBrainPort,
  KGEmbedderPort,
  KGStorePort,
  Path,
  Subgraph,
} from '../types.js';
import { findRelevant } from '../embeddings/hybrid-search.js';
import { detectCommunities, summarizeCommunity } from './community.js';

export interface AnswerWithKGArgs {
  readonly question: string;
  readonly tenantId: string;
  readonly store: KGStorePort;
  readonly embedder: KGEmbedderPort;
  readonly brain: KGBrainPort;
  /** Top-K seeds for hybrid retrieval. Default 5. */
  readonly topK?: number;
  /** Max hops per seed. Default 2. */
  readonly maxHops?: number;
  /** Optional seed class allow-list. */
  readonly seedClasses?: ReadonlyArray<string>;
  /** Maximum communities to summarise. Default 4. */
  readonly maxCommunities?: number;
}

function unionSubgraphs(
  subs: ReadonlyArray<Subgraph>,
  tenantId: string,
): Subgraph {
  const nodes = new Map<string, Subgraph['nodes'][number]>();
  const edges = new Map<string, Subgraph['edges'][number]>();
  for (const s of subs) {
    for (const n of s.nodes) nodes.set(n.id, n);
    for (const e of s.edges) edges.set(e.id, e);
  }
  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    tenantId,
  };
}

function buildCitationPaths(
  retrieved: ReadonlyArray<{
    readonly subgraph: Subgraph;
    readonly seedNodeId: string;
  }>,
): ReadonlyArray<CitationPath> {
  return retrieved.map((r) => {
    const nodeIds = r.subgraph.nodes.map((n) => n.id);
    const edgeIds = r.subgraph.edges.map((e) => e.id);
    const path: Path = {
      nodeIds,
      edgeIds,
      hops: Math.max(0, nodeIds.length - 1),
    };
    const nodeById = new Map(r.subgraph.nodes.map((n) => [n.id, n]));
    const facts: string[] = [];
    for (const n of r.subgraph.nodes.slice(0, 6)) {
      facts.push(`${n.class}#${n.id}`);
    }
    for (const e of r.subgraph.edges.slice(0, 6)) {
      const fc = nodeById.get(e.fromId)?.class ?? '?';
      const tc = nodeById.get(e.toId)?.class ?? '?';
      facts.push(`${fc}#${e.fromId} --[${e.label}]--> ${tc}#${e.toId}`);
    }
    return { path, facts };
  });
}

export async function answerWithKG(
  args: AnswerWithKGArgs,
): Promise<AnswerWithKG> {
  if (!args.tenantId) {
    throw new Error('answerWithKG: tenantId is required');
  }
  if (!args.question || args.question.trim().length === 0) {
    throw new Error('answerWithKG: question is required');
  }

  // 1. Hybrid retrieval
  const retrievalArgs = {
    question: args.question,
    tenantId: args.tenantId,
    store: args.store,
    embedder: args.embedder,
    topK: args.topK ?? 5,
    maxHops: args.maxHops ?? 2,
    ...(args.seedClasses ? { seedClasses: args.seedClasses } : {}),
  };
  const retrieved = await findRelevant(retrievalArgs);

  // Citations from the raw retrieval (preserve seed→subgraph mapping)
  const citationPaths = buildCitationPaths(retrieved);

  // 2. Union all retrieved subgraphs
  const union = unionSubgraphs(
    retrieved.map((r) => r.subgraph),
    args.tenantId,
  );

  if (union.nodes.length === 0) {
    return {
      question: args.question,
      answer:
        'No knowledge-graph facts matched the question for this tenant.',
      citationPaths: [],
      communities: [],
    };
  }

  // 3. Detect + summarise communities
  const detected = detectCommunities(union);
  const maxC = args.maxCommunities ?? 4;
  const limited = detected.slice(0, maxC);
  const nodeById = new Map(union.nodes.map((n) => [n.id, n]));
  const communitySummaries: CommunitySummary[] = [];
  for (const comm of limited) {
    const commNodes = comm.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is Subgraph['nodes'][number] => n !== undefined);
    const commNodeIds = new Set(comm.nodeIds);
    const commEdges = union.edges.filter(
      (e) => commNodeIds.has(e.fromId) && commNodeIds.has(e.toId),
    );
    const commSub: Subgraph = {
      nodes: commNodes,
      edges: commEdges,
      tenantId: args.tenantId,
    };
    const summary = await summarizeCommunity({
      subgraph: commSub,
      brain: args.brain,
    });
    communitySummaries.push(summary);
  }

  // 4. Final answer
  const context = communitySummaries.map(
    (s) => `[${s.communityId}] ${s.summary}`,
  );
  const answer = await args.brain.answer({
    question: args.question,
    context,
  });

  return {
    question: args.question,
    answer,
    citationPaths,
    communities: communitySummaries,
  };
}
