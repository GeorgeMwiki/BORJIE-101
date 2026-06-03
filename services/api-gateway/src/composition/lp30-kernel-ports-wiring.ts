/**
 * LP-30 kernel-port wiring — the composition-root activation of the
 * semantic-cache (LP-03) and intent-verifier (LP-04) seams the kernel
 * already consumes (`BrainKernelDeps.semanticCache` / `.intentVerifier`).
 *
 * Background
 * ----------
 * Commit 705efc75 added the kernel-side consumption of both ports plus the
 * `SemanticCachePort` / `IntentVerifierPort` types, but left the concrete
 * adapters dark ("flags default-off pending LP-30 canary"). This module is
 * that canary: it builds real, fail-safe adapters at the api-gateway
 * composition root.
 *
 *   - `buildSemanticCachePort` — an embedding-keyed, cosine-similarity
 *     read-through / write-through cache scoped per (tenantId, surface,
 *     personaId). Reuses the SAME `EmbedderPort` the kernel + skill
 *     retriever use (OpenAI when keyed; the always-rejects null embedder
 *     otherwise, in which case the cache degrades to a permanent miss).
 *     Default ENABLED; a miss falls through to the normal sensor path so
 *     the worst case is "no cache", never a wrong answer.
 *
 *   - `buildIntentVerifierPort` — adapts `@borjie/autonomy-governance`
 *     `verifyIntent` (a pure rule-based fn) to the kernel's
 *     `IntentVerifierPort`. ADVISORY by default: in advisory posture a
 *     `permitted:false` rule match is LOGGED but the verdict returned to
 *     the kernel stays `permitted:true` (the kernel never blocks the tool
 *     call). Flip `BORJIE_INTENT_VERIFY_STRICT=1` for fail-closed posture,
 *     where the real `permitted:false` verdict is honoured and the kernel
 *     drops the offending tool call. NEVER default-blocks.
 *
 * Dependency discipline: this module imports the kernel PORT types from
 * `@borjie/central-intelligence` (barrel) and the verifier fn from
 * `@borjie/autonomy-governance`. The semantic-cache adapter is built
 * in-process (no DB dependency) so the gateway boots without external
 * infrastructure; a Redis-backed store is a drop-in follow-up behind the
 * same `SemanticCachePort`.
 *
 * Immutability + logging: frozen results, no caller mutation, Pino logger
 * only (no console.*).
 *
 * @module services/api-gateway/src/composition/lp30-kernel-ports-wiring
 */

import {
  type BrainDecision,
  type EmbedderPort,
  type IntentVerifierPort,
  type IntentVerifierRequest,
  type IntentVerifierVerdict,
  type SemanticCachePort,
} from '@borjie/central-intelligence';
import { verifyIntent } from '@borjie/autonomy-governance';

// The `SemanticCachePort` method-arg + result types are NOT re-exported from
// the package barrel (only the port itself is), so we derive them from the
// port to stay on the public surface without a deep import.
type SemanticCacheLookupArgsLike = Parameters<SemanticCachePort['lookup']>[0];
type SemanticCacheLookupResultLike = Awaited<
  ReturnType<SemanticCachePort['lookup']>
>;
type SemanticCacheStoreArgsLike = Parameters<SemanticCachePort['store']>[0];

// ---------------------------------------------------------------------------
// Narrow structured-logger shape (matches utils/logger.ts return value).
// ---------------------------------------------------------------------------

export interface Lp30Logger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
}

// ---------------------------------------------------------------------------
// Flag resolution
// ---------------------------------------------------------------------------

export const SEMANTIC_CACHE_FLAG = 'BORJIE_SEMANTIC_CACHE_ENABLED';
export const INTENT_VERIFIER_FLAG = 'BORJIE_INTENT_VERIFIER_ENABLED';
export const INTENT_VERIFY_STRICT_FLAG = 'BORJIE_INTENT_VERIFY_STRICT';

