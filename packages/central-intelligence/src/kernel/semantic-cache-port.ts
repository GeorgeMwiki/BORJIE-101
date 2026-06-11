/**
 * Semantic-cache kernel port — LP-03.
 *
 * Wires the EXISTING `./semantic-cache/` embedding-keyed cache into the
 * brain `think()` path as a read-through / write-through underlay BELOW the
 * exact-key L1 brain-cache:
 *
 *   L1 brain-cache (exact key, ~0ms)  →  MISS
 *     └─ L2 semantic cache (embedding cosine match, this port)  →  HIT?
 *          ├─ hit  → replay the cached BrainDecision (no sensor spend)
 *          └─ miss → run the sensor, then write-through the decision
 *
 * Scoping: every entry is namespaced under `(tenantId, surface, personaId)`
 * so tenant A's cache can never satisfy tenant B's prompt. The scope is
 * built from the live `ThoughtRequest` frame by {@link buildSemanticScope}.
 *
 * Dependency discipline: the concrete cache is constructed at the api-gateway
 * composition root (it needs an embedder + store) and injected via
 * `BrainKernelDeps.semanticCache`. This module declares a NARROW port so the
 * kernel does not widen its public type surface, and provides two fail-safe
 * wrappers the kernel calls at the two existing cache seams.
 *
 * Fail-safe contract (NEVER throws into the hot path):
 *   - No cache wired / flag off       → read returns `null`, write is a no-op.
 *   - `lookup` throws or returns skip  → read returns `null` (treat as miss).
 *   - `store` throws                   → swallowed (write is best-effort).
 *
 * Only `answer` decisions are cached on write. Refusals and softened replies
 * are intentionally NOT cached: a refusal is often request-frame-specific and
 * replaying it on a near-miss embedding could wrongly deny a benign turn.
 *
 * @module @borjie/central-intelligence/kernel/semantic-cache-port
 */

import type { BrainDecision } from './kernel-types.js';
import type { CacheIntent } from './brain-cache.js';

// ---------------------------------------------------------------------------
// Narrow port — structurally a subset of `SemanticCache` (semantic-cache.ts)
// ---------------------------------------------------------------------------

export interface SemanticScope {
  readonly tenantId: string | null;
  readonly surface: string;
  readonly personaId: string;
  /**
   * Active render locale (`en` default / `sw` toggle). Part of the cache
   * key so the EN/SW ABSOLUTE rule (CLAUDE.md) holds at the cache boundary —
   * an `en` turn can NEVER replay a cached `sw` answer. Omitted ⇒ `en`.
   */
  readonly locale?: string;
}

export interface SemanticCacheLookupArgsLike {
  readonly scope: SemanticScope;
  readonly userMessage: string;
  readonly intent?: CacheIntent;
  readonly answeringModelId: string;
  readonly estimatedPromptTokens?: number;
  readonly estimatedCompletionTokens?: number;
  readonly thresholdOverride?: number;
}

export type SemanticCacheLookupResultLike =
  | {
      readonly outcome: 'hit';
      readonly value: BrainDecision;
      readonly similarity: number;
      readonly cacheId: string;
    }
  | { readonly outcome: 'miss'; readonly embedding: ReadonlyArray<number> }
  | { readonly outcome: 'skip'; readonly reason: string };

export interface SemanticCacheStoreArgsLike {
  readonly scope: SemanticScope;
  readonly userMessage: string;
  readonly intent?: CacheIntent;
  readonly embedding: ReadonlyArray<number>;
  readonly value: BrainDecision;
  readonly ttlMsOverride?: number;
  readonly cacheId: string;
}

/**
 * The injected port. The composition root binds this to the concrete
 * `createSemanticCache(...)` instance from `./semantic-cache/`.
 */
export interface SemanticCachePort {
  lookup(
    args: SemanticCacheLookupArgsLike,
  ): Promise<SemanticCacheLookupResultLike>;
  store(args: SemanticCacheStoreArgsLike): Promise<void>;
}

// ---------------------------------------------------------------------------
// Scope builder
// ---------------------------------------------------------------------------

/**
 * Build the cache scope from the request frame. `tenantId` is null for
 * platform-tier / unauthenticated surfaces. `surface` and `personaId` fall
 * back to stable defaults so the key never contains `undefined`.
 */
