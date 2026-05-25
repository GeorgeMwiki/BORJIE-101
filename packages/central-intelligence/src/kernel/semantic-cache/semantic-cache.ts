/**
 * Semantic Cache — Phase D D4 entry surface.
 *
 * Sits between the brain-side exact-key cache (`../brain-cache.ts`) and
 * the LLM provider. Flow per `think()` / `stream()` turn:
 *
 *   1. brain-cache.get(exactKey) → hit returns immediately (~0ms)
 *   2. classifyIntent(userMessage) decides ttlMs + skip rules
 *      - intent='command' → SKIP semantic cache (commands must be fresh)
 *      - intent='greeting' → 24h TTL
 *      - intent='question' → 1h TTL
 *   3. embedder.embedForCache(scope, prompt) — one embedding call
 *      (~$0.00002, cached for 60s by prompt hash)
 *   4. cacheStore.get(scope, embedding, threshold) — cosine-similarity
 *      lookup against entries under the same (tenant, surface, persona)
 *      scope. Threshold default 0.95.
 *      - hit → log `cost_saved_usd` + return cached BrainDecision
 *      - miss → log `would_have_cost_usd` against the model that would
 *        have answered, then proceed to LLM
 *   5. After successful LLM response: cacheStore.set(scope, …)
 *
 * Telemetry: every hit + miss is forwarded to the
 * `SemanticCacheTelemetrySink`. The Drizzle-backed adapter writes to
 * the `semantic_cache_log` table; failures are swallowed.
 *
 * Industry refs:
 *  - TrueFoundry blog "How to implement semantic caching for LLMs"
 *  - Sierra "constellation of models" hot-path patterns
 *  - Anthropic prompt-caching docs (the prefix-cache pattern is a
 *    complementary layer that lives in `ai-copilot/anthropic-prefix-cache.ts`)
 */

import type { BrainDecision } from '../kernel-types.js';
import {
  classifyIntent,
  type CacheIntent,
} from '../brain-cache.js';
import type {
  SemanticCacheScope,
  SemanticCacheStore,
} from './cache-store.js';
import type { SemanticEmbedder } from './embedder.js';

// ─────────────────────────────────────────────────────────────────────
// TTL policy
// ─────────────────────────────────────────────────────────────────────

/**
 * TTL (ms) per intent. Differs from `DEFAULT_INTENT_TTL_MS` in
 * `brain-cache.ts` because the semantic cache is the slower, broader
 * layer: a greeting can sit for a full day, a question for an hour,
 * but a command must never be cached (mutation-bearing).
 */
export const SEMANTIC_CACHE_TTL_MS_BY_INTENT: Readonly<Record<CacheIntent, number>> =
  Object.freeze({
    greeting: 24 * 60 * 60_000,
    acknowledgment: 24 * 60 * 60_000,
    farewell: 24 * 60 * 60_000,
    platform_intro: 24 * 60 * 60_000,
    question: 60 * 60_000,
    command: 0, // never cache mutation-bearing commands
  });

export const DEFAULT_SIMILARITY_THRESHOLD = 0.95;

// ─────────────────────────────────────────────────────────────────────
// Telemetry sink
// ─────────────────────────────────────────────────────────────────────

export interface SemanticCacheTelemetryEvent {
  readonly outcome: 'hit' | 'miss' | 'skip';
  readonly scope: SemanticCacheScope;
  readonly intent: CacheIntent;
  readonly similarity: number | null;
  readonly threshold: number;
  /** Cost saved (hit) or that WOULD have been incurred (miss), USD micros. */
  readonly costUsdMicros: number;
  /** Model the cost is computed against (model that would have answered). */
  readonly modelId: string;
  /** Tokens involved in the saved/would-be call. */
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Time the event was recorded (ISO string). */
  readonly occurredAt: string;
  /**
   * Reason for a 'skip' outcome — e.g. 'intent=command', 'embedder-failed'.
   * Empty for hit / miss.
   */
  readonly skipReason: string | null;
}

export interface SemanticCacheTelemetrySink {
  record(event: SemanticCacheTelemetryEvent): Promise<void> | void;
}

// ─────────────────────────────────────────────────────────────────────
// Cost model
// ─────────────────────────────────────────────────────────────────────

/**
 * USD-per-1k-token rates for cost-saved telemetry. Stored as
 * micro-dollars (1e-6 USD) so we never touch floats once the figure is
 * computed. Defaults reflect Sonnet 4.6 (the Borjie default
 * sensor); the kernel passes the actual modelId at hit/miss time so
 * the right rate is picked.
 */
export interface ModelCostRate {
  readonly modelId: string;
  /** $ per 1k input tokens (stored as USD, converted to micros internally). */
  readonly promptUsdPer1k: number;
  /** $ per 1k output tokens. */
  readonly completionUsdPer1k: number;
}

