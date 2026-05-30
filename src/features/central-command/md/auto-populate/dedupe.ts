/**
 * Auto-Populate — Entity Resolution / Dedupe
 *
 * Given a freshly-extracted entity and a list of already-known entities of
 * the same kind, decide whether the new one is a duplicate of an existing
 * record, a near-match that should merge, or a brand-new row.
 *
 * Strategy:
 *   1. Canonical-name exact match → MERGE (idempotent on canonical_name).
 *   2. Levenshtein-ratio >= 0.88   → MERGE  (catches "Acme Corp" vs "Acme Corporation").
 *   3. Token-set Jaccard >= 0.8    → MERGE  (catches reorderings).
 *   4. Otherwise                   → INSERT.
 *
 * Pure functions only. No I/O. Caller fetches the candidate set from the DB
 * once per turn and we operate on the in-memory list.
 */

import {
  canonicaliseName,
  type ExtractedEntity,
  type EntityKind,
} from "./entity-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row already known to the system, fetched from the DB by the persister. */
export interface KnownEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: EntityKind;
  readonly canonicalName: string;
  readonly displayName: string;
}

export type DedupeAction = "merge" | "insert";

export interface DedupeMatch {
  readonly action: DedupeAction;
  /** When action === "merge", the existing row we should merge into. */
  readonly matchedId: string | null;
  readonly matchedName: string | null;
  /** Why we chose this action — used by the audit trail. */
  readonly reason: string;
  /** Similarity score 0..1 used in the decision. */
  readonly score: number;
}

export interface DedupeOptions {
  /** Levenshtein similarity threshold (0..1). Default 0.88. */
  readonly levenshteinThreshold?: number;
  /** Jaccard token-set threshold (0..1). Default 0.8. */
  readonly jaccardThreshold?: number;
}

const DEFAULT_LEV_THRESHOLD = 0.88;
const DEFAULT_JACCARD_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pick the best match (if any) for the extracted entity against the known
 * set. Returns a DedupeMatch describing the action and the reason. Pure.
 */
export function resolveEntity(
  extracted: ExtractedEntity,
  known: ReadonlyArray<KnownEntity>,
  options?: DedupeOptions,
): DedupeMatch {
  const levThreshold = options?.levenshteinThreshold ?? DEFAULT_LEV_THRESHOLD;
  const jacThreshold = options?.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;

  const sameKind = known.filter((k) => k.kind === extracted.kind);
  if (sameKind.length === 0) {
    return {
      action: "insert",
      matchedId: null,
      matchedName: null,
      reason: "no existing rows of this kind",
      score: 0,
    };
  }

  const targetCanonical = canonicaliseName(extracted.canonicalName);

  // Tier 1: exact canonical match.
  const exact = sameKind.find(
    (k) => canonicaliseName(k.canonicalName) === targetCanonical,
  );
  if (exact) {
    return {
      action: "merge",
      matchedId: exact.id,
      matchedName: exact.displayName,
      reason: "canonical name exact match",
      score: 1,
    };
  }

  // Tier 2 + 3: fuzzy.
  // Track best Levenshtein and Jaccard separately so each threshold is
  // applied against the dimension it actually measures. The previous
  // implementation took the max and tested it against either threshold,
  // which let a Levenshtein score above the Jaccard threshold incorrectly
  // pass the merge check (e.g. lev 0.833 >= jac 0.8).
  let bestLev = 0;
  let bestJac = 0;
  let bestLevCandidate: KnownEntity | null = null;
  let bestJacCandidate: KnownEntity | null = null;

  for (const candidate of sameKind) {
    const candidateCanonical = canonicaliseName(candidate.canonicalName);
    const lev = levenshteinRatio(targetCanonical, candidateCanonical);
    const jac = jaccardTokenRatio(targetCanonical, candidateCanonical);
    if (lev > bestLev) {
      bestLev = lev;
      bestLevCandidate = candidate;
    }
    if (jac > bestJac) {
      bestJac = jac;
      bestJacCandidate = candidate;
    }
  }

  const levWins = bestLev >= levThreshold;
  const jacWins = bestJac >= jacThreshold;
  if (levWins || jacWins) {
    const winner = levWins ? bestLevCandidate : bestJacCandidate;
    const score = levWins ? bestLev : bestJac;
    const reason = levWins ? "levenshtein" : "jaccard";
    if (winner) {
      return {
        action: "merge",
        matchedId: winner.id,
        matchedName: winner.displayName,
        reason: `${reason} similarity ${score.toFixed(3)}`,
        score,
      };
    }
  }

  const bestScore = Math.max(bestLev, bestJac);
  const bestCandidate =
    bestLev >= bestJac ? bestLevCandidate : bestJacCandidate;

  return {
    action: "insert",
    matchedId: null,
    matchedName: null,
    reason: bestCandidate
      ? `best fuzzy score ${bestScore.toFixed(3)} below thresholds`
      : "no fuzzy candidate",
    score: bestScore,
  };
}

