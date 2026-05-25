/**
 * A-Mem (Agent-Memory) style episodic note writer + recall.
 *
 * Backs migration 0181's `episodic_notes` table. Two operations:
 *
 *   - writeNote() — extract facts, embed them, score importance, link
 *                   to highly-similar parents, persist via the repo.
 *   - recall()    — top-k retrieval by cosine similarity of the query
 *                   embedding against persisted notes. Bumps each
 *                   recalled row's `access_count` so the FadeMem LFU
 *                   side of the eviction effective-score reflects use.
 *
 * Importance formula (per the architect's ADR):
 *
 *   clamp(0.4 + 0.1 * linkCount + (containsMoney ? 0.2 : 0), 0, 1)
 *
 * Parent linking threshold (cosine):
 *
 *   parents = { p : cosineSim(noteEmbed, p.embed) >= 0.8 }
 *
 * Pure logic + an injected `EpisodicRepo` port — no I/O here. The
 * Drizzle-backed repo lives in `@borjie/database` and is wired by
 * the api-gateway composition root; tests bind in-memory fakes.
 */

import type { EpisodicNote, EpisodicRepo } from './types-amem.js';

/** Threshold above which a candidate is treated as a parent link. */
export const PARENT_LINK_COSINE_THRESHOLD = 0.8;

/**
 * Crypto-grade fallback ID for an episodic note. Bug fix A-BUG-DEEP #11.
 */
function safeRandomNoteId(): string {
  const cryptoApi =
    (typeof globalThis !== 'undefined' &&
      (globalThis as { crypto?: { randomUUID?: () => string } }).crypto) ||
    undefined;
  if (cryptoApi?.randomUUID) {
    return `note_${cryptoApi.randomUUID()}`;
  }
  // Last-resort fallback when crypto.randomUUID is absent (very old
  // runtimes only). Marked with eslint disable because the rule fires
  // on every Math.random() call site.
  // eslint-disable-next-line no-restricted-syntax
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Money / currency / amount detectors. Conservative — over-matches by
 * design so monetary facts get a higher importance score and survive
 * the FadeMem decay longer.
 */
const MONEY_REGEXES: ReadonlyArray<RegExp> = [
  /\b(?:TZS|KES|UGX|RWF|NGN|ZAR|GHS|EGP|USD|EUR|GBP|CHF|JPY|CNY|INR|AUD|CAD|Ksh|KShs|Tsh|TShs|Sh|Shs)\s*[\d,]+(?:\.\d+)?/i,
  /\$\s*\d[\d,]*(?:\.\d+)?/,
  /\b(?:rent|deposit|fee|fine|penalty|surcharge|payment|invoice|amount)\s+of\s+[\d,]+/i,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:shillings?|cents?|dollars?|euros?|pounds?)\b/i,
];

/**
 * Test whether any of the supplied facts looks monetary. Used to
 * compute the importance bonus.
 */
export function containsMoney(facts: ReadonlyArray<string>): boolean {
  if (!facts || facts.length === 0) return false;
  for (const fact of facts) {
    if (typeof fact !== 'string' || fact.length === 0) continue;
    for (const rx of MONEY_REGEXES) {
      if (rx.test(fact)) return true;
    }
  }
  return false;
}

/**
 * Importance score per the FadeMem ADR. Always in [0, 1].
 */
export function computeImportance(
  linkCount: number,
  monetary: boolean,
): number {
  const safeLinks = Number.isFinite(linkCount) && linkCount > 0 ? linkCount : 0;
  const base = 0.4 + 0.1 * safeLinks + (monetary ? 0.2 : 0);
  return clamp01(base);
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for vectors of different
 * length or all-zero vectors. Tolerates undefined / null inputs.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number> | null | undefined,
  b: ReadonlyArray<number> | null | undefined,
): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Write an A-Mem note for one event. Steps:
 *
 *   1. Embed the joined facts.
 *   2. Search the repo for nearby notes (cosine candidates).
 *   3. Link parents at cosine >= 0.8.
 *   4. Score importance by linkCount + money signal.
 *   5. Persist.
 */
