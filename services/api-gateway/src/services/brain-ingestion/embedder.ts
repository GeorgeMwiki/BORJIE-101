/**
 * Embedder port + OpenAI implementation for the Company-Brain ingestion
 * pipeline. Wraps `text-embedding-3-large` with `dimensions: 1024` so the
 * vectors fit `intelligence_corpus_chunks.embedding (vector(1024))`.
 *
 * Wave COMPANY-BRAIN (C-1).
 *
 * The deterministic stub embedder is exported so tests + CI runs that
 * lack OPENAI_API_KEY still complete the full ingest → recall round-trip
 * (recall is deterministic for the stub but never replaces production
 * fidelity).
 */

import { createHash } from 'node:crypto';

import type { EmbeddedChunk, TextChunk } from './types.js';

export interface Embedder {
  /** Vector dimension (must match the `vector(N)` column). */
  readonly dimensions: number;
  /** Embed N texts → N vectors. Order preserved. */
  embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>;
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI embedder (text-embedding-3-large, 1024 dims)
// ─────────────────────────────────────────────────────────────────────

export interface OpenAIEmbedderConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly batchSize?: number;
}

export function createOpenAIEmbedder(config: OpenAIEmbedderConfig): Embedder {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  const model = config.model ?? 'text-embedding-3-large';
  const batchSize = Math.max(1, Math.min(config.batchSize ?? 32, 256));

  return {
    dimensions: 1024,

    async embed(texts) {
      if (texts.length === 0) return Object.freeze([]);
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const response = await fetch(`${baseUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model, input: batch, dimensions: 1024 }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `openai embeddings ${response.status}: ${body.slice(0, 400)}`,
          );
        }
        const json = (await response.json()) as {
          data?: Array<{ embedding?: number[] }>;
        };
        const data = json.data ?? [];
        if (data.length !== batch.length) {
          throw new Error(
            `openai embeddings: expected ${batch.length} vectors, got ${data.length}`,
          );
        }
        for (const row of data) {
          if (!Array.isArray(row.embedding)) {
            throw new Error('openai embeddings: missing embedding field');
          }
          out.push(row.embedding);
        }
      }
      return Object.freeze(out.map((v) => Object.freeze([...v])));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic stub — sha256 → 1024 floats
// ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic stub embedder. Same input ⇒ same vector. Useful in CI /
 * dev when OPENAI_API_KEY is absent. The vectors are NOT semantically
 * meaningful — recall still works (because we always hash the same way)
 * but quality is zero. Production must use the OpenAI embedder.
 */
export function createStubEmbedder(): Embedder {
  return {
    dimensions: 1024,
    async embed(texts) {
      return Object.freeze(
        texts.map((text) => {
          const hash = createHash('sha256').update(text).digest();
          const vec = new Array<number>(1024);
          for (let i = 0; i < 1024; i++) {
            // Map each byte (0..255) → (-1..1).
            vec[i] = (hash[i % hash.length]! - 128) / 128;
          }
          return Object.freeze(vec);
        }),
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper: hydrate chunks with their vectors.
// ─────────────────────────────────────────────────────────────────────

export async function embedChunks(
  embedder: Embedder,
  chunks: ReadonlyArray<TextChunk>,
): Promise<ReadonlyArray<EmbeddedChunk>> {
  if (chunks.length === 0) return Object.freeze([]);
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  if (vectors.length !== chunks.length) {
    throw new Error(
      `embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
    );
  }
  return Object.freeze(
    chunks.map((c, i) =>
      Object.freeze({
        ...c,
        embedding: vectors[i]!,
      }),
    ),
  );
}

/**
 * Pick the right embedder from env. Returns the stub when no key is set
 * so dev / CI can still complete the ingest → recall round-trip.
 */
export function resolveEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const key = env.OPENAI_API_KEY?.trim();
  if (key) {
    return createOpenAIEmbedder({ apiKey: key });
  }
  return createStubEmbedder();
}