/** A flag that defaults ON: only the literal `'0'` / `'false'` disables it. */
function flagDefaultOn(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** A flag that defaults OFF: only the literal `'1'` / `'true'` enables it. */
function flagDefaultOff(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

// ---------------------------------------------------------------------------
// Semantic cache — embedding-keyed, cosine-similarity, in-memory.
// ---------------------------------------------------------------------------

/** Default cosine-similarity threshold for a cache hit. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.95;
/** Default TTL for a cached answer. */
const DEFAULT_TTL_MS = 5 * 60_000;
/** Per-scope entry cap so the in-memory cache never grows unbounded. */
const MAX_ENTRIES_PER_SCOPE = 256;

interface CacheEntry {
  readonly embedding: ReadonlyArray<number>;
  readonly value: BrainDecision;
  readonly expiresAt: number;
  readonly cacheId: string;
}

function scopeKeyOf(args: {
  readonly tenantId: string | null;
  readonly surface: string;
  readonly personaId: string;
}): string {
  return `${args.tenantId ?? 'platform'}::${args.surface}::${args.personaId}`;
}

function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface BuildSemanticCacheArgs {
  /** Embedder shared with the kernel (OpenAI when keyed, else null sentinel). */
  readonly embedder: EmbedderPort;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: Lp30Logger;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
  /** Override similarity threshold (default 0.95). */
  readonly similarityThreshold?: number;
}

export interface BuiltSemanticCache {
  /** The port to thread into `composeSovereign({ semanticCache })`. */
  readonly port: SemanticCachePort;
  /** Whether the master flag enabled the cache (default ON). */
  readonly enabled: boolean;
}

/**
 * Build the semantic-cache port. Fail-safe by construction: every lookup
 * that cannot produce an embedding (null embedder, embed error) returns a
 * `skip` so the kernel proceeds to the sensor; every store error is
 * swallowed. The cache NEVER serves a refusal or softened reply (only
 * `answer` decisions are written), mirroring the kernel's own contract.
 */
export function buildSemanticCachePort(
  args: BuildSemanticCacheArgs,
): BuiltSemanticCache {
  const env = args.env ?? process.env;
  const enabled = flagDefaultOn(env, SEMANTIC_CACHE_FLAG);
  const clock = args.now ?? Date.now;
  const threshold = args.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  // Null embedder (no OpenAI key) cannot produce meaningful vectors; in that
  // mode every lookup skips so the cache is inert but harmless.
  const embedderLive = args.embedder.modelId !== 'null';

  const store = new Map<string, CacheEntry[]>();

  const embed = async (
    text: string,
  ): Promise<ReadonlyArray<number> | null> => {
    if (!embedderLive) return null;
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    try {
      const vec = await args.embedder.embed(trimmed);
      return vec.length > 0 ? vec : null;
    } catch (err) {
      args.logger?.warn?.(
        {
          wiring: 'lp30-semantic-cache',
          error: err instanceof Error ? err.message : String(err),
        },
        'lp30-semantic-cache: embed failed; treating as cache miss',
      );
      return null;
    }
  };

  const lookup = async (
    lookupArgs: SemanticCacheLookupArgsLike,
  ): Promise<SemanticCacheLookupResultLike> => {
    const embedding = await embed(lookupArgs.userMessage);
    if (embedding === null) {
      return { outcome: 'skip', reason: 'no-embedding' };
    }
    const key = scopeKeyOf(lookupArgs.scope);
    const bucket = store.get(key) ?? [];
    const now = clock();
    let best: { entry: CacheEntry; sim: number } | null = null;
    for (const entry of bucket) {
      if (entry.expiresAt <= now) continue;
      const sim = cosineSimilarity(embedding, entry.embedding);
      if (best === null || sim > best.sim) best = { entry, sim };
    }
    const effectiveThreshold = lookupArgs.thresholdOverride ?? threshold;
    if (best !== null && best.sim >= effectiveThreshold) {
      return {
        outcome: 'hit',
        value: best.entry.value,
        similarity: best.sim,
        cacheId: best.entry.cacheId,
      };
    }
    return { outcome: 'miss', embedding };
  };

  const persist = async (
    storeArgs: SemanticCacheStoreArgsLike,
  ): Promise<void> => {
    // Only answers are cached (refusals/softened are request-frame specific).
    if (storeArgs.value.kind !== 'answer') return;
    if (storeArgs.embedding.length === 0) return;
    const key = scopeKeyOf(storeArgs.scope);
    const ttl = storeArgs.ttlMsOverride ?? DEFAULT_TTL_MS;
    const entry: CacheEntry = {
      embedding: storeArgs.embedding,
      value: storeArgs.value,
      expiresAt: clock() + ttl,
      cacheId: storeArgs.cacheId,
    };
    const bucket = store.get(key) ?? [];
    const next = [...bucket.filter((e) => e.cacheId !== entry.cacheId), entry];
    // Bound the bucket: drop the oldest-expiring entries past the cap.
    const bounded =
      next.length > MAX_ENTRIES_PER_SCOPE
        ? [...next].sort((a, b) => b.expiresAt - a.expiresAt).slice(0, MAX_ENTRIES_PER_SCOPE)
        : next;
    store.set(key, bounded);
  };

  const port: SemanticCachePort = {
    lookup,
    store: persist,
  };

  return Object.freeze({ port, enabled });
}

// ---------------------------------------------------------------------------
// Intent verifier — adapts autonomy-governance `verifyIntent` to the port.
// ---------------------------------------------------------------------------

export type IntentVerifyPosture = 'advisory' | 'strict';

export interface BuildIntentVerifierArgs {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: Lp30Logger;
}

export interface BuiltIntentVerifier {
  /** The port to thread into `composeSovereign({ intentVerifier })`. */
  readonly port: IntentVerifierPort;
  /** Whether the master flag enabled the verifier (default ON). */
  readonly enabled: boolean;
  /** Resolved posture — `'advisory'` (default) or `'strict'`. */
  readonly posture: IntentVerifyPosture;
}

/**
 * Build the intent-verifier port. The underlying `verifyIntent` is a pure
 * rule-based scanner (SQL-injection / data-exfil / prompt-injection-in-args).
 *
 * Posture:
 *   - ADVISORY (default): a `permitted:false` rule match is LOGGED with the
 *     matched rule, but the verdict returned to the kernel is forced to
 *     `permitted:true` so NO tool call is blocked during the canary. This
 *     lets operators observe what WOULD be blocked before enforcing.
 *   - STRICT (`BORJIE_INTENT_VERIFY_STRICT=1`): the real verdict is returned;
 *     a `permitted:false` causes the kernel to drop the offending tool call.
 *
 * Fail-OPEN on internal error: any thrown error inside the verifier resolves
 * to `permitted:true` (the kernel's own gate ALSO fails open, this is belt
 * and braces). NEVER default-blocks.
 */
export function buildIntentVerifierPort(
  args: BuildIntentVerifierArgs = {},
): BuiltIntentVerifier {
  const env = args.env ?? process.env;
  const enabled = flagDefaultOn(env, INTENT_VERIFIER_FLAG);
  const strict = flagDefaultOff(env, INTENT_VERIFY_STRICT_FLAG);
  const posture: IntentVerifyPosture = strict ? 'strict' : 'advisory';

  const verify = (
    req: IntentVerifierRequest,
  ): IntentVerifierVerdict => {
    let raw: ReturnType<typeof verifyIntent>;
    try {
      raw = verifyIntent({
        toolName: req.toolName,
        toolArgs: req.toolArgs,
        userMessage: req.userMessage,
        sessionContext: {
          recentTools: req.sessionContext.recentTools,
          recentTopics: req.sessionContext.recentTopics,
          escalationCount: req.sessionContext.escalationCount,
          ...(req.sessionContext.orgId !== undefined
            ? { orgId: req.sessionContext.orgId }
            : {}),
          ...(req.sessionContext.tenantId !== undefined
            ? { tenantId: req.sessionContext.tenantId }
            : {}),
          ...(req.sessionContext.userId !== undefined
            ? { userId: req.sessionContext.userId }
            : {}),
        },
      });
    } catch (err) {
      // Fail-OPEN on verifier error.
      return Object.freeze({
        permitted: true,
        confidence: 0,
        reason: `intent-verifier error (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    if (!raw.permitted && posture === 'advisory') {
      // Advisory: log what WOULD be blocked, but do not block.
      args.logger?.warn?.(
        {
          wiring: 'lp30-intent-verifier',
          posture,
          toolName: req.toolName,
          matchedRule: raw.matchedRule ?? null,
          reason: raw.reason,
        },
        'lp30-intent-verifier: advisory — tool call WOULD be blocked in strict posture',
      );
      return Object.freeze({
        permitted: true,
        confidence: raw.confidence,
        reason: `advisory (not enforced): ${raw.reason}`,
        ...(raw.matchedRule !== undefined ? { matchedRule: raw.matchedRule } : {}),
      });
    }

    // Strict posture (or a permitted verdict): pass the real verdict through.
    return Object.freeze({
      permitted: raw.permitted,
      confidence: raw.confidence,
      reason: raw.reason,
      ...(raw.matchedRule !== undefined ? { matchedRule: raw.matchedRule } : {}),
    });
  };

  return Object.freeze({ port: { verify }, enabled, posture });
}

// ---------------------------------------------------------------------------
// Internal exports for tests.
// ---------------------------------------------------------------------------

export const __testables = Object.freeze({
  cosineSimilarity,
  scopeKeyOf,
  flagDefaultOn,
  flagDefaultOff,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TTL_MS,
  MAX_ENTRIES_PER_SCOPE,
});
