/**
 * Dense search — pgvector HNSW wrapper with tenant scope.
 *
 * Wraps the `DenseSearchIndexPort` and the `EmbeddingPort`. The
 * tenant invariant is preserved at every step: the embedding is
 * computed locally, the search call passes tenantId as the first
 * argument (which the SQL adapter compiles into a `WHERE
 * tenant_id = $1` predicate before the HNSW probe), and any result
 * row whose tenantId does not match the request is **rejected** —
 * throwing `BlackboardIntelError('CROSS_TENANT_REJECTED')`. We
 * choose throw-on-leak (vs. silent filter) so a misconfigured port
 * cannot quietly leak rows across tenants.
 *
 * @module @borjie/blackboard-intel/search/dense-search
 */

import {
  BlackboardIntelError,
  EMBEDDING_DIM,
  type DenseSearchIndexPort,
  type EmbeddingPort,
  type SearchIndexRepository,
  type SearchQuery,
  type SearchResult,
} from '../types.js';
import { snippetOf } from './fts-search.js';

export interface DenseSearcherDeps {
  readonly dense: DenseSearchIndexPort;
  readonly embedding: EmbeddingPort;
  readonly contentRepo: SearchIndexRepository;
}

export interface DenseSearcher {
  readonly search: (
    query: SearchQuery,
  ) => Promise<ReadonlyArray<SearchResult>>;
}

const DEFAULT_K = 10;

export function createDenseSearcher(
  deps: DenseSearcherDeps,
): DenseSearcher {
  return {
    async search(
      query: SearchQuery,
    ): Promise<ReadonlyArray<SearchResult>> {
      if (query.text.trim().length === 0) {
        throw new BlackboardIntelError(
          'empty dense query',
          'EMPTY_QUERY',
        );
      }
      const embedding = await deps.embedding.embed(query.text);
      if (embedding.length !== EMBEDDING_DIM) {
        throw new BlackboardIntelError(
          `embedding dim mismatch: got ${embedding.length}, expected ${EMBEDDING_DIM}`,
          'EMBEDDING_DIM_MISMATCH',
        );
      }
      const k = query.k ?? DEFAULT_K;
      const hits = await deps.dense.search(query.tenantId, embedding, k);
      const out: SearchResult[] = [];
      for (const h of hits) {
        // Cross-tenant defence: the repo MUST scope by tenantId. The
        // content-repo lookup will return null for any leaked row.
        const content = await deps.contentRepo.getContent(
          query.tenantId,
          h.postId,
        );
        if (content === null) {
          throw new BlackboardIntelError(
            `cross-tenant probe rejected (post ${h.postId})`,
            'CROSS_TENANT_REJECTED',
          );
        }
        out.push(
          Object.freeze({
            postId: h.postId,
            tenantId: query.tenantId,
            score: h.similarity,
            snippet: snippetOf(content),
            meta: Object.freeze({ source: 'dense' }),
          }),
        );
      }
      return Object.freeze([...out]);
    },
  };
}
