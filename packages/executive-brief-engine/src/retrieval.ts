/**
 * @borjie/executive-brief-engine — retrieval.
 *
 * Hybrid retrieval used by the hypothesis-verifier to find supporting
 * evidence for a candidate gap/opportunity/risk:
 *
 *   1. BM25 over `audit_events.tsv` and `core_entity.tsv`.
 *   2. Dense pgvector ANN over `core_entity.embedding`.
 *   3. Graph hops on `org_graph_edges` (max 3 hops by default).
 *   4. MMR rerank to diversify the final set.
 *
 * We DO NOT reimplement BM25 / ANN / MMR — the package owns the
 * orchestration and consumes ports the api-gateway wires to the
 * existing kernel retrieval primitives.
 */

import type { EdgeType, GraphTraversalPort } from '@borjie/org-graph';

// ─────────────────────────────────────────────────────────────────────
// Retrieval result shape — what the engine receives from each retriever.
// ─────────────────────────────────────────────────────────────────────

export interface RetrievalHit {
  readonly id: string;
  readonly kind: 'entity' | 'audit_event' | 'document';
  /** Display text used for MMR similarity + LLM context. */
  readonly snippet: string;
  /** Raw match score in the retriever's own scale. */
  readonly score: number;
  /** Optional vector embedding — used for MMR diversification. NULL for retrievers that don't expose embeddings. */
  readonly embedding?: ReadonlyArray<number>;
  /** Origin marker — which retriever surfaced this hit. */
  readonly source: 'bm25' | 'vector' | 'graph';
}

// ─────────────────────────────────────────────────────────────────────
// Ports — wired in the api-gateway composition over Drizzle.
// ─────────────────────────────────────────────────────────────────────

export interface Bm25RetrieverPort {
  /** BM25 over audit_events.tsv + core_entity.tsv with tenant filter. */
  search(args: {
    readonly tenantId: string;
    readonly query: string;
    readonly limit: number;
    readonly kindFilter?: ReadonlyArray<'entity' | 'audit_event' | 'document'>;
  }): Promise<ReadonlyArray<RetrievalHit>>;
}

export interface VectorRetrieverPort {
  /** Dense ANN over core_entity.embedding (or audit embeddings). */
  search(args: {
    readonly tenantId: string;
    readonly queryEmbedding: ReadonlyArray<number>;
    readonly limit: number;
    readonly kindFilter?: ReadonlyArray<'entity' | 'audit_event' | 'document'>;
  }): Promise<ReadonlyArray<RetrievalHit>>;
}

export interface EmbedderPort {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

export interface MmrRerankerPort {
  /**
   * Reuses the existing kernel MMR primitive (`packages/central-
   * intelligence/src/kernel/memory/` or the ai-copilot memory layer).
   * The package only knows the interface, not the implementation.
   *
   * Returns the top `k` hits maximising relevance + diversity per
   * the classic MMR formula:  λ * rel(i) - (1-λ) * max_j sim(i,j)
   */
  rerank(args: {
    readonly hits: ReadonlyArray<RetrievalHit>;
    readonly query: string;
    readonly queryEmbedding?: ReadonlyArray<number>;
    readonly k: number;
    readonly lambda?: number;
  }): Promise<ReadonlyArray<RetrievalHit>>;
}

export interface HybridRetrieverDeps {
  readonly bm25: Bm25RetrieverPort;
  readonly vector: VectorRetrieverPort;
  readonly embedder: EmbedderPort;
  readonly mmr: MmrRerankerPort;
  readonly graph: GraphTraversalPort;
}

export interface HybridRetrievalArgs {
  readonly tenantId: string;
  readonly query: string;
  /** Optional anchor entities to seed graph traversal from. */
  readonly anchorEntityIds?: ReadonlyArray<string>;
  readonly k?: number;
  /** Edge types to traverse from anchors. Default: leased_to + managed_by + reports_to. */
  readonly graphEdgeTypes?: ReadonlyArray<EdgeType>;
  readonly graphMaxHops?: number;
  /** MMR diversity weight (0 → only diversity, 1 → only relevance). */
  readonly lambda?: number;
}

// ─────────────────────────────────────────────────────────────────────
// hybridRetrieve — the public API.
//
//   1. Embed the query (once).
//   2. Run BM25 + vector in parallel.
//   3. If anchors are provided, expand graph N hops and pull entity hits
//      for any newly-reachable ids.
//   4. Merge, dedup by id, MMR-rerank to k results.
// ─────────────────────────────────────────────────────────────────────

export async function hybridRetrieve(
  deps: HybridRetrieverDeps,
  args: HybridRetrievalArgs,
): Promise<ReadonlyArray<RetrievalHit>> {
  const k = args.k ?? 20;
  const candidateK = Math.max(k * 3, 30);
  const graphMaxHops = args.graphMaxHops ?? 3;
  const graphEdgeTypes: ReadonlyArray<EdgeType> =
    args.graphEdgeTypes ?? ['leased_to', 'managed_by', 'reports_to'];

  // Step 1 — embed the query.
  const queryEmbedding = await safeEmbed(deps.embedder, args.query);

  // Step 2 — bm25 + vector in parallel.
  const [bm25Hits, vectorHits] = await Promise.all([
    safeSearch(() =>
      deps.bm25.search({
        tenantId: args.tenantId,
        query: args.query,
        limit: candidateK,
      }),
    ),
    queryEmbedding
      ? safeSearch(() =>
          deps.vector.search({
            tenantId: args.tenantId,
            queryEmbedding,
            limit: candidateK,
          }),
        )
      : Promise.resolve([] as ReadonlyArray<RetrievalHit>),
  ]);

  // Step 3 — graph expansion from anchors.
  const graphHits: RetrievalHit[] = [];
  if (args.anchorEntityIds && args.anchorEntityIds.length > 0) {
    for (const anchor of args.anchorEntityIds) {
      try {
        const reachable = await deps.graph.findAllReachable({
          tenantId: args.tenantId,
          entityId: anchor,
          edgeTypes: graphEdgeTypes,
          maxHops: graphMaxHops,
        });
        for (const hop of reachable) {
          graphHits.push({
            id: hop.entityId,
            kind: 'entity',
            snippet: `entity:${hop.entityId} (depth=${hop.depth}, via=${hop.edgeType ?? '?'})`,
            score: 1 / (hop.depth + 1),
            source: 'graph',
          });
        }
      } catch {
        // Graph failure is non-fatal — degrade gracefully.
      }
    }
  }

  // Step 4 — merge, dedup, MMR.
  const merged: RetrievalHit[] = [];
  const seen = new Set<string>();
  for (const h of [...bm25Hits, ...vectorHits, ...graphHits]) {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(h);
  }

  if (merged.length === 0) return [];

  const reranked = await safeSearch(() =>
    deps.mmr.rerank({
      hits: merged,
      query: args.query,
      ...(queryEmbedding ? { queryEmbedding } : {}),
      k,
      ...(args.lambda !== undefined ? { lambda: args.lambda } : {}),
    }),
  );

  // If MMR fails we still want a reasonable result — fall back to merge
  // order truncated to k.
  if (reranked.length === 0 && merged.length > 0) {
    return merged.slice(0, k);
  }
  return reranked;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function safeEmbed(
  embedder: EmbedderPort,
  text: string,
): Promise<ReadonlyArray<number> | null> {
  try {
    return await embedder.embed(text);
  } catch {
    return null;
  }
}

async function safeSearch<T>(
  fn: () => Promise<ReadonlyArray<T>>,
): Promise<ReadonlyArray<T>> {
  try {
    return await fn();
  } catch {
    return [];
  }
}
