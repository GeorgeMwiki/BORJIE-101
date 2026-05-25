/**
 * Adapters for `borjie-corpus-ingest.ts` — concrete embedder + sink
 * implementations. Kept separate so the core ingest module stays under
 * the file-size budget and so the pure logic is testable without
 * touching `drizzle-orm` / `fetch` / `@borjie/database`.
 */

import type { CorpusSink, Embedder, WorkerLogger } from './borjie-corpus-ingest.js';

export interface OpenAIEmbedderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

/**
 * Live OpenAI embedder using `text-embedding-3-large`. The
 * DATA_MODEL.md schema specifies `vector(1024)` — we pass
 * `dimensions: 1024` so the returned vector matches the column width.
 */
export function createOpenAIEmbedder(config: OpenAIEmbedderConfig): Embedder {
  const model = config.model ?? 'text-embedding-3-large';
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  return {
    async embed(text) {
      const response = await fetch(`${baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model, input: text, dimensions: 1024 }),
      });
      if (!response.ok) {
        throw new Error(`openai embeddings ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vector = body.data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Error('openai embeddings: missing data[0].embedding');
      }
      return vector;
    },
  };
}

/**
 * Deterministic zero-vector stub. Used when OPENAI_API_KEY is absent so
 * the worker still completes a structural run in dev/CI environments.
 *
 * TODO(phase-3): once OPENAI_API_KEY is provisioned in deploy env, this
 * stub should never run in production — the CLI logs a WARN if the env
 * var is unset at boot.
 */
export function createStubEmbedder(): Embedder {
  return {
    async embed() {
      return new Array<number>(1024).fill(0);
    },
  };
}

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

/**
 * Drizzle-backed CorpusSink. Issues a raw INSERT ... ON CONFLICT upsert
 * keyed on `(source_file, section)` because the
 * `intelligence_corpus_chunks` Drizzle schema is not yet present under
 * `packages/database/src/schemas/`.
 *
 * TODO(phase-3): replace with a typed
 * `db.insert(intelligenceCorpusChunks).onConflictDoUpdate(...)` once the
 * schema is added and re-exported from `@borjie/database`.
 */
export function createDrizzleCorpusSink(db: DrizzleLikeClient): CorpusSink {
  return {
    async upsert(row) {
      // Dynamic import so the module compiles in environments without
      // drizzle-orm installed (unit tests, fresh checkout).
      const { sql } = await import('drizzle-orm');
      const vectorLiteral = `[${row.embedding.join(',')}]`;
      await db.execute(
        sql`INSERT INTO intelligence_corpus_chunks
              (id, tenant_id, source_file, section, text, embedding, ingested_at)
            VALUES (${row.id}, NULL, ${row.sourceFile}, ${row.sectionHeading},
                    ${row.content}, ${vectorLiteral}::vector, ${row.ingestedAt}::timestamptz)
            ON CONFLICT (source_file, section)
            DO UPDATE SET
              text = EXCLUDED.text,
              embedding = EXCLUDED.embedding,
              ingested_at = EXCLUDED.ingested_at`,
      );
    },
  };
}

/**
 * Log-only sink. The CLI uses this when DATABASE_URL is missing so a
 * dry-run still surfaces the chunks the worker would have written.
 */
export function createLogSink(logger: WorkerLogger): CorpusSink {
  return {
    async upsert(row) {
      logger.info('borjie-corpus-ingest: would-upsert', {
        id: row.id,
        sourceFile: row.sourceFile,
        sectionHeading: row.sectionHeading,
        bytes: row.content.length,
        embeddingDims: row.embedding.length,
      });
    },
  };
}

export type { DrizzleLikeClient };
