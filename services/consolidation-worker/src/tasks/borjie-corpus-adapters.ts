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
 * See gh-issue #12 — once OPENAI_API_KEY is provisioned in deploy env,
 * this stub should never run in production; the CLI logs a WARN if the
 * env var is unset at boot.
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
 * schema map is passed at client construction. The conflict `target`
 * accepts a raw SQL expression so it can match the EXPRESSION unique
 * index `(COALESCE(tenant_id,''), source_file, COALESCE(section,''))`
 * that migration 0311 creates — a column-list target would NOT match an
 * expression index.
 */
interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
  insert: (table: unknown) => {
    values: (
      row: Record<string, unknown>,
    ) => {
      onConflictDoUpdate: (args: {
        target: unknown;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
}

/**
 * Drizzle-backed CorpusSink. Typed insert against the
 * `intelligenceCorpusChunks` schema with an upsert keyed on the
 * EXPRESSION unique index from migration 0311:
 *   (COALESCE(tenant_id, ''), source_file, COALESCE(section, ''))
 *
 * The `ON CONFLICT` target is a raw SQL expression that mirrors the index
 * expression EXACTLY (Postgres matches an expression-index arbiter only on
 * an identical expression). Re-running the ingest therefore overwrites the
 * matching row's content + embedding instead of erroring or duplicating.
 * This sink writes GLOBAL rows (`tenant_id = NULL`); under the 0310 RLS
 * split those NULL writes are legitimate only via the BYPASSRLS service
 * role the worker connects as.
 */
export function createDrizzleCorpusSink(db: DrizzleLikeClient): CorpusSink {
  return {
    async upsert(row) {
      // Dynamic import so the module compiles in environments without
      // drizzle-orm installed (unit tests, fresh checkout).
      const { intelligenceCorpusChunks } = await import('@borjie/database');
      const { sql } = await import('drizzle-orm');

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
          // Must match migration 0311's expression index verbatim.
          target: sql`(COALESCE(tenant_id, ''), source_file, COALESCE(section, ''))`,
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
