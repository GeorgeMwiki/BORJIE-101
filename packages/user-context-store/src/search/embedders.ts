/**
 * Embedder ports.
 *
 * Two implementations:
 *   - {@link createOpenAIEmbedder} — calls OpenAI's `text-embedding-3-small`
 *     (dim 1536). Used in production. Requires an API key at construction.
 *   - {@link createMockEmbedder} — deterministic, SHA-256 keyed hash →
 *     pseudo-random floats in [-1, 1]. Used in tests and CI. Same input
 *     → same vector across runs and processes.
 */
import { createHash } from 'crypto';
import type { Embedder } from '../types.js';

const OPENAI_DIMENSION = 1536;

export interface OpenAIEmbedderOptions {
  readonly apiKey: string;
  /** Override for tests — defaults to the real OpenAI endpoint. */
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

/**
 * Production embedder backed by OpenAI's text-embedding-3-small.
 *
 * Construction is cheap (no IO). The first call to `embed()` hits the
 * network. Retries / rate-limit handling are deliberately omitted at
 * this layer — the composition root wraps with the shared OpenAI
 * client policy.
 */
export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions): Embedder {
  if (!opts.apiKey) {
    throw new Error('createOpenAIEmbedder: apiKey is required');
  }
  const f = opts.fetchImpl ?? fetch;
  const model = opts.model ?? 'text-embedding-3-small';
  return {
    dimension: OPENAI_DIMENSION,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const res = await f('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ input: text, model }),
      });
      if (!res.ok) {
        throw new Error(
          `OpenAI embeddings ${res.status}: ${await res.text().catch(() => '<no body>')}`,
        );
      }
      const json = (await res.json()) as {
        data?: ReadonlyArray<{ embedding?: ReadonlyArray<number> }>;
      };
      const vector = json.data?.[0]?.embedding;
      if (!vector || vector.length !== OPENAI_DIMENSION) {
        throw new Error(
          `OpenAI embeddings malformed response (expected ${OPENAI_DIMENSION} dims)`,
        );
      }
      return vector;
    },
  };
}

export interface MockEmbedderOptions {
  /** Dimension of vectors to emit. Defaults to 1536 to match OpenAI. */
  readonly dimension?: number;
}

/**
 * Deterministic mock embedder.
 *
 * Algorithm:
 *   1. SHA-256 the input → 32 bytes
 *   2. Re-hash N times to fill `dimension` bytes
 *   3. Each byte → float in [-1, 1] via `(b - 128) / 128`
 *
 * Same input always produces the same vector; different inputs differ
 * with overwhelming probability (collisions are SHA-256-rare).
 */
export function createMockEmbedder(opts: MockEmbedderOptions = {}): Embedder {
  const dimension = opts.dimension ?? OPENAI_DIMENSION;
  if (dimension <= 0) throw new Error('createMockEmbedder: dimension must be > 0');
  return {
    dimension,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const out = new Array<number>(dimension);
      let idx = 0;
      let counter = 0;
      while (idx < dimension) {
        const buf = createHash('sha256').update(`${counter}|${text}`).digest();
        for (let i = 0; i < buf.length && idx < dimension; i++, idx++) {
          out[idx] = (buf[i]! - 128) / 128;
        }
        counter += 1;
      }
      return out;
    },
  };
}
