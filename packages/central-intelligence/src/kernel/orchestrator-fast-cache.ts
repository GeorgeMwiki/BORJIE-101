/**
 * Orchestrator-path latency wins — semantic-cache lighting + fast-path
 * model tiering, applied AROUND the orchestrator main-loop delegation in
 * `kernel.think()`.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The semantic cache (`./semantic-cache/`) + its read/write port
 * (`./semantic-cache-port.ts`) were wired ONLY into the legacy 13-step
 * pipeline (steps 1b + 13). But the live production path is the
 * orchestrator main-loop (DEFAULT-ON; see `resolveOrchestratorRoutingEnabled`),
 * which `think()` delegates to BEFORE ever reaching those steps. So the
 * cache was BUILT BUT DARK on every real turn — users paid a full
 * LATS/debate/multi-agent round trip for "what's the royalty rate?" even
 * when an identical, evidence-backed answer was already on file.
 *
 * This module exposes two pure, fail-safe helpers the kernel calls on the
 * orchestrator path:
 *
 *   1. {@link readOrchestratorSemanticCache} — embedding-cosine lookup
 *      scoped per (tenantId, surface, personaId, locale). On a hit above
 *      threshold it returns the cached `BrainDecision` WITH its preserved
 *      citations/evidence, so the user gets an instant, grounded answer.
 *      A cache-hit marker is stamped onto provenance (`cacheHit: true`).
 *
 *   2. {@link writeOrchestratorSemanticCache} — best-effort write-through
 *      of fresh, evidence-backed `answer` decisions. Refusals / softened
 *      replies / evidence-empty answers are NEVER cached.
 *
 * SECURITY (MANDATORY): the scope key includes tenantId AND locale. A
 * tenant can NEVER receive another tenant's cache entry; an `en` turn can
 * NEVER replay a `sw` answer. Both guarantees come from `scopeKey` in
 * `./semantic-cache/cache-store.ts`.
 *
 * CACHE-ONLY-WHAT-IS-SAFE: write-through is gated on
 *   - decision.kind === 'answer'
 *   - at least one citation (evidence-backed; CLAUDE.md evidence-required)
 * so an ungrounded or sensitive answer never becomes a replayable entry.
 *
 * Everything here NEVER throws into the hot path — the kernel always
 * proceeds to (or returns from) the orchestrator on any cache fault.
 *
 * @module @borjie/central-intelligence/kernel/orchestrator-fast-cache
 */

import type { BrainDecision, ThoughtRequest } from './kernel-types.js';
import {
  type SemanticCachePort,
  buildSemanticScope,
  semanticCacheRead,
  semanticCacheWrite,
  type SemanticScope,
} from './semantic-cache-port.js';

/** Resolve the active locale for a turn (CLAUDE.md: `en` default, `sw` toggle). */
export function resolveTurnLocale(req: ThoughtRequest): 'en' | 'sw' {
  return req.language === 'sw' ? 'sw' : 'en';
}

/**
 * Build the orchestrator-path cache scope from the request frame. Mirrors
 * the legacy-pipeline scope EXACTLY (tenant + surface + persona) and adds
 * the locale dimension so EN/SW never cross.
 */
export function buildOrchestratorScope(req: ThoughtRequest): SemanticScope {
  const tenantId = req.scope.kind === 'tenant' ? req.scope.tenantId : null;
  return buildSemanticScope({
    tenantId,
    surface: req.surface,
    personaId: req.scope.personaId,
    locale: resolveTurnLocale(req),
  });
}

export interface OrchestratorCacheReadResult {
  /** The cached decision on a hit; null on miss / skip / disabled / fault. */
  readonly hit: BrainDecision | null;
  /** Cosine similarity of the hit (null when no hit). */
  readonly similarity: number | null;
  /**
   * Query embedding from a MISS — handed to the write side so it does not
   * re-embed the same text. Null on hit / skip / disabled.
   */
  readonly missEmbedding: ReadonlyArray<number> | null;
}

const EMPTY_READ: OrchestratorCacheReadResult = Object.freeze({
  hit: null,
  similarity: null,
  missEmbedding: null,
});

