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

/**
 * Minimum Drizzle surface this adapter needs. `insert(...)` returns the
 * fluent builder ending in `.onConflictDoUpdate(...)`, typed once the
 * schema map is passed at client construction.
 */
interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
  insert: (table: unknown) => {
    values: (
      row: Record<string, unknown>,
    ) => {
      onConflictDoUpdate: (args: {
        target: ReadonlyArray<unknown>;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
}

/**
 * Drizzle-backed CorpusSink. Typed insert against the
 * `intelligenceCorpusChunks` schema with an upsert keyed on
 * `(source_file, section)`.
 *
 * Note: the base migration `0003_mining_domain.sql` shipped only a
 * non-unique index on `(source_file, section)`. The Drizzle schema now
 * declares `intelligence_corpus_chunks_source_section_uniq` as
 * `uniqueIndex(...)`; running `drizzle generate` will emit a follow-up
 * migration that promotes the index to UNIQUE so this ON CONFLICT
 * clause is enforceable in production.
 */
export function createDrizzleCorpusSink(db: DrizzleLikeClient): CorpusSink {
  return {
    async upsert(row) {
      // Dynamic import so the module compiles in environments without
      // drizzle-orm installed (unit tests, fresh checkout).
      const { intelligenceCorpusChunks } = await import('@borjie/database');

      await db
        .insert(intelligenceCorpusChunks)
        .values({
          id: row.id,
          tenantId: null,
          sourceFile: row.sourceFile,
          section: row.sectionHeading,
          text: row.content,
          embedding: [...row.embedding],
          ingestedAt: new Date(row.ingestedAt),
        })
        .onConflictDoUpdate({
          target: [
            intelligenceCorpusChunks.sourceFile,
            intelligenceCorpusChunks.section,
          ],
          set: {
            text: row.content,
            embedding: [...row.embedding],
            ingestedAt: new Date(row.ingestedAt),
          },
        });
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
