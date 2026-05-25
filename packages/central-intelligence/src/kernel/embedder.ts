/**
 * Text embedder ports — the kernel's optional memory-recall accelerator.
 *
 * The kernel surfaces `BrainKernelDeps.embedder` (see kernel.ts:245) as
 * an opt-in slot: when wired, the memory-recall step turns the user
 * message into a query vector and prefers `searchByEmbedding(...)` over
 * the legacy key-based `search(...)`. The kernel ALREADY catches
 * embedder failures and degrades to the key-based path, so the embedder
 * implementations here are free to throw on bad responses — no silent
 * fallback inside the embedder itself.
 *
 * Two concrete embedders ship in this module:
 *
 *   - `createOpenAiEmbedder({apiKey, ...})` — real network adapter
 *     against the OpenAI `/v1/embeddings` endpoint. No SDK dependency;
 *     uses `fetch` directly. Retries 2x on 5xx + transport errors with
 *     bounded jitter. 4xx errors fail fast (auth/usage problems should
 *     surface immediately, not get retried into the same wall).
 *
 *   - `createNullEmbedder()` — always-rejects sentinel for the
 *     unconfigured path. The wiring root threads this when no API key
 *     is set so the kernel always has a port (avoids `if (deps.embedder)`
 *     branching in the recall step).
 *
 * Both embedders match the legacy `TextEmbedder` port shape (one method:
 * `embed(text): Promise<readonly number[]>`) and add `modelId` + `dims`
 * for downstream observability.
 */

/**
 * The legacy `TextEmbedder` port from `kernel-types.ts` only requires
 * the `embed` method. We re-state it here with two additional metadata
 * fields the composition root surfaces in structured logs / traces.
 * The kernel itself only reads `embed`; the extra fields are additive
 * so this type is still assignable to `TextEmbedder`.
 */
export interface EmbedderPort {
  /** Produce an embedding vector for the given text. */
  embed(text: string): Promise<ReadonlyArray<number>>;
  /** Stable identifier for the embedding model (provider + variant). */
  readonly modelId: string;
  /** Expected dimensionality of the output vector. */
  readonly dims: number;
}

/**
 * Sentinel error message thrown by `createNullEmbedder()`. Callers
 * that want to differentiate "configuration miss" from "transient
 * network failure" can pattern-match on this string.
 */
export const EMBEDDER_NOT_CONFIGURED_ERROR = 'EmbedderNotConfigured';

