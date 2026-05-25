/**
 * MMR (Maximal Marginal Relevance) rerank.
 *
 * Per Carbonell & Goldstein (SIGIR 1998), MMR picks the next candidate
 * `c*` from the unranked set `C \ S` that maximizes:
 *
 *     λ · sim(c, query) − (1 − λ) · max_{s ∈ S} sim(c, s)
 *
 * - λ = 1.0 reduces to pure relevance ranking.
 * - λ = 0.0 reduces to pure diversity (maximize pairwise distance).
 * - λ ≈ 0.7 is the customary balance used downstream of RRF fusion.
 *
 * The implementation is greedy O(K · N) — for our top-30 candidate
 * pools and K=8 selections that's ≤ 240 cosine evaluations, well within
 * a single CPU tick. Pure functions only — no I/O, no module-level
 * state. Cosine similarity is inlined (no dependency on
 * `episodic-amem.cosineSimilarity`) so this file can be lifted out for
 * benchmarking without dragging in the A-Mem barrel.
 */

/** A candidate eligible for MMR rerank. Shape matches FusedEntry-ish records. */
export interface MmrCandidate {
  readonly id: string;
  readonly embedding: ReadonlyArray<number>;
  readonly score: number;
  readonly content: string;
}

/** Recommended balance of relevance (λ) vs diversity (1-λ). */
export const DEFAULT_MMR_LAMBDA = 0.7;

/** Default number of items returned by `mmrRerank`. */
export const DEFAULT_MMR_TOP_K = 8;

/**
 * Greedy MMR rerank. Returns at most `topK` items in selection order
 * (most relevant + diverse first). Input candidates are NOT mutated.
 *
 * Edge cases:
 *   - empty candidates → empty result
 *   - topK ≤ 0          → empty result
 *   - topK > N          → returns all N in MMR-greedy order
 *   - λ outside [0,1]   → clamped to [0,1]
 *
 * If a candidate has no usable embedding (length 0 or mismatched against
 * the query), its similarity contribution is treated as 0 — it can
 * still surface via diversity if other candidates are crowding the
 * top of the list.
 */
export function mmrRerank(
  query: ReadonlyArray<number>,
  candidates: ReadonlyArray<MmrCandidate>,
  lambda: number = DEFAULT_MMR_LAMBDA,
  topK: number = DEFAULT_MMR_TOP_K,
): ReadonlyArray<MmrCandidate> {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!Number.isFinite(topK) || topK <= 0) return [];

  const k = Math.min(Math.floor(topK), candidates.length);
  const lam = clamp01(Number.isFinite(lambda) ? lambda : DEFAULT_MMR_LAMBDA);
  const queryEmbedding =
    Array.isArray(query) && query.length > 0 ? query : null;

  // Precompute relevance once — N cosine calls.
  const relevance: number[] = candidates.map((c) =>
    queryEmbedding === null ? 0 : cosine(queryEmbedding, c.embedding),
  );

  const remaining: number[] = candidates.map((_, i) => i);
  const selected: MmrCandidate[] = [];
  const selectedIdx: number[] = [];

  while (selected.length < k && remaining.length > 0) {
    let bestPos = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candIdx = remaining[i] as number;
      const cand = candidates[candIdx] as MmrCandidate;
      const rel = relevance[candIdx] ?? 0;

      // Diversity penalty = max similarity vs anything already chosen.
      let maxSim = 0;
      for (let j = 0; j < selectedIdx.length; j += 1) {
        const sIdx = selectedIdx[j] as number;
        const sCand = candidates[sIdx] as MmrCandidate;
        const sim = cosine(cand.embedding, sCand.embedding);
        if (sim > maxSim) maxSim = sim;
      }

      const mmr = lam * rel - (1 - lam) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestPos = i;
      }
    }

    const chosenIdx = remaining[bestPos] as number;
    selected.push(candidates[chosenIdx] as MmrCandidate);
    selectedIdx.push(chosenIdx);
    // Remove without mutating the input array — splice on the working copy.
    remaining.splice(bestPos, 1);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────
// Internals — inlined cosine so this file has zero sibling imports.
// ─────────────────────────────────────────────────────────────────────

function cosine(
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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
