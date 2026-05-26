/**
 * Cohere Rerank 3.5 — cross-encoder reranker.
 *
 * Slots in AFTER the initial top-N hybrid retrieval and BEFORE the LLM
 * sees the chunks. Anthropic's published data shows reranking cuts
 * retrieval failure rate from 5.7% to 1.9% on the Contextual Retrieval
 * benchmark. Cohere Rerank 3.5 is multilingual (100+ languages —
 * Swahili is native, which matters for the TZ property-management
 * corpus). Priced ~$2 / 1k searches.
 *
 * Identity-fallback policy (ship before LLM keys):
 *   - When `COHERE_API_KEY` is absent OR the call fails (network /
 *     non-200), this module returns the input candidates IN THEIR
 *     ORIGINAL ORDER with synthetic descending scores (1.0 → 0.5).
 *   - Downstream callers can rely on the function returning a non-
 *     empty slice as long as the input was non-empty, and on the
 *     scores being monotonically descending so `> previousScore`
 *     comparisons keep working.
 *
 * Ported from LITFIN `src/core/document-intelligence/contextual-rag/
 * cohere-reranker.ts` (199 LOC). Functionally identical; node
 * `process.env.COHERE_API_KEY` is the same env var. The BORJIE
 * port renames the file to `cohere-rerank.ts` to match the package
 * naming convention agreed with the platform team.
 *
 * @module @borjie/ai-copilot/retrieval/cohere-rerank
 */

// ===========================================================================
// Constants
// ===========================================================================

import { logger } from '../logger.js';
const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const COHERE_RERANK_MODEL = 'rerank-v3.5';
const COHERE_RERANK_TIMEOUT_MS = 12_000;
/** Cohere's per-request document cap. We clip on the client so we
 *  never trip the 422 hard limit. */
const COHERE_RERANK_MAX_DOCS = 1000;
/** Per-document character cap (~4k tokens at 4 chars/token). Cohere
 *  truncates anyway; we cap to keep the request body bounded. */
const COHERE_RERANK_MAX_DOC_CHARS = 16_000;

export const COHERE_RERANK_MODEL_ID = COHERE_RERANK_MODEL;

// ===========================================================================
// Types
// ===========================================================================

/** Minimal shape every candidate must have. Only `text` is read; the
 *  rest is passed through so callers can recover metadata post-rerank. */
export interface RerankCandidate {
  readonly text: string;
}

export interface RerankedCandidate<T extends RerankCandidate> {
  readonly candidate: T;
  /** Cohere relevance score in [0, 1]. When the identity-fallback
   *  fires the score is a synthetic descending value so downstream
   *  ordering stays monotonic. */
  readonly score: number;
  /** Original 0-based position in the input list. Useful for audit. */
  readonly originalIndex: number;
}

export interface RerankOptions {
  /** Cap on how many reranked results to return. Default = all. */
  readonly topN?: number;
  /** Inject a custom `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Override the API base. */
  readonly apiBase?: string;
  /** Override the API key. Falls back to `COHERE_API_KEY`. */
  readonly apiKey?: string;
}

export interface RerankResult<T extends RerankCandidate> {
  readonly candidates: ReadonlyArray<RerankedCandidate<T>>;
  /** True when the identity-fallback was used (no key OR call failed). */
  readonly fallbackUsed: boolean;
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Rerank candidates for a query via Cohere Rerank 3.5.
 *
 * Returns a sorted list (highest relevance first) capped at `topN`,
 * plus a `fallbackUsed` flag so callers can surface a "rerank
 * unavailable" telemetry signal. Never throws — the identity-fallback
 * absorbs every failure mode.
 */
export async function rerankCandidates<T extends RerankCandidate>(
  query: string,
  candidates: ReadonlyArray<T>,
  options: RerankOptions = {},
): Promise<RerankResult<T>> {
  if (candidates.length === 0) {
    return { candidates: [], fallbackUsed: false };
  }
  const topN = clampTopN(options.topN, candidates.length);
  if (!query || query.trim().length === 0) {
    return {
      candidates: identityFallback(candidates, topN),
      fallbackUsed: true,
    };
  }

  const apiKey = options.apiKey ?? process.env.COHERE_API_KEY;
  if (!apiKey) {
    return {
      candidates: identityFallback(candidates, topN),
      fallbackUsed: true,
    };
  }

  // Cohere has a max-docs ceiling. If the caller passed more we keep
  // the leading slice (caller is expected to have pre-trimmed via the
  // hybrid retrieval step).
  const inFlight = candidates.slice(0, COHERE_RERANK_MAX_DOCS);
  const documents = inFlight.map((c) =>
    c.text.slice(0, COHERE_RERANK_MAX_DOC_CHARS),
  );

  const url = (options.apiBase ?? COHERE_RERANK_URL).trim();
  const fetcher = options.fetchImpl ?? fetch;

  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COHERE_RERANK_MODEL,
        query,
        documents,
        top_n: topN,
      }),
      signal: AbortSignal.timeout(COHERE_RERANK_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error('[retrieval/cohere-rerank] non-200', { error: response.status });
      return {
        candidates: identityFallback(candidates, topN),
        fallbackUsed: true,
      };
    }

    const json = (await response.json()) as {
      results?: ReadonlyArray<{
        index?: number;
        relevance_score?: number;
      }>;
    };
    const results = json?.results;
    if (!Array.isArray(results) || results.length === 0) {
      return {
        candidates: identityFallback(candidates, topN),
        fallbackUsed: true,
      };
    }

    const reranked: Array<RerankedCandidate<T>> = [];
    for (const r of results) {
      const idx = typeof r.index === 'number' ? r.index : NaN;
      const score =
        typeof r.relevance_score === 'number' ? r.relevance_score : 0;
      if (!Number.isInteger(idx) || idx < 0 || idx >= inFlight.length) {
        continue;
      }
      const candidate = inFlight[idx];
      if (candidate === undefined) continue;
      reranked.push({
        candidate,
        score,
        originalIndex: idx,
      });
    }
    if (reranked.length === 0) {
      return {
        candidates: identityFallback(candidates, topN),
        fallbackUsed: true,
      };
    }
    // Cohere already sorts highest-first, but sort again defensively.
    reranked.sort((a, b) => b.score - a.score);
    return {
      candidates: reranked.slice(0, topN),
      fallbackUsed: false,
    };
  } catch (err) {
    logger.error('[retrieval/cohere-rerank] fetch failed', { error: err instanceof Error ? err.message : String(err) });
    return {
      candidates: identityFallback(candidates, topN),
      fallbackUsed: true,
    };
  }
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function clampTopN(
  requested: number | undefined,
  available: number,
): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return available;
  }
  return Math.max(1, Math.min(Math.floor(requested), available));
}

/** Identity ordering with descending synthetic scores. Highest first
 *  so downstream consumers can keep using `> previousScore`
 *  comparisons without special-casing the fallback. */
function identityFallback<T extends RerankCandidate>(
  candidates: ReadonlyArray<T>,
  topN: number,
): ReadonlyArray<RerankedCandidate<T>> {
  const limit = Math.min(topN, candidates.length);
  const out: Array<RerankedCandidate<T>> = [];
  for (let i = 0; i < limit; i++) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    out.push({
      candidate,
      // Score decays linearly from 1.0 down to 1.0 - (i/limit)*0.5 so
      // the topmost item is always 1.0 and the bottom never undercuts
      // 0.5 — keeps the ordering monotone without misrepresenting
      // confidence as zero.
      score: 1 - (i / Math.max(limit, 1)) * 0.5,
      originalIndex: i,
    });
  }
  return out;
}