// ---------------------------------------------------------------------------
// Levenshtein distance + ratio (pure)
// ---------------------------------------------------------------------------

/**
 * Classic Wagner-Fischer Levenshtein distance with O(min(m,n)) memory.
 * Returns the edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const m = shorter.length;
  const n = longer.length;

  // Rolling buffers.
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    const cj = longer.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const cost = shorter.charCodeAt(i - 1) === cj ? 0 : 1;
      const ins = curr[i - 1]! + 1;
      const del = prev[i]! + 1;
      const sub = prev[i - 1]! + cost;
      curr[i] = Math.min(ins, del, sub);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m]!;
}

/**
 * Levenshtein similarity in [0,1]. 1 = identical, 0 = completely different.
 */
export function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

// ---------------------------------------------------------------------------
// Token-set Jaccard (pure)
// ---------------------------------------------------------------------------

function tokens(s: string): ReadonlySet<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

/** Jaccard similarity over whitespace-split tokens. */
export function jaccardTokenRatio(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Batch dedupe — collapse a freshly-extracted batch against itself before
// touching the DB (so two mentions in the same turn merge to one row).
// ---------------------------------------------------------------------------

/**
 * Collapse same-turn duplicates inside the extracted batch. Within a single
 * turn, the LLM occasionally emits the same entity twice (once with full
 * name, once with shortened form). We dedupe these BEFORE looking at the DB.
 *
 * Returns a fresh array with duplicates removed. The higher-confidence
 * instance wins; non-empty fields from the loser are merged in.
 */
export function collapseIntraTurnDuplicates(
  batch: ReadonlyArray<ExtractedEntity>,
  options?: DedupeOptions,
): ReadonlyArray<ExtractedEntity> {
  const levThreshold = options?.levenshteinThreshold ?? DEFAULT_LEV_THRESHOLD;
  const jacThreshold = options?.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;

  const result: ExtractedEntity[] = [];

  for (const incoming of batch) {
    const incomingCanon = canonicaliseName(incoming.canonicalName);
    const dupIdx = result.findIndex((seen) => {
      if (seen.kind !== incoming.kind) return false;
      const seenCanon = canonicaliseName(seen.canonicalName);
      if (seenCanon === incomingCanon) return true;
      const lev = levenshteinRatio(seenCanon, incomingCanon);
      const jac = jaccardTokenRatio(seenCanon, incomingCanon);
      return lev >= levThreshold || jac >= jacThreshold;
    });

    if (dupIdx === -1) {
      result.push(incoming);
      continue;
    }

    const existing = result[dupIdx]!;
    // Keep the higher-confidence one; merge fields from the loser.
    const winner =
      incoming.confidence > existing.confidence ? incoming : existing;
    const loser = winner === incoming ? existing : incoming;
    const merged = mergeEntities(winner, loser);
    result.splice(dupIdx, 1, merged);
  }

  return result;
}

/**
 * Field-level merge of two same-kind entities. Winner's values take priority;
 * loser's non-undefined fields fill in winner's gaps. Pure; returns a fresh
 * object every time.
 */
export function mergeEntities(
  winner: ExtractedEntity,
  loser: ExtractedEntity,
): ExtractedEntity {
  if (winner.kind !== loser.kind) return winner;

  // Iterate over loser fields; if winner has undefined / missing, take loser's.
  const out: Record<string, unknown> = { ...loser, ...winner };
  for (const key of Object.keys(loser)) {
    const w = (winner as Record<string, unknown>)[key];
    const l = (loser as Record<string, unknown>)[key];
    if ((w === undefined || w === null || w === "") && l !== undefined) {
      out[key] = l;
    }
  }

  // confidence: keep the max
  out.confidence = Math.max(winner.confidence, loser.confidence);

  return out as ExtractedEntity;
}
