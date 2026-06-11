/**
 * Drizzle-backed corpus search adapter — JC-1.
 *
 * Thin keyword (ILIKE) search over `intelligence_corpus_chunks`. The
 * physical chunk columns are `text` (the body), `source_file`, and
 * `metadata` (per `intelligence-corpus.schema.ts` / migration
 * `0003_mining_domain.sql`) — there is NO `content` / `title` column,
 * so we scan `text` + `source_file` and derive a human title from
 * `source_file`. (An earlier revision queried phantom `content`/`title`
 * columns; that threw "column does not exist" and the catch silently
 * returned `[]`, leaving the corpus probe dark — and so the admin
 * compliance learn-feed unreachable. Fixed to the real columns.)
 *
 * The corpus is tenant-AGNOSTIC (per CLAUDE.md — every tenant inherits
 * the same global ground truth) so we do NOT bind a tenant context
 * for these queries. Mirror of the citations.hono.ts read pattern.
 */

import { sql } from 'drizzle-orm';
import pino from 'pino';

import type { CorpusSearchAdapter } from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'jurisdiction-discovery-corpus',
});

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ChunkRow {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  readonly source_file: string | null;
}

export function createDrizzleCorpusSearch(
  db: DbLike | null,
): CorpusSearchAdapter {
  return {
    async search({ query, limit = 6 }) {
      if (!db) return [];
      const safeLimit = Math.max(1, Math.min(20, limit));
      // ILIKE-based scan over the REAL columns: `text` is the chunk body
      // and `source_file` is the provenance path (no `content` / `title`
      // column exists). The title is derived from `source_file`. The query
      // is short + targeted ("country mining regulator authority") so the
      // scan stays bounded.
      try {
        const result = (await db.execute(sql`
          SELECT
            id::text                                  AS id,
            COALESCE(source_file, 'corpus chunk')     AS title,
            COALESCE(text, '')                        AS body,
            source_file
          FROM intelligence_corpus_chunks
          WHERE (
            text ILIKE ${`%${query}%`}
            OR source_file ILIKE ${`%${query}%`}
          )
          LIMIT ${safeLimit}
        `)) as { readonly rows?: ReadonlyArray<ChunkRow> } | ReadonlyArray<ChunkRow>;
        const rows = Array.isArray(result)
          ? (result as ReadonlyArray<ChunkRow>)
          : ((result as { readonly rows?: ReadonlyArray<ChunkRow> }).rows ??
            []);
        return rows.map((row) => ({
          evidenceId: row.id,
          title: row.title ?? row.source_file ?? 'corpus chunk',
          snippet: (row.body ?? '').slice(0, 480),
        }));
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            query,
          },
          'discovery-corpus: search failed',
        );
        return [];
      }
    },
  };
}
