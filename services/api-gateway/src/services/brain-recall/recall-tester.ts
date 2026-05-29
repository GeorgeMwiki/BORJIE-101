/**
 * Brain recall verifier — Wave COMPANY-BRAIN (C-2).
 *
 * Closes the loop on the never-lose-memory guarantee. Given a chunk
 * (already embedded) and a query, runs a pgvector cosine-similarity
 * search and returns the top hits + citation pointers.
 *
 * Used by:
 *   - The brain.recall tool (owner asks "what was the Q1 royalty rate?")
 *   - The brain-recall integration test that seeds a doc + queries it 30
 *     min later to prove the round-trip works.
 *   - The day-1 onboarding-jumpstart that needs to surface 5 insights
 *     from the just-ingested CSV.
 *
 * Pure thin layer over the existing `intelligence_corpus_chunks` table
 * and an injected embedder.
 */

import { sql } from 'drizzle-orm';
import type { Embedder } from '../brain-ingestion/embedder.js';

export interface RecallQueryInput {
  readonly tenantId: string;
  readonly query: string;
  readonly limit?: number;
  /** Restrict to a single uploadId (e.g. "answer from THIS doc only"). */
  readonly uploadId?: string | undefined;
}

export interface RecallHit {
  readonly chunkId: string;
  readonly sourceFile: string;
  readonly section: string | null;
  readonly text: string;
  readonly similarity: number;
  readonly language: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RecallResult {
  readonly hits: ReadonlyArray<RecallHit>;
  readonly queriedAt: string;
}

interface RecallDb {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

export async function recallFromBrain(
  db: RecallDb,
  embedder: Embedder,
  input: RecallQueryInput,
): Promise<RecallResult> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const queryVecs = await embedder.embed([input.query]);
  const vec = queryVecs[0];
  if (!vec) throw new Error('recall: embedder returned no vector');
  const vectorLiteral = `[${vec.join(',')}]`;

  const uploadClause = input.uploadId
    ? sql`AND source_file = ${`tenant://${input.tenantId}/upload/${input.uploadId}`}`
    : sql``;

  // pgvector `<=>` is cosine distance; smaller is better. We convert to a
  // similarity score (1 - distance) so the caller can compare against a
  // monotonic 0..1 threshold.
  const rawRows = rowsOf(
    await db.execute(sql`
      SELECT id, source_file, section, text, language, metadata,
             (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
        FROM intelligence_corpus_chunks
       WHERE (tenant_id = ${input.tenantId} OR tenant_id IS NULL)
             ${uploadClause}
         AND embedding IS NOT NULL
       ORDER BY embedding <=> ${vectorLiteral}::vector
       LIMIT ${limit}
    `),
  );

  const hits = rawRows.map((row) => {
    const meta = (row['metadata'] ?? {}) as Record<string, unknown>;
    return Object.freeze({
      chunkId: String(row['id']),
      sourceFile: String(row['source_file']),
      section: row['section'] ? String(row['section']) : null,
      text: String(row['text']),
      similarity: Number(row['similarity']) || 0,
      language: String(row['language'] ?? 'en'),
      metadata: Object.freeze(meta),
    }) satisfies RecallHit;
  });

  return Object.freeze({
    hits: Object.freeze(hits),
    queriedAt: new Date().toISOString(),
  });
}