export const SONNET_4_6_RATE: ModelCostRate = Object.freeze({
  modelId: 'claude-sonnet-4-6',
  promptUsdPer1k: 0.003,
  completionUsdPer1k: 0.015,
});

export const OPUS_4_6_RATE: ModelCostRate = Object.freeze({
  modelId: 'claude-opus-4-6',
  promptUsdPer1k: 0.015,
  completionUsdPer1k: 0.075,
});

export const HAIKU_4_5_RATE: ModelCostRate = Object.freeze({
  modelId: 'claude-haiku-4-5-20251001',
  promptUsdPer1k: 0.0008,
  completionUsdPer1k: 0.004,
});

const DEFAULT_RATES: ReadonlyArray<ModelCostRate> = [
  SONNET_4_6_RATE,
  OPUS_4_6_RATE,
  HAIKU_4_5_RATE,
];

export interface CostRateRegistry {
  rateFor(modelId: string): ModelCostRate;
}

export function createCostRateRegistry(
  rates: ReadonlyArray<ModelCostRate> = DEFAULT_RATES,
): CostRateRegistry {
  const byId = new Map(rates.map((r) => [r.modelId, r]));
  return {
    rateFor(modelId) {
      return byId.get(modelId) ?? SONNET_4_6_RATE;
    },
  };
}

/**
 * Compute the USD-micros cost a hit saved (or a miss would have
 * incurred) for `tokens` against `modelId`. Uses integer arithmetic
 * once the per-1k rate is multiplied out — no float drift.
 */
export function computeCostUsdMicros(
  rate: ModelCostRate,
  promptTokens: number,
  completionTokens: number,
): number {
  const safePrompt = Math.max(0, Math.floor(promptTokens || 0));
  const safeCompletion = Math.max(0, Math.floor(completionTokens || 0));
  // USD-per-token × 1e6 = micros-per-token. We aggregate in micros.
  const promptMicros = Math.round(
    (rate.promptUsdPer1k / 1_000) * 1_000_000 * safePrompt,
  );
  const completionMicros = Math.round(
    (rate.completionUsdPer1k / 1_000) * 1_000_000 * safeCompletion,
  );
  return promptMicros + completionMicros;
}

// ─────────────────────────────────────────────────────────────────────
// Semantic cache facade
// ─────────────────────────────────────────────────────────────────────

export interface SemanticCacheDeps {
  readonly store: SemanticCacheStore;
  readonly embedder: SemanticEmbedder;
  readonly telemetrySink?: SemanticCacheTelemetrySink;
  readonly costRates?: CostRateRegistry;
  /** Default similarity threshold; overridable per call. Default 0.95. */
  readonly defaultThreshold?: number;
  /** Per-tenant threshold override; falls back to `defaultThreshold`. */
  readonly thresholdForTenant?: (tenantId: string | null) => number | null;
  /** Injectable clock — defaults to `() => new Date()`. */
  readonly clock?: () => Date;
}

export interface SemanticCacheLookupArgs {
  readonly scope: SemanticCacheScope;
  readonly userMessage: string;
  /** Optional explicit intent (skip classify when caller already knows). */
  readonly intent?: CacheIntent;
  /** Model that would answer the turn on a miss — used for cost telemetry. */
  readonly answeringModelId: string;
  /** Estimated tokens of the prompt that would be sent on miss. */
  readonly estimatedPromptTokens?: number;
  /** Estimated completion tokens on miss. */
  readonly estimatedCompletionTokens?: number;
  /** Override the threshold for this call. */
  readonly thresholdOverride?: number;
}

export type SemanticCacheLookupResult =
  | {
      readonly outcome: 'hit';
      readonly value: BrainDecision;
      readonly similarity: number;
      readonly cacheId: string;
    }
  | { readonly outcome: 'miss'; readonly embedding: ReadonlyArray<number> }
  | { readonly outcome: 'skip'; readonly reason: string };

export interface SemanticCacheStoreArgs {
  readonly scope: SemanticCacheScope;
  readonly userMessage: string;
  readonly intent?: CacheIntent;
  /** Embedding from a prior `lookup(...)` miss (re-use to avoid a 2nd embed). */
  readonly embedding: ReadonlyArray<number>;
  readonly value: BrainDecision;
  /** Optional TTL override; defaults to the intent's policy. */
  readonly ttlMsOverride?: number;
  /** Caller-supplied cache id; should be derived from a thoughtId. */
  readonly cacheId: string;
}

export interface SemanticCache {
  /** Check the cache; returns `hit`, `miss` (with embedding for re-use), or `skip`. */
  lookup(args: SemanticCacheLookupArgs): Promise<SemanticCacheLookupResult>;
  /** Store a fresh BrainDecision under the previously-computed embedding. */
  store(args: SemanticCacheStoreArgs): Promise<void>;
  /** Drop every entry under a scope. */
  clearScope(scope: SemanticCacheScope): Promise<void>;
  /** Drop EVERY entry across every scope. */
  clearAll(): Promise<void>;
}

