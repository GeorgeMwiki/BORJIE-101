/**
 * Mean Opinion Score (MOS) interface for the Swahili gauntlet TTS leg.
 *
 * MOS is inherently a human judgement (1 — bad → 5 — excellent). This module
 * does NOT auto-score; it ships the shape, the storage contract, and a
 * `rateMOS()` stub that a human rater (or an offline panel) calls.
 *
 * Why it's here: keeping the type alongside the WER metric means the runner
 * and the result repository share one mental model — "every utterance has a
 * WER and (optionally) a MOS attached".
 */

export type MosScore = 1 | 2 | 3 | 4 | 5;

export interface MosRating {
  readonly utteranceId: string;
  /** Rater id — anonymised user / panel id. */
  readonly raterId: string;
  readonly score: MosScore;
  /** ITU-T P.800 dimension being rated. */
  readonly dimension: 'overall' | 'naturalness' | 'intelligibility' | 'pleasantness';
  readonly notes?: string;
  readonly ratedAt: string; // ISO timestamp
}

export interface AggregateMos {
  readonly utteranceId: string;
  readonly mean: number;
  readonly stdDev: number;
  readonly raterCount: number;
}

/**
 * Aggregate raw ratings into a per-utterance mean + std dev. Pure function,
 * no I/O; the result-repository persists what this returns.
 *
 * Returns `null` when there are zero ratings for the utterance (the caller
 * decides whether to treat that as a defect or as "not yet rated").
 */
export function aggregateMos(
  utteranceId: string,
  ratings: ReadonlyArray<MosRating>,
): AggregateMos | null {
  const filtered = ratings.filter((r) => r.utteranceId === utteranceId);
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((acc, r) => acc + r.score, 0);
  const mean = sum / filtered.length;
  const variance =
    filtered.reduce((acc, r) => acc + (r.score - mean) ** 2, 0) / filtered.length;
  const stdDev = Math.sqrt(variance);
  return {
    utteranceId,
    mean,
    stdDev,
    raterCount: filtered.length,
  };
}

/**
 * Stub invocation surface for the human-rating panel. Production wiring
 * pushes ratings into the gauntlet result table; the stub returns an empty
 * array so the gauntlet runner can complete a smoke run without humans in
 * the loop.
 */
export interface MosRater {
  rate(utteranceId: string, dimension: MosRating['dimension']): Promise<MosRating | null>;
}

/** Returns null — used in CI / tests so the gauntlet completes hermetically. */
export const noopMosRater: MosRater = {
  async rate(): Promise<MosRating | null> {
    return null;
  },
};

/** Threshold guard used by the runner; spec §3 sets 4.0 mean across the set. */
export const MOS_AGGREGATE_TARGET = 4.0;