export async function writeNote(
  tenantId: string,
  sessionId: string,
  turnIdx: number,
  event: Record<string, unknown>,
  facts: ReadonlyArray<string>,
  embedder: (text: string) => Promise<ReadonlyArray<number>>,
  repo: EpisodicRepo,
): Promise<EpisodicNote> {
  if (typeof embedder !== 'function') {
    throw new Error('episodic-amem.writeNote: embedder is required');
  }
  if (!repo || typeof repo.findCandidates !== 'function' || typeof repo.insert !== 'function') {
    throw new Error('episodic-amem.writeNote: repo is required');
  }
  const normalisedFacts = (facts ?? []).filter(
    (f): f is string => typeof f === 'string' && f.length > 0,
  );
  const factsText = normalisedFacts.join(' ').trim();
  const embedding =
    factsText.length === 0
      ? []
      : Array.from(await embedder(factsText));

  // Pull candidate parent notes from the repo. Adapters may pre-filter
  // by tenant+session; here we score with cosine and threshold at 0.8.
  const candidates = await repo.findCandidates({
    tenantId,
    sessionId,
    limit: 50,
  });
  const parents: string[] = [];
  for (const cand of candidates) {
    const sim = cosineSimilarity(embedding, cand.embedding ?? null);
    if (sim >= PARENT_LINK_COSINE_THRESHOLD) {
      parents.push(cand.id);
    }
  }

  const importance = computeImportance(
    parents.length,
    containsMoney(normalisedFacts),
  );

  // Bug fix A-BUG-DEEP #11: Math.random() is predictable; use the
  // crypto-grade UUID when available so episodic note IDs are not
  // correlatable across sessions.
  const id = repo.generateId
    ? repo.generateId()
    : safeRandomNoteId();
  const now = repo.now ? repo.now() : new Date();

  const note: EpisodicNote = {
    id,
    tenantId,
    sessionId,
    turnIdx,
    event,
    facts: normalisedFacts,
    embedding,
    importanceScore: importance,
    parents,
    accessCount: 0,
    createdAt: now,
    lastAccessedAt: now,
    softDeletedAt: null,
  };

  await repo.insert(note);
  return note;
}

/**
 * Recall the top-k notes most similar to `query`. The query is
 * embedded once and scored against every candidate returned by the
 * repo. Each returned note has its `access_count` bumped via
 * `repo.bumpAccess()` so the eviction LFU multiplier reflects use.
 *
 * `k` is clamped to [1, 50] to avoid pathological pages.
 */
export async function recall(
  tenantId: string,
  query: string,
  k: number,
  embedder: (text: string) => Promise<ReadonlyArray<number>>,
  repo: EpisodicRepo,
): Promise<ReadonlyArray<EpisodicNote>> {
  if (typeof embedder !== 'function') {
    throw new Error('episodic-amem.recall: embedder is required');
  }
  if (!repo || typeof repo.searchByEmbedding !== 'function') {
    throw new Error('episodic-amem.recall: repo.searchByEmbedding is required');
  }
  const trimmedQuery = (query ?? '').trim();
  if (trimmedQuery.length === 0) return [];

  const limit = clamp(Math.floor(k ?? 8), 1, 50);
  const queryEmbedding = Array.from(await embedder(trimmedQuery));

  const rows = await repo.searchByEmbedding({
    tenantId,
    embedding: queryEmbedding,
    limit,
  });

  // Score by cosine, sort desc, take top-k. If the repo already
  // pre-sorts (e.g. via pgvector `<=>`), this is a stable no-op pass.
  const scored = rows.map((row) => ({
    row,
    score: cosineSimilarity(queryEmbedding, row.embedding ?? null),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => s.row);

  // Bump access counters so FadeMem LFU reflects actual recall use.
  if (typeof repo.bumpAccess === 'function' && top.length > 0) {
    const ids = top.map((row) => row.id);
    try {
      await repo.bumpAccess({ tenantId, ids });
    } catch {
      // Bumping is best-effort — never block the read path on a write
      // failure. The eviction sweep will still apply the time decay.
    }
  }

  return top;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