export function createSemanticCache(deps: SemanticCacheDeps): SemanticCache {
  if (!deps.store) throw new Error('createSemanticCache: store is required');
  if (!deps.embedder) {
    throw new Error('createSemanticCache: embedder is required');
  }
  const defaultThreshold = deps.defaultThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const rates = deps.costRates ?? createCostRateRegistry();
  const clock = deps.clock ?? (() => new Date());

  function resolveThreshold(scope: SemanticCacheScope, override?: number): number {
    if (typeof override === 'number' && Number.isFinite(override)) {
      return clampThreshold(override);
    }
    if (deps.thresholdForTenant) {
      const t = deps.thresholdForTenant(scope.tenantId);
      if (typeof t === 'number' && Number.isFinite(t)) return clampThreshold(t);
    }
    return defaultThreshold;
  }

  function emit(event: SemanticCacheTelemetryEvent): void {
    if (!deps.telemetrySink) return;
    try {
      const ret = deps.telemetrySink.record(event);
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* swallow — telemetry is a side-channel */
    }
  }

  return {
    async lookup(args) {
      const intent = args.intent ?? classifyIntent(args.userMessage).intent;
      const occurredAt = clock().toISOString();
      const rate = rates.rateFor(args.answeringModelId);
      const wouldBeCost = computeCostUsdMicros(
        rate,
        args.estimatedPromptTokens ?? 0,
        args.estimatedCompletionTokens ?? 0,
      );
      if (intent === 'command') {
        emit({
          outcome: 'skip',
          scope: args.scope,
          intent,
          similarity: null,
          threshold: resolveThreshold(args.scope, args.thresholdOverride),
          costUsdMicros: 0,
          modelId: args.answeringModelId,
          promptTokens: args.estimatedPromptTokens ?? 0,
          completionTokens: args.estimatedCompletionTokens ?? 0,
          occurredAt,
          skipReason: 'intent=command',
        });
        return { outcome: 'skip', reason: 'intent=command' };
      }
      const embedding = await deps.embedder.embedForCache(
        args.scope,
        args.userMessage,
      );
      if (!embedding || embedding.length === 0) {
        emit({
          outcome: 'skip',
          scope: args.scope,
          intent,
          similarity: null,
          threshold: resolveThreshold(args.scope, args.thresholdOverride),
          costUsdMicros: 0,
          modelId: args.answeringModelId,
          promptTokens: args.estimatedPromptTokens ?? 0,
          completionTokens: args.estimatedCompletionTokens ?? 0,
          occurredAt,
          skipReason: 'embedder-failed',
        });
        return { outcome: 'skip', reason: 'embedder-failed' };
      }
      const threshold = resolveThreshold(args.scope, args.thresholdOverride);
      const hit = await deps.store.get(args.scope, embedding, threshold);
      if (hit) {
        emit({
          outcome: 'hit',
          scope: args.scope,
          intent,
          similarity: hit.similarity,
          threshold,
          costUsdMicros: wouldBeCost, // hit ⇒ this is what we saved
          modelId: args.answeringModelId,
          promptTokens: args.estimatedPromptTokens ?? 0,
          completionTokens: args.estimatedCompletionTokens ?? 0,
          occurredAt,
          skipReason: null,
        });
        return {
          outcome: 'hit',
          value: hit.entry.value,
          similarity: hit.similarity,
          cacheId: hit.entry.cacheId,
        };
      }
      emit({
        outcome: 'miss',
        scope: args.scope,
        intent,
        similarity: null,
        threshold,
        costUsdMicros: wouldBeCost, // miss ⇒ this is what we are ABOUT to spend
        modelId: args.answeringModelId,
        promptTokens: args.estimatedPromptTokens ?? 0,
        completionTokens: args.estimatedCompletionTokens ?? 0,
        occurredAt,
        skipReason: null,
      });
      return { outcome: 'miss', embedding };
    },

    async store(args) {
      const intent = args.intent ?? classifyIntent(args.userMessage).intent;
      const ttlMs =
        args.ttlMsOverride !== undefined
          ? args.ttlMsOverride
          : SEMANTIC_CACHE_TTL_MS_BY_INTENT[intent];
      if (ttlMs <= 0) return;
      await deps.store.set(args.scope, {
        cacheId: args.cacheId,
        embedding: args.embedding,
        value: args.value,
        ttlMs,
      });
    },

    async clearScope(scope) {
      await deps.store.clear(scope);
    },

    async clearAll() {
      await deps.store.clearAll();
    },
  };
}

function clampThreshold(t: number): number {
  if (t < -1) return -1;
  if (t > 1) return 1;
  return t;
}
