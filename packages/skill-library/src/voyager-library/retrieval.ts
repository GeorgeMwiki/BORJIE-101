/**
 * Embedding-based retrieval over the skill library.
 *
 * Algorithm:
 *   1. Cosine-similarity rank ALL non-quarantined skills against the
 *      situation embedding, restricted to matching jurisdiction (or
 *      platform-neutral skills).
 *   2. Apply success-bias boost: a skill with `success_count >> failure`
 *      gets a small score bump so accumulated procedural memory becomes
 *      first-pick.
 *   3. Return top-K above RETRIEVAL_THRESHOLD plus the absolute top-3
 *      for composition fallback.
 */

import type { CodeSkill, RetrievedSkill, SkillSituation } from './types.js';
import { RETRIEVAL_THRESHOLD, COMPOSITION_THRESHOLD } from './types.js';

/**
 * Cosine similarity in [-1, 1]. Mapped to [0, 1] by `(1 + cos) / 2`.
 */
export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  const raw = dot / denom; // in [-1, 1]
  return (raw + 1) / 2; // mapped to [0, 1]
}

/**
 * Success-bias factor. Skills with a strong track record get a small
 * boost; quarantined skills are filtered upstream (never reach here).
 *
 * boost = min(1.0, success / (success + failure + 1)) * 0.1
 *
 * The +1 in the denominator is Laplace smoothing — brand-new skills
 * get a small bias toward optimism without dominating.
 */
export function successBoost(
  successCount: number,
  failureCount: number
): number {
  const ratio = successCount / (successCount + failureCount + 1);
  return Math.min(1.0, ratio) * 0.1;
}

export interface RetrievalResult {
  /** Skills above RETRIEVAL_THRESHOLD — "retrieve and execute" candidates. */
  readonly retrieve: ReadonlyArray<RetrievedSkill>;
  /**
   * Top-3 absolute candidates. If `retrieve.length === 0`, the orchestrator
   * uses these for composition fallback: "extend skill X to handle
   * situation Y."
   */
  readonly top_3: ReadonlyArray<RetrievedSkill>;
  /** Number of non-quarantined skills scanned. */
  readonly scanned: number;
}

export function retrieveSkills(
  library: ReadonlyArray<CodeSkill>,
  situation: SkillSituation
): RetrievalResult {
  const eligible = library.filter(
    (s) =>
      !s.quarantined &&
      (s.jurisdiction === 'platform' || s.jurisdiction === situation.jurisdiction)
  );

  const scored: Array<RetrievedSkill> = eligible.map((skill) => {
    const sim = cosineSimilarity(skill.embedding, situation.embedding);
    // We deliberately do NOT cap the sum at 1.0 — successBoost is itself
    // capped at 0.1, so the maximum total is 1.1. Allowing the boost to
    // exceed 1.0 ensures that a perfect-similarity skill with a strong
    // track record outranks an identical-embedding cold skill on tie-break.
    const score = sim + successBoost(skill.success_count, skill.failure_count);
    return { skill, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const retrieve = scored.filter((r) => r.score >= RETRIEVAL_THRESHOLD);
  const top_3 = scored.slice(0, 3);

  return {
    retrieve,
    top_3,
    scanned: eligible.length,
  };
}

export { RETRIEVAL_THRESHOLD, COMPOSITION_THRESHOLD };