export function buildSemanticScope(args: {
  readonly tenantId: string | null;
  readonly surface: string | undefined;
  readonly personaId: string | undefined;
  /** Active locale; defaults to `en` (CLAUDE.md EN/SW absolute). */
  readonly locale?: string | undefined;
}): SemanticScope {
  return Object.freeze({
    tenantId: args.tenantId,
    surface:
      typeof args.surface === 'string' && args.surface.length > 0
        ? args.surface
        : 'unknown-surface',
    personaId:
      typeof args.personaId === 'string' && args.personaId.length > 0
        ? args.personaId
        : 'mr-mwikila',
    locale:
      typeof args.locale === 'string' && args.locale.length > 0
        ? args.locale
        : 'en',
  });
}

// ---------------------------------------------------------------------------
// Read-through
// ---------------------------------------------------------------------------

export interface SemanticCacheReadArgs {
  readonly cache: SemanticCachePort | undefined;
  /** Master flag. When false the read is a no-op (returns null). */
  readonly enabled: boolean;
  readonly scope: SemanticScope;
  readonly userMessage: string;
  /** Model that would answer on a miss (for cost telemetry). */
  readonly answeringModelId: string;
}

export interface SemanticCacheReadResult {
  /** Cached decision on an embedding hit; null on miss / skip / disabled. */
  readonly hit: BrainDecision | null;
  readonly similarity: number | null;
  readonly cacheId: string | null;
  /**
   * The query embedding from a miss. Re-used by {@link semanticCacheWrite} so
   * the write side does not re-embed the same text. Null on hit / skip.
   */
  readonly missEmbedding: ReadonlyArray<number> | null;
}

const EMPTY_READ: SemanticCacheReadResult = Object.freeze({
  hit: null,
  similarity: null,
  cacheId: null,
  missEmbedding: null,
});

/**
 * Read-through lookup. Returns the cached `BrainDecision` on an embedding
 * hit, otherwise null (and carries the miss embedding for the write side).
 * NEVER throws.
 */
export async function semanticCacheRead(
  args: SemanticCacheReadArgs,
): Promise<SemanticCacheReadResult> {
  if (!args.enabled || args.cache === undefined) return EMPTY_READ;
  const trimmed = args.userMessage.trim();
  if (trimmed.length === 0) return EMPTY_READ;
  try {
    const result = await args.cache.lookup({
      scope: args.scope,
      userMessage: args.userMessage,
      answeringModelId: args.answeringModelId,
    });
    if (result.outcome === 'hit') {
      return Object.freeze({
        hit: result.value,
        similarity: result.similarity,
        cacheId: result.cacheId,
        missEmbedding: null,
      });
    }
    if (result.outcome === 'miss') {
      return Object.freeze({
        hit: null,
        similarity: null,
        cacheId: null,
        missEmbedding: result.embedding,
      });
    }
    // 'skip' — treat as a miss with no embedding (cannot write-through).
    return EMPTY_READ;
  } catch {
    // Fail-safe: any cache error is treated as a miss.
    return EMPTY_READ;
  }
}

// ---------------------------------------------------------------------------
// Write-through
// ---------------------------------------------------------------------------

export interface SemanticCacheWriteArgs {
  readonly cache: SemanticCachePort | undefined;
  readonly enabled: boolean;
  readonly scope: SemanticScope;
  readonly userMessage: string;
  readonly decision: BrainDecision;
  /** Embedding from the prior read miss; required to avoid a second embed. */
  readonly missEmbedding: ReadonlyArray<number> | null;
  /** Cache id derived from the turn's thoughtId. */
  readonly cacheId: string;
}

/**
 * Write-through a fresh decision. Best-effort: NEVER throws, and only
 * `answer` decisions with a usable miss-embedding are persisted (see module
 * doc for why refusals / softened replies are excluded).
 */
export async function semanticCacheWrite(
  args: SemanticCacheWriteArgs,
): Promise<void> {
  if (!args.enabled || args.cache === undefined) return;
  if (args.missEmbedding === null || args.missEmbedding.length === 0) return;
  if (args.decision.kind !== 'answer') return;
  try {
    await args.cache.store({
      scope: args.scope,
      userMessage: args.userMessage,
      embedding: args.missEmbedding,
      value: args.decision,
      cacheId: args.cacheId,
    });
  } catch {
    // Best-effort write; a store failure must not affect the served turn.
  }
}