export interface OpenAiEmbedderConfig {
  /** OpenAI API key. Required. */
  readonly apiKey: string;
  /** Model id. Default `'text-embedding-3-small'`. */
  readonly model?: string;
  /** Override base URL. Default `'https://api.openai.com'`. */
  readonly baseUrl?: string;
  /** Per-request timeout in ms. Default 15_000. */
  readonly timeoutMs?: number;
  /** Expected output dims. Default 1536 (matches the default model). */
  readonly dims?: number;
  /**
   * Override `fetch` (tests). Defaults to `globalThis.fetch`. Allowed
   * to be unset at composition time so the kernel boot doesn't import
   * a fetch polyfill on Node ≥ 18 (native fetch is fine).
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Max retries on 5xx / transport errors. Default 2 (so 3 total
   * attempts). 4xx errors are NEVER retried.
   */
  readonly maxRetries?: number;
  /**
   * Override the retry-jitter source (tests). Defaults to
   * `Math.random`. Should return a number in [0, 1).
   */
  readonly random?: () => number;
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMS = 1536;
const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 200;

/**
 * Real OpenAI embedder. Uses `fetch` directly (no SDK), retries on
 * 5xx + transport errors, and validates that the response carries a
 * non-empty vector of the expected dimensionality. Anything wrong with
 * the response surface (wrong dims, empty data array, malformed JSON)
 * throws — the kernel catches and falls back to key-based recall, so
 * a silent in-embedder fallback would mask provider regressions.
 */
export function createOpenAiEmbedder(
  config: OpenAiEmbedderConfig,
): EmbedderPort {
  if (!config || typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
    throw new Error('createOpenAiEmbedder: apiKey is required');
  }
  const apiKey = config.apiKey;
  const model = config.model ?? DEFAULT_MODEL;
  const dims = config.dims ?? DEFAULT_DIMS;
  const baseUrl = stripTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL);
  const timeoutMs = clampPositiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.max(
    0,
    clampPositiveInt(config.maxRetries, DEFAULT_MAX_RETRIES),
  );
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createOpenAiEmbedder: fetch is not available');
  }
  const random = config.random ?? Math.random;
  const url = `${baseUrl}/v1/embeddings`;
  const modelId = `openai:${model}`;

  async function postOnce(text: string, attempt: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text5xx = res.status >= 500 && res.status < 600;
        const err = new EmbedderHttpError(
          `OpenAI embedder HTTP ${res.status}`,
          res.status,
          text5xx,
        );
        // Best-effort body grab for richer logs.
        try {
          err.responseBody = await res.text();
        } catch {
          /* swallow */
        }
        throw err;
      }
      return await res.json();
    } catch (err) {
      if (err instanceof EmbedderHttpError) {
        throw err;
      }
      // AbortError / TypeError (DNS, connection reset) are retryable.
      const message = err instanceof Error ? err.message : String(err);
      throw new EmbedderTransportError(
        `OpenAI embedder transport failure on attempt ${attempt + 1}: ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function shouldRetry(err: unknown): boolean {
    if (err instanceof EmbedderTransportError) return true;
    if (err instanceof EmbedderHttpError) return err.retryable;
    return false;
  }

  async function postWithRetry(text: string): Promise<unknown> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await postOnce(text, attempt);
      } catch (err) {
        lastErr = err;
        if (attempt >= maxRetries || !shouldRetry(err)) {
          throw err;
        }
        // Exponential backoff with bounded jitter — never sleeps more
        // than 2 * BASE_BACKOFF_MS * 2^attempt.
        const backoff =
          BASE_BACKOFF_MS * Math.pow(2, attempt) * (1 + random());
        await sleep(backoff);
      }
    }
    /* istanbul ignore next */
    throw lastErr ?? new Error('OpenAI embedder: exhausted retries');
  }

  return {
    modelId,
    dims,
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const safeText = typeof text === 'string' ? text : String(text ?? '');
      const json = await postWithRetry(safeText);
      const vec = extractVector(json);
      if (vec.length === 0) {
        throw new Error('OpenAI embedder: response carried an empty vector');
      }
      if (vec.length !== dims) {
        throw new Error(
          `OpenAI embedder: dim mismatch — expected ${dims}, got ${vec.length}`,
        );
      }
      return vec;
    },
  };
}

/**
 * Always-rejecting embedder. Used when no API key is configured at
 * boot — the wiring threads this so the kernel always has a port and
 * its `try/catch` around `deps.embedder?.embed(...)` collapses to the
 * legacy key-based search path without an extra `if (deps.embedder)`
 * branch in the recall step.
 */
export function createNullEmbedder(): EmbedderPort {
  return {
    modelId: 'null',
    dims: 0,
    async embed(_text: string): Promise<ReadonlyArray<number>> {
      throw new Error(EMBEDDER_NOT_CONFIGURED_ERROR);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

class EmbedderHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  responseBody?: string;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'EmbedderHttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

class EmbedderTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedderTransportError';
  }
}

function extractVector(json: unknown): ReadonlyArray<number> {
  if (!json || typeof json !== 'object') return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return [];
  const first = data[0];
  if (!first || typeof first !== 'object') return [];
  const emb = (first as { embedding?: unknown }).embedding;
  if (!Array.isArray(emb)) return [];
  const out: number[] = [];
  for (const v of emb) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push(v);
    } else {
      return [];
    }
  }
  return out;
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.floor(ms)));
  });
}
