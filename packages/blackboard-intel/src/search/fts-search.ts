/**
 * FTS search — Postgres tsquery wrapper with tenant scope.
 *
 * Wraps the `SearchIndexRepository.ftsSearch` port and applies the
 * tenant invariant: the tenantId on the query is the first predicate,
 * and any result row that fails to match it is silently filtered (a
 * defence-in-depth in case the repo bypassed RLS for some reason).
 *
 * @module @borjie/blackboard-intel/search/fts-search
 */

import {
  BlackboardIntelError,
  type SearchIndexRepository,
  type SearchQuery,
  type SearchResult,
} from '../types.js';

export interface FtsSearcherDeps {
  readonly repo: SearchIndexRepository;
}

export interface FtsSearcher {
  readonly search: (
    query: SearchQuery,
  ) => Promise<ReadonlyArray<SearchResult>>;
}

const DEFAULT_K = 10;
const SNIPPET_MAX_CHARS = 300;

export function createFtsSearcher(deps: FtsSearcherDeps): FtsSearcher {
  return {
    async search(
      query: SearchQuery,
    ): Promise<ReadonlyArray<SearchResult>> {
      if (query.text.trim().length === 0) {
        throw new BlackboardIntelError(
          'empty FTS query',
          'EMPTY_QUERY',
        );
      }
      const k = query.k ?? DEFAULT_K;
      const rows = await deps.repo.ftsSearch(
        query.tenantId,
        query.text,
        k,
      );
      const results: SearchResult[] = [];
      for (const r of rows) {
        // Defence-in-depth: the repo should already have filtered on
        // tenantId; we re-check via getContent which only returns when
        // the tenant matches.
        const content = await deps.repo.getContent(
          query.tenantId,
          r.postId,
        );
        if (content === null) continue;
        results.push(
          Object.freeze({
            postId: r.postId,
            tenantId: query.tenantId,
            score: r.rank,
            snippet: snippetOf(content),
            meta: Object.freeze({ source: 'fts' }),
          }),
        );
      }
      return Object.freeze([...results]);
    },
  };
}

export function snippetOf(content: string): string {
  if (content.length <= SNIPPET_MAX_CHARS) return content;
  return `${content.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}
