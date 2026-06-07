/**
 * GraphRAG neighbourhood expansion for the chat retrieval path.
 *
 * After the existing pgvector top-K corpus retrieval returns a set of chunks,
 * this module expands a 1–2 hop graph neighbourhood around those chunks in the
 * tenant's knowledge graph (`kg_nodes` / `kg_edges`, migration 0298) and
 * returns ADDITIONAL corpus chunks reachable through that neighbourhood — the
 * "graph" half of GraphRAG layered on top of the "vector" half.
 *
 * How the hop works (all tenant-RLS scoped):
 *   1. Map each retrieved chunk id → its `corpus_chunk:<id>` graph node.
 *   2. `expandFromSeed` (package fn) walks `depth` hops over the store. A chunk
 *      node's `mentions` edges reach the ENTITY nodes it talks about; those
 *      entities' edges (owns / supplies / manages / parent-of) reach RELATED
 *      entities; and those entities' inbound `mentions` edges reach OTHER chunk
 *      nodes. So a 2-hop walk surfaces chunks about connected entities even
 *      when they were not in the vector top-K.
 *   3. Collect the `corpus_chunk` nodes in the expanded subgraph that were NOT
 *      already retrieved, resolve their REAL text from
 *      `intelligence_corpus_chunks`, and return them as extra evidence.
 *
 * HONEST FALLBACK: if the tenant has no graph (ingestion never ran, or no
 * neighbourhood), `expandFromSeed` yields nothing new and this returns `[]` —
 * the caller is byte-identical to the vector-only path. Nothing is fabricated;
 * every added chunk carries a real `intelligence_corpus_chunks.id` + text, so
 * the evidence chain the Auditor verifies stays valid.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts
 *   - services/api-gateway/src/routes/mining/chat-corpus-evidence.ts (CorpusEvidence)
 *   - services/api-gateway/src/routes/mining/chat-orchestrator.ts (caller)
 */

import { sql } from 'drizzle-orm';
import { expandFromSeed } from '@borjie/knowledge-graph';
import { createLogger } from '../../utils/logger';
import {
  createPostgresKgStore,
  type KgDbExec,
} from '../../composition/knowledge-graph/postgres-kg-store';
import type { CorpusEvidence } from './chat-corpus-evidence';

const logger = createLogger('graph-rag-expand');

/** Edge labels worth traversing for GraphRAG (entity + mention relations). */
const GRAPH_RAG_EDGE_FILTERS: ReadonlyArray<string> = [
  'mentions',
  'owns',
  'supplies',
  'manages',
  'parent-of',
];

/** Cap on extra chunks added by the graph hop (keeps the prompt bounded). */
const MAX_GRAPH_CHUNKS = 5;

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

export interface ExpandGraphEvidenceArgs {
  /** Tenant-pinned db handle (RLS GUC bound by the caller's tx / middleware). */
  readonly db: KgDbExec;
  readonly tenantId: string;
  /** The chunks the vector top-K already returned (their ids seed the walk). */
  readonly seedChunks: ReadonlyArray<CorpusEvidence>;
  /** Hops to expand (clamped to [1,2]); default 2. */
  readonly depth?: number;
  /** Max extra chunks to return; default MAX_GRAPH_CHUNKS. */
  readonly limit?: number;
}

/**
 * Expand the graph neighbourhood around `seedChunks` and return additional,
 * de-duplicated corpus chunks (real id + text) reachable within `depth` hops.
 * Returns `[]` on any failure or empty graph — the caller degrades cleanly to
 * vector-only. MUST run inside the tenant context (the caller's
 * `withTenantContext` tx) so RLS scopes every read.
 */
export async function expandGraphEvidence(
  args: ExpandGraphEvidenceArgs,
): Promise<ReadonlyArray<CorpusEvidence>> {
  const seedChunks = args.seedChunks.filter((c) => c.id);
  if (seedChunks.length === 0) return [];
  const depth = Math.min(Math.max(args.depth ?? 2, 1), 2);
  const limit = Math.min(Math.max(args.limit ?? MAX_GRAPH_CHUNKS, 1), 20);

  try {
    const store = createPostgresKgStore(args.db);
    const seedNodeIds = seedChunks.map((c) => `corpus_chunk:${c.id}`);

    const sub = await expandFromSeed({
      tenantId: args.tenantId,
      seedNodeIds,
      store,
      depth,
      edgeFilters: GRAPH_RAG_EDGE_FILTERS,
    });

    // Pull the corpus-chunk nodes the walk reached, minus the originals.
    const alreadyHave = new Set<string>(seedChunks.map((c) => c.id));
    const newChunkRefs: string[] = [];
    for (const node of sub.nodes) {
      if (node.class !== 'corpus_chunk') continue;
      const ref =
        typeof node.properties.entity_ref === 'string'
          ? node.properties.entity_ref
          : node.id.startsWith('corpus_chunk:')
            ? node.id.slice('corpus_chunk:'.length)
            : null;
      if (!ref || alreadyHave.has(ref)) continue;
      alreadyHave.add(ref);
      newChunkRefs.push(ref);
      if (newChunkRefs.length >= limit) break;
    }
    if (newChunkRefs.length === 0) return [];

    // Resolve REAL text for the reachable chunks (citable evidence ids).
    const rows = extractRows<{
      id: string;
      chunk_text: string;
      source_file: string;
      url: string | null;
    }>(
      await args.db.execute(sql`
        SELECT id, text AS chunk_text, source_file, url
          FROM intelligence_corpus_chunks
         WHERE id = ANY(${newChunkRefs})
      `),
    );

    const out: CorpusEvidence[] = [];
    for (const row of rows) {
      const text = String(row.chunk_text ?? '');
      if (!row.id || text.length === 0) continue;
      out.push({
        id: row.id,
        text,
        sourceFile: String(row.source_file ?? ''),
        url: typeof row.url === 'string' ? row.url : null,
      });
    }
    if (out.length > 0) {
      logger.debug(
        { tenantId: args.tenantId, added: out.length, seeds: seedNodeIds.length },
        'graph_rag_expanded',
      );
    }
    return out;
  } catch (err) {
    // Honest degrade — vector-only path. Never fabricate.
    logger.warn(
      { err, tenantId: args.tenantId },
      'graph_rag_expand_failed_degrading_to_vector_only',
    );
    return [];
  }
}
