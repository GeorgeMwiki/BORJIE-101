/**
 * Hybrid retriever — combine vector + graph_local backends and fuse
 * results via reciprocal-rank fusion (RRF, k=60 — the canonical
 * value used in TREC research).
 *
 * RRF formula:
 *
 *   score_fused(chunk) = Σ over backends of 1 / (k + rank(chunk))
 *
 * RRF is rank-only; it does not require the backends to return
 * scores on a comparable scale. That's why it's the production
 * default for hybrid retrieval (see Weaviate / Elastic blog posts
 * cited in the spec).
 */

import type {
  GraphBackendPort,
  QueryContext,
  RetrievalMode,
  RetrievedChunk,
  RouterPort,
  VectorBackendPort,
} from '../types.js';
import { classifyQuery } from './query-classifier.js';

const RRF_K = 60;
const DEFAULT_TOP_K = 10;

interface HybridArgs {
  readonly vector: VectorBackendPort;
  readonly graph: GraphBackendPort;
}

/** Reciprocal-rank fuse two ranked lists, return top-K. */
export function reciprocalRankFuse(
  lists: ReadonlyArray<ReadonlyArray<RetrievedChunk>>,
  topK: number,
): ReadonlyArray<RetrievedChunk> {
  const scores = new Map<string, number>();
  const byId = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      if (c === undefined) continue;
      const prev = scores.get(c.id) ?? 0;
      scores.set(c.id, prev + 1 / (RRF_K + i + 1));
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  const sorted = Array.from(scores.entries())
    .map(([id, fusedScore]) => {
      const base = byId.get(id);
      if (base === undefined) return null;
      const out: RetrievedChunk = { ...base, score: fusedScore };
      return out;
    })
    .filter((x): x is RetrievedChunk => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return sorted;
}

/**
 * Create a `RouterPort` that picks the backend per query and runs it.
 * `mode === 'hybrid'` runs vector + graph_local in parallel and fuses.
 */
export function createRouter(args: HybridArgs): RouterPort {
  const { vector, graph } = args;

  async function dispatchPureMode(
    mode: Exclude<RetrievalMode, 'hybrid'>,
    query: string,
    ctx: QueryContext,
    topK: number,
  ): Promise<ReadonlyArray<RetrievedChunk>> {
    switch (mode) {
      case 'vector':
        return vector.retrieve({
          tenantId: ctx.tenantId,
          query,
          topK,
        });
      case 'graph_local':
        return graph.retrieveLocal({
          tenantId: ctx.tenantId,
          query,
          topK,
        });
      case 'graph_global':
        return graph.retrieveGlobal({
          tenantId: ctx.tenantId,
          query,
          topK,
        });
      default: {
        const exhaustive: never = mode;
        throw new Error(`unhandled mode: ${exhaustive as string}`);
      }
    }
  }

  return {
    classify(query, ctx) {
      return classifyQuery(query, ctx);
    },
    async retrieve(query, decision, ctx) {
      const topK = ctx.topK ?? DEFAULT_TOP_K;
      if (decision.mode === 'hybrid') {
        const [v, g] = await Promise.all([
          vector.retrieve({ tenantId: ctx.tenantId, query, topK }),
          graph.retrieveLocal({ tenantId: ctx.tenantId, query, topK }),
        ]);
        return reciprocalRankFuse([v, g], topK);
      }
      return dispatchPureMode(decision.mode, query, ctx, topK);
    },
  };
}
