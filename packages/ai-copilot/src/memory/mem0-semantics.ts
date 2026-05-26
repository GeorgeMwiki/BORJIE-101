/**
 * Mem0 ADD / UPDATE / DELETE / NOOP semantics — BORJIE port.
 *
 * When a new candidate fact arrives, this module decides what to do
 * with respect to existing facts for the same (tenant/persona,
 * factType) bucket:
 *
 *   ADD    — claim is new; persist as a fresh fact.
 *   UPDATE — claim refines / contradicts an existing fact; supersede
 *            the existing row (caller's bi-temporal writer chains the
 *            valid_to + supersedesId).
 *   DELETE — claim explicitly revokes an old fact ("no longer ...",
 *            "stopped ..."); the targetId's valid_to flips to now.
 *   NOOP   — claim is already known with equal-or-higher confidence;
 *            we skip the write.
 *
 * PURE function — no side effects. Callers do the actual persistence
 * via the consolidation worker / semantic-memory writer. This means
 * the decision can be inspected, logged, and replayed in audit
 * without risk of double-writing.
 *
 * Reference:
 *   Mem0 (Park et al. 2024, arXiv 2404.13501) "ADD/UPDATE/DELETE/NOOP"
 *   memory operation classifier.
 *
 * Ported from:
 *   LITFIN `src/core/litfin-ai/memory/v2/mem0-semantics.ts` (382 LOC,
 *   pure). The LITFIN module imported `cosineSimilarity` + `FactType`
 *   from a sibling `types.ts`; the BORJIE port inlines both so
 *   this file has zero internal deps and is drop-in usable from any
 *   workspace package.
 *
 * @module @borjie/ai-copilot/memory/mem0-semantics
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Fact taxonomy used by the Mem0 decision engine. Matches the LITFIN
 * memory v2 taxonomy so the port stays faithful to the upstream
 * paper. Callers can map any domain-specific category onto one of
 * these labels.
 */
export type FactType =
  | 'profile'
  | 'preference'
  | 'business'
  | 'goal'
  | 'constraint'
  | 'struggle'
  | 'milestone'
  | 'commitment'
  | 'risk'
  | 'relationship'
  | 'event'
  | 'decision';

export type Mem0Decision =
  | { readonly kind: 'add'; readonly reason: string }
  | {
      readonly kind: 'update';
      readonly supersedesId: string;
      readonly similarity: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'delete';
      readonly targetId: string;
      readonly similarity: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'noop';
      readonly matchedId: string;
      readonly similarity: number;
      readonly reason: string;
    };

export interface Mem0Candidate {
  readonly factText: string;
  readonly factType: FactType;
  /** Optional pre-computed embedding for the candidate. */
  readonly embedding?: ReadonlyArray<number>;
  /** 0..1 confidence. Defaults to 1 (claim believed fully). */
  readonly confidence?: number;
  /**
   * Hint that the candidate text is a NEGATION of a prior fact
   * (e.g. "Asha no longer rents 4B"). Callers may pass this flag when
   * their upstream extractor has already detected the negation; the
   * decideMem0Op function also runs a simple keyword check as a
   * fallback.
   */
  readonly explicitNegation?: boolean;
}

export interface Mem0ExistingFact {
  readonly id: string;
  readonly factText: string;
  readonly factType: FactType;
  /** Optional pre-computed embedding for the existing fact. */
  readonly embedding?: ReadonlyArray<number>;
  /** 0..1 confidence of the stored fact. */
  readonly confidence: number;
}

export interface DecideMem0Options {
  /** Similarity at which we consider two facts the "same topic". */
  readonly contradictionThreshold?: number;
  /** Stricter similarity at which we treat the candidate as a NOOP. */
  readonly noopThreshold?: number;
  /** Looser similarity for negation-driven DELETE matches. */
  readonly deleteThreshold?: number;
}

/**
 * Injected embedding function. Pure semantics module never calls a
 * network — the caller is responsible for resolving embeddings (or
 * leaving them undefined to fall back to Jaccard).
 */
export type Mem0Embedder = (text: string) => Promise<ReadonlyArray<number>>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONTRADICTION_THRESHOLD = 0.85;
export const DEFAULT_NOOP_THRESHOLD = 0.92;
export const DEFAULT_DELETE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Keyword fallback for negation detection. Conservative — the
// upstream LLM-based extractor is more reliable; this only catches
// obvious cases when `explicitNegation` isn't passed.
const NEGATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bno longer\b/i,
  /\bnot anymore\b/i,
  /\bstopped\b/i,
  /\bquit\b/i,
  /\bcancel(?:led|s)?\b/i,
  /\bwithdrawn\b/i,
  /\bno more\b/i,
  /\brevoke[ds]?\b/i,
];

function looksLikeNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((re) => re.test(text));
}

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cosine similarity between two equal-length vectors. Inlined here
 * (rather than imported from semantic-memory) so this module stays
 * zero-dep and can be lifted into any workspace without pulling the
 * semantic-memory surface.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Token-Jaccard similarity. Used as a fallback when neither side
 * carries an embedding. Coarse but fast — production callers should
 * pass embeddings whenever possible.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(normaliseText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normaliseText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersect = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersect += 1;
  const union = aTokens.size + bTokens.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function pairSimilarity(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): number {
  if (
    candidate.embedding &&
    existing.embedding &&
    candidate.embedding.length > 0 &&
    candidate.embedding.length === existing.embedding.length
  ) {
    return cosineSimilarity(candidate.embedding, existing.embedding);
  }
  return jaccardSimilarity(candidate.factText, existing.factText);
}

/**
 * Strip negation tokens / phrases from the candidate text so the
 * underlying semantic match against existing facts isn't penalised
 * by the negation marker itself. Without this, "Asha is no longer
 * the manager" vs "Asha is the manager" scores only ~0.66 Jaccard
 * because the negation phrase eats two tokens — well below the
 * delete threshold.
 */
function stripNegation(text: string): string {
  let out = text;
  out = out.replace(/\bno longer\b/gi, ' ');
  out = out.replace(/\bnot anymore\b/gi, ' ');
  out = out.replace(/\bno more\b/gi, ' ');
  out = out.replace(/\bstopped\b/gi, ' ');
  out = out.replace(/\bquit\b/gi, ' ');
  out = out.replace(/\bcancel(?:led|s)?\b/gi, ' ');
  out = out.replace(/\bwithdrawn\b/gi, ' ');
  out = out.replace(/\brevoke[ds]?\b/gi, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Similarity for negation-matching: strip the candidate's negation
 * tokens before comparing so the remaining surface form lines up
 * with the existing positive-form fact. Always uses Jaccard — even
 * when embeddings are present, the negation surface form makes the
 * embedding similarity unreliable ("X stopped" and "X" embed
 * differently).
 */
function negationStripSimilarity(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): number {
  const strippedText = stripNegation(candidate.factText);
  return jaccardSimilarity(strippedText, existing.factText);
}

interface BestMatch {
  readonly fact: Mem0ExistingFact;
  readonly similarity: number;
}

function findBestMatch(
  candidate: Mem0Candidate,
  existing: ReadonlyArray<Mem0ExistingFact>,
): BestMatch | null {
  let best: BestMatch | null = null;
  for (const fact of existing) {
    if (fact.factType !== candidate.factType) continue;
    const sim = pairSimilarity(candidate, fact);
    if (!best || sim > best.similarity) {
      best = { fact, similarity: sim };
    }
  }
  return best;
}

/**
 * Does the candidate text carry the SAME atomic claim as the
 * existing fact? Heuristic: the candidate's normalised token set is
 * a near-subset of the existing's tokens AND vice-versa, AND no
 * negation appears in either.
 *
 * This is intentionally conservative — we'd rather UPDATE (which
 * triggers bi-temporal supersession audit) than NOOP a contradiction.
 */
function carriesSameClaim(
  candidate: Mem0Candidate,
  existing: Mem0ExistingFact,
): boolean {
  if (
    looksLikeNegation(candidate.factText) ||
    looksLikeNegation(existing.factText)
  ) {
    return false;
  }
  const candidateTokens = new Set(
    normaliseText(candidate.factText).split(' ').filter(Boolean),
  );
  const existingTokens = new Set(
    normaliseText(existing.factText).split(' ').filter(Boolean),
  );
  if (candidateTokens.size === 0 || existingTokens.size === 0) return false;
  let intersect = 0;
  for (const t of candidateTokens) if (existingTokens.has(t)) intersect += 1;
  // Same-claim threshold: 90% of the candidate's tokens appear in
  // the existing fact AND vice-versa.
  const candidateCovered = intersect / candidateTokens.size;
  const existingCovered = intersect / existingTokens.size;
  return candidateCovered >= 0.9 && existingCovered >= 0.9;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide whether a candidate fact should ADD / UPDATE / DELETE /
 * NOOP relative to the existing fact list. Pure — no side effects.
 *
 * Caller responsibility:
 *   - Provide the existing facts already filtered to the same
 *     (tenant, factType) scope. This function does NOT do recall.
 *   - Persist the resulting decision via the bi-temporal writer.
 */
export function decideMem0Op(
  candidate: Mem0Candidate,
  existing: ReadonlyArray<Mem0ExistingFact>,
  opts?: DecideMem0Options,
): Mem0Decision {
  const contradictionThreshold =
    opts?.contradictionThreshold ?? DEFAULT_CONTRADICTION_THRESHOLD;
  const noopThreshold = opts?.noopThreshold ?? DEFAULT_NOOP_THRESHOLD;
  const deleteThreshold = opts?.deleteThreshold ?? DEFAULT_DELETE_THRESHOLD;

  // ---- 1. negation → DELETE ------------------------------------------
  const negation =
    candidate.explicitNegation === true ||
    looksLikeNegation(candidate.factText);
  if (negation) {
    // Score each existing fact against the candidate text with the
    // negation tokens stripped — the actual semantic anchor.
    let best: BestMatch | null = null;
    for (const fact of existing) {
      if (fact.factType !== candidate.factType) continue;
      const sim = negationStripSimilarity(candidate, fact);
      if (!best || sim > best.similarity) {
        best = { fact, similarity: sim };
      }
    }
    if (best && best.similarity >= deleteThreshold) {
      return {
        kind: 'delete',
        targetId: best.fact.id,
        similarity: best.similarity,
        reason: `negation detected; revoking fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${deleteThreshold}).`,
      };
    }
    // Negation with no matching prior fact — treat as ADD (the brain
    // now believes the negative form). Could also be NOOP if equal
    // similarity match exists, but treating as ADD is the safer
    // default in audit.
    return {
      kind: 'add',
      reason:
        'negation detected but no prior fact passes the delete threshold; recording as a new claim.',
    };
  }

  // ---- 2. find best non-negated match ---------------------------------
  const best = findBestMatch(candidate, existing);
  if (!best) {
    return {
      kind: 'add',
      reason: 'no existing fact in the same factType — recording as new.',
    };
  }

  // ---- 3. NOOP vs UPDATE branch --------------------------------------
  if (
    best.similarity >= noopThreshold &&
    carriesSameClaim(candidate, best.fact)
  ) {
    const candidateConfidence = candidate.confidence ?? 1;
    if (candidateConfidence <= best.fact.confidence) {
      return {
        kind: 'noop',
        matchedId: best.fact.id,
        similarity: best.similarity,
        reason: `candidate matches fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${noopThreshold}) and brings no higher confidence.`,
      };
    }
    // Higher confidence on same claim — update so the new
    // confidence is recorded.
    return {
      kind: 'update',
      supersedesId: best.fact.id,
      similarity: best.similarity,
      reason: `same claim as fact ${best.fact.id} but higher confidence (${candidateConfidence.toFixed(2)} > ${best.fact.confidence.toFixed(2)}) — supersede.`,
    };
  }
  if (best.similarity >= contradictionThreshold) {
    return {
      kind: 'update',
      supersedesId: best.fact.id,
      similarity: best.similarity,
      reason: `candidate contradicts / refines fact ${best.fact.id} (similarity ${best.similarity.toFixed(2)} >= ${contradictionThreshold}) — supersede.`,
    };
  }

  // ---- 4. default → ADD ----------------------------------------------
  return {
    kind: 'add',
    reason: `best match ${best.fact.id} similarity ${best.similarity.toFixed(2)} < ${contradictionThreshold} — recording as new.`,
  };
}

/**
 * Helper for the audit-trail UI: human-readable label per decision.
 */
export function describeMem0Decision(d: Mem0Decision): string {
  switch (d.kind) {
    case 'add':
      return `ADD: ${d.reason}`;
    case 'update':
      return `UPDATE supersedes=${d.supersedesId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    case 'delete':
      return `DELETE target=${d.targetId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    case 'noop':
      return `NOOP matched=${d.matchedId} (sim=${d.similarity.toFixed(2)}): ${d.reason}`;
    default: {
      // Exhaustive switch — TypeScript guarantees `d` is `never` here.
      const _exhaustive: never = d;
      return _exhaustive;
    }
  }
}

/**
 * Convenience: resolve a candidate's embedding via the injected
 * embedder when not already provided. PURE — no side effects beyond
 * the embedder's own call. Returns a new candidate; never mutates.
 *
 * Defensive: a thrown embedder is caught and the original candidate
 * returned so the caller can still fall back to Jaccard.
 */
export async function withEmbedding(
  candidate: Mem0Candidate,
  embedder: Mem0Embedder,
): Promise<Mem0Candidate> {
  if (candidate.embedding && candidate.embedding.length > 0) return candidate;
  try {
    const embedding = await embedder(candidate.factText);
    return { ...candidate, embedding };
  } catch {
    return candidate;
  }
}
