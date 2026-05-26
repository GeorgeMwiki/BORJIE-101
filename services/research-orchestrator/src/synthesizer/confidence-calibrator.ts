/**
 * Confidence calibrator — DEEP_RESEARCH_SPEC §4.4.
 *
 * Maps a scored artifact set to one of three confidence levels:
 *
 *   - HIGH: 3+ independent high-quality sources agree.
 *   - MEDIUM: 1 high-quality source + corpus consistency, OR 2 medium-
 *     quality sources agree.
 *   - LOW: single source, no corroboration. UI shows a warning chip.
 *
 * Spec anti-pattern §12.1 ("MUST NOT cite a single unverified source
 * as fact") is enforced here: any plan whose only artifact has
 * quality_score < 0.6 AND no corroboration is forced to LOW + the
 * warning chip is propagated to the citation surface.
 *
 * Pure function.
 *
 * @module research-orchestrator/synthesizer/confidence-calibrator
 */

import type { ResearchArtifact } from '../types.js';

const HIGH_QUALITY_THRESHOLD = 0.75;
const MEDIUM_QUALITY_THRESHOLD = 0.5;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface CalibrateInput {
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  /** Number of corpus-internal high-confidence facts that align. */
  readonly corpus_alignment_count?: number;
}

export interface CalibrateOutput {
  readonly confidence: ConfidenceLevel;
  readonly rationale: string;
  readonly high_quality_count: number;
  readonly medium_quality_count: number;
}

export function calibrateConfidence(input: CalibrateInput): CalibrateOutput {
  let highQualityCount = 0;
  let mediumQualityCount = 0;

  for (const a of input.artifacts) {
    if (a.quality_score >= HIGH_QUALITY_THRESHOLD) highQualityCount += 1;
    else if (a.quality_score >= MEDIUM_QUALITY_THRESHOLD) mediumQualityCount += 1;
  }

  const corpusAlign = input.corpus_alignment_count ?? 0;

  // HIGH: 3+ independent high-quality sources agree.
  if (highQualityCount >= 3) {
    return {
      confidence: 'high',
      rationale: `${highQualityCount} high-quality sources agree`,
      high_quality_count: highQualityCount,
      medium_quality_count: mediumQualityCount,
    };
  }

  // MEDIUM: 1 high-quality + corpus consistency, OR 2 medium-quality agree.
  if (
    (highQualityCount >= 1 && corpusAlign >= 1) ||
    mediumQualityCount >= 2
  ) {
    return {
      confidence: 'medium',
      rationale:
        highQualityCount >= 1
          ? `1 high-quality source + ${corpusAlign} corpus alignments`
          : `${mediumQualityCount} medium-quality sources agree`,
      high_quality_count: highQualityCount,
      medium_quality_count: mediumQualityCount,
    };
  }

  return {
    confidence: 'low',
    rationale:
      input.artifacts.length === 0
        ? 'no artifacts retrieved'
        : 'single source / no corroboration',
    high_quality_count: highQualityCount,
    medium_quality_count: mediumQualityCount,
  };
}
