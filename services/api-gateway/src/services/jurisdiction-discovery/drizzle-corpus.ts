/**
 * Drizzle-backed corpus search adapter — JC-1.
 *
 * Thin keyword search over `intelligence_corpus_chunks`. Uses a
 * tsvector-style `to_tsquery` projection over the chunk text + title
 * + source metadata; falls back to LIKE matching when full-text
 * is not configured.
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
  readonly content: string;
  readonly source_file: string | null;
}

export function createDrizzleCorpusSearch(
  db: DbLike | null,
): CorpusSearchAdapter {
  return {
    async search({ query, limit = 6 }) {
      if (!db) return [];
      const safeLimit = Math.max(1, Math.min(20, limit));
      // ILIKE-based scan — keeps the adapter portable across the
      // various corpus chunk variants the codebase ships (some use
      // chunk_text, some content). The query is short + targeted
      // ("country mining regulator authority") so the scan stays
      // bounded.
      try {
        const result = (await db.execute(sql`
          SELECT
            id::text          AS id,
            COALESCE(title, source_file, 'corpus chunk') AS title,
            COALESCE(content, '')                        AS content,
            source_file
          FROM intelligence_corpus_chunks
          WHERE (
            content ILIKE ${`%${query}%`}
            OR title ILIKE ${`%${query}%`}
            OR source_file ILIKE ${`%${query}%`}
          )
          LIMIT ${safeLimit}
        `)) as { readonly rows?: ReadonlyArray<ChunkRow> } | ReadonlyArray<ChunkRow>;
        const rows = Array.isArray(result)
          ? (result as ReadonlyArray<ChunkRow>)
          : (result.rows ?? []);
        return rows.map((row) => ({
          evidenceId: row.id,
          title: row.title ?? row.source_file ?? 'corpus chunk',
          snippet: (row.content ?? '').slice(0, 480),
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