export interface ReadOrchestratorCacheArgs {
  readonly cache: SemanticCachePort | undefined;
  readonly enabled: boolean;
  readonly req: ThoughtRequest;
  readonly scope: SemanticScope;
  /** Model that would answer on a miss (cost telemetry). */
  readonly answeringModelId: string;
}

/**
 * Read-through the semantic cache for an orchestrator-path turn. Returns
 * the cached `BrainDecision` (citations preserved) on an embedding hit,
 * otherwise carries the miss embedding for the write side. NEVER throws.
 *
 * On a hit, the returned decision's provenance is stamped with
 * `cacheHit: true` so downstream audit + the caller can mark the reply as
 * a cache replay.
 */
export async function readOrchestratorSemanticCache(
  args: ReadOrchestratorCacheArgs,
): Promise<OrchestratorCacheReadResult> {
  if (!args.enabled || args.cache === undefined) return EMPTY_READ;
  const read = await semanticCacheRead({
    cache: args.cache,
    enabled: args.enabled,
    scope: args.scope,
    userMessage: args.req.userMessage,
    answeringModelId: args.answeringModelId,
  });
  if (read.hit !== null) {
    return Object.freeze({
      hit: markCacheHit(read.hit),
      similarity: read.similarity,
      missEmbedding: null,
    });
  }
  return Object.freeze({
    hit: null,
    similarity: null,
    missEmbedding: read.missEmbedding,
  });
}

export interface WriteOrchestratorCacheArgs {
  readonly cache: SemanticCachePort | undefined;
  readonly enabled: boolean;
  readonly req: ThoughtRequest;
  readonly scope: SemanticScope;
  readonly decision: BrainDecision;
  /** Embedding from the read miss; required (no second embed). */
  readonly missEmbedding: ReadonlyArray<number> | null;
  readonly cacheId: string;
}

/**
 * Write-through a fresh decision on the orchestrator path. Best-effort —
 * NEVER throws. Only EVIDENCE-BACKED `answer` decisions are persisted:
 *   - refusals / softened replies are request-frame-specific (handled by
 *     the port's own `kind === 'answer'` guard);
 *   - an `answer` with an EMPTY citation chain is treated as non-cacheable
 *     here (CLAUDE.md evidence-required — we never replay an ungrounded
 *     answer to a near-miss embedding).
 */
export async function writeOrchestratorSemanticCache(
  args: WriteOrchestratorCacheArgs,
): Promise<void> {
  if (!args.enabled || args.cache === undefined) return;
  if (args.missEmbedding === null || args.missEmbedding.length === 0) return;
  if (!isEvidenceBackedAnswer(args.decision)) return;
  await semanticCacheWrite({
    cache: args.cache,
    enabled: args.enabled,
    scope: args.scope,
    userMessage: args.req.userMessage,
    decision: args.decision,
    missEmbedding: args.missEmbedding,
    cacheId: args.cacheId,
  });
}

/**
 * Only `answer` decisions carrying ≥1 citation are cacheable. Mirrors the
 * Auditor's evidence-required rule at the cache boundary so a replayed hit
 * is always grounded.
 */
export function isEvidenceBackedAnswer(decision: BrainDecision): boolean {
  if (decision.kind !== 'answer') return false;
  const citations = (decision as { citations?: ReadonlyArray<unknown> })
    .citations;
  return Array.isArray(citations) && citations.length > 0;
}

/**
 * Return a copy of the decision with `provenance.cacheHit = true`. Pure —
 * never mutates the cached entry (immutability rule). Falls back to the
 * original object when provenance is missing (defensive; never throws).
 *
 * Every `BrainDecision` variant carries a `provenance: ProvenanceRecord`,
 * which has a `cacheHit: boolean` field; we spread it immutably so the
 * replayed reply is flagged as a cache hit for audit + the caller.
 */
export function markCacheHit(decision: BrainDecision): BrainDecision {
  const prov = decision.provenance;
  if (!prov) return decision;
  return {
    ...decision,
    provenance: { ...prov, cacheHit: true },
  };
}
