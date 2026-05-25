/**
 * Brain-side cache — small LRU keyed on the *thought* parameters
 * (scope + persona + tier + message hash + stakes). Distinct from
 * the LLM provider's prompt cache:
 *
 *   - the LLM cache amortises prefix tokens within a SESSION
 *   - the brain cache de-duplicates ENTIRE thoughts across sessions
 *
 * Defaults: 64 entries, 60s TTL. Both deliberately small — the cache
 * exists to absorb burst traffic (a frantic re-click) and preserve
 * provenance idempotency. It is NOT a long-term answer store.
 *
 * LITFIN-parity additions (Wave K, `.planning/parity-litfin/
 * 04-sensors-routing.md` section 4 + section 7 #5):
 *
 *   - Pattern families: "hi"/"hello"/"habari"/"jambo"/"mambo" all hash
 *     to a SINGLE greeting cache key per scope/persona, so 5 different
 *     pleasantries from 5 users in the same agency share one entry.
 *   - Intent-tiered TTL: greeting = 5 min, question = 60 s, command =
 *     0 (never cached — every command is too contextual to re-use).
 *   - `cacheKeyForRequest(req)`: pattern-aware sibling of
 *     `thoughtCacheKey(req)` that returns BOTH the key and the inferred
 *     intent so the caller can apply the matching TTL.
 *
 * Per-user isolation is PRESERVED — `actorUserId` is still part of the
 * payload because the brain is personal AI per user. Two users in the
 * same tenant sharing the exact same greeting still get distinct cache
 * entries (one per user); the pattern family just makes "hi" and
 * "habari" collapse to the same per-user entry.
 *
 * Pure data structure with an injectable clock; no IO.
 */

import { createHash } from 'crypto';
import type { ScopeContext } from '../types.js';
import type { AwarenessTier, BrainDecision, ThoughtRequest } from './kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// Intent + tiered TTL
// ─────────────────────────────────────────────────────────────────────

export type CacheIntent =
  | 'greeting'
  | 'acknowledgment'
  | 'farewell'
  | 'platform_intro'
  | 'question'
  | 'command';

export const DEFAULT_INTENT_TTL_MS: Readonly<Record<CacheIntent, number>> = Object.freeze({
  greeting: 5 * 60_000,
  acknowledgment: 5 * 60_000,
  farewell: 5 * 60_000,
  platform_intro: 5 * 60_000,
  question: 60_000,
  // Commands are mutation-bearing — never cache them. A `set()` with
  // a ttl of 0 immediately evicts; `get()` always misses.
  command: 0,
});

// ─────────────────────────────────────────────────────────────────────
// Pattern families — multilingual greeting / acknowledgment / farewell
//
// Swahili coverage: habari, jambo, mambo, hujambo, salama, shikamoo,
// asante, nashukuru, kwaheri, tutaonana. The brain is "built for the
// world starting with TZ" — defaults like sw/en/fr/ar live here, not
// in business logic, so the cache hit rate stays high regardless of
// the user's language.
// ─────────────────────────────────────────────────────────────────────

interface PatternFamily {
  readonly key: string;
  readonly intent: CacheIntent;
  readonly pattern: RegExp;
}

const PATTERN_FAMILIES: ReadonlyArray<PatternFamily> = [
  {
    key: 'greeting',
    intent: 'greeting',
    pattern:
      /^(hi|hello|hey|yo|sup|howdy|greetings|habari|mambo|jambo|hujambo|salama|shikamoo|good\s*(morning|afternoon|evening|day))[!.\s]*$/i,
  },
  {
    key: 'acknowledgment',
    intent: 'acknowledgment',
    pattern:
      /^(thanks|thank\s*you|asante|asante\s*sana|nashukuru|awesome|great|ok|okay|cool|got\s*it|noted|nice|perfect)[!.\s]*$/i,
  },
  {
    key: 'farewell',
    intent: 'farewell',
    pattern:
      /^(bye|goodbye|see\s*you|kwaheri|tutaonana|goodnight|cheers)[!.\s]*$/i,
  },
  {
    key: 'platform_intro',
    intent: 'platform_intro',
    pattern:
      /^(what\s+(?:is|does)\s+borjie|tell\s+me\s+about\s+borjie|what\s+can\s+you\s+do|who\s+are\s+you|nini\s+borjie)\??$/i,
  },
];

const COMMAND_PREFIX = /^(?:please\s+)?(?:run|send|file|create|delete|update|email|escalate|approve|reject|pay|charge|refund)\b/i;

/**
 * Detect a message's intent + pattern-family key (if any). Pure.
 */
export function classifyIntent(
  userMessage: string,
): { intent: CacheIntent; familyKey: string | null } {
  const trimmed = userMessage.trim();
  if (trimmed.length === 0) {
    return { intent: 'question', familyKey: null };
  }
  for (const f of PATTERN_FAMILIES) {
    if (f.pattern.test(trimmed)) {
      return { intent: f.intent, familyKey: f.key };
    }
  }
  if (COMMAND_PREFIX.test(trimmed)) {
    return { intent: 'command', familyKey: null };
  }
  return { intent: 'question', familyKey: null };
}

// ─────────────────────────────────────────────────────────────────────
// Cache surface
// ─────────────────────────────────────────────────────────────────────

export interface BrainCache {
  readonly capacity: number;
  readonly ttlMs: number;
  get(key: string): BrainDecision | null;
  /** Optional `ttlMs` overrides the default per-entry. */
  set(key: string, value: BrainDecision, ttlMs?: number): void;
  delete(key: string): void;
  size(): number;
  clear(): void;
}

export interface BrainCacheDeps {
  readonly capacity?: number;
  readonly ttlMs?: number;
  readonly clock?: () => number;
}

interface Entry {
  readonly value: BrainDecision;
  readonly expiresAt: number;
}

export function createBrainCache(deps: BrainCacheDeps = {}): BrainCache {
  const capacity = deps.capacity ?? 64;
  const ttlMs = deps.ttlMs ?? 60_000;
  const clock = deps.clock ?? Date.now;
  const map = new Map<string, Entry>();

  function gc(): void {
    const now = clock();
    for (const [k, e] of map) if (e.expiresAt <= now) map.delete(k);
  }

  return {
    capacity,
    ttlMs,
    get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.expiresAt <= clock()) {
        map.delete(key);
        return null;
      }
      // LRU touch.
      map.delete(key);
      map.set(key, e);
      return e.value;
    },
    set(key, value, perCallTtlMs) {
      const effective = perCallTtlMs ?? ttlMs;
      // ttl 0 → do not store (matches command-intent semantics).
      if (effective <= 0) {
        map.delete(key);
        return;
      }
      gc();
      if (map.has(key)) map.delete(key);
      map.set(key, { value, expiresAt: clock() + effective });
      while (map.size > capacity) {
        const oldest = map.keys().next().value as string | undefined;
        if (!oldest) break;
        map.delete(oldest);
      }
    },
    delete(key) {
      map.delete(key);
    },
    size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Key derivation
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key for a thought request.
 *
 * IMPORTANT — `req.scope.actorUserId` is part of the hash payload because
 * the brain is *personal AI per user*. Two users in the same agency tenant
 * who happen to ask the exact same question must NOT share a cache entry,
 * since each thought is grounded against the actor's own permissions, voice,
 * and provenance. Cache must not bleed between users in the same tenant.
 */
export function thoughtCacheKey(req: ThoughtRequest): string {
  const tenantPart = req.scope.kind === 'tenant' ? req.scope.tenantId : '__platform__';
  const payload = [
    req.scope.kind,
    tenantPart,
    req.scope.actorUserId,
    req.scope.personaId,
    req.tier as AwarenessTier,
    req.surface,
    req.stakes,
    sha(req.userMessage.trim()),
  ].join('|');
  return sha(payload);
}

/**
 * Pattern-family-aware sibling of `thoughtCacheKey`. Returns the key,
 * the inferred intent, and a recommended TTL the caller can pass into
 * `cache.set(key, value, ttl)`. Cache hit on "hi" is also a hit on
 * "habari" within the same (scope, user, persona, tier, surface).
 */
export function cacheKeyForRequest(
  req: ThoughtRequest,
): { key: string; intent: CacheIntent; ttlMs: number } {
  const { intent, familyKey } = classifyIntent(req.userMessage);
  const tenantPart =
    req.scope.kind === 'tenant' ? req.scope.tenantId : '__platform__';
  const messageDimension = familyKey
    ? `__family__:${familyKey}`
    : sha(req.userMessage.trim());
  const payload = [
    req.scope.kind,
    tenantPart,
    req.scope.actorUserId,
    req.scope.personaId,
    req.tier as AwarenessTier,
    req.surface,
    req.stakes,
    messageDimension,
  ].join('|');
  return {
    key: sha(payload),
    intent,
    ttlMs: DEFAULT_INTENT_TTL_MS[intent],
  };
}

function sha(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);
}

/** Re-export the type so other modules don't need the `import type`. */
export type { ScopeContext };
