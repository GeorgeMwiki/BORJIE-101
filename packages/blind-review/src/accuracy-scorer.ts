/**
 * Accuracy scorer for the blind-review pipeline.
 *
 * Pure function. Input: dataset + reviewer verdicts. Output: per-reviewer
 * accuracy, aggregate accuracy, confusion matrix, and the
 * indistinguishability verdict (accuracy <= 0.55).
 */

import {
  INDISTINGUISHABILITY_BAR,
  type BlindReviewDataset,
  type ConfusionMatrix,
  type DecisionAuthor,
  type ReviewerVerdict,
} from './types.js';

export interface ScoreInput {
  readonly dataset: BlindReviewDataset;
  readonly verdicts: ReadonlyArray<ReviewerVerdict>;
  /** Indistinguishability bar. Default 0.55. */
  readonly indistinguishabilityBar?: number;
}

export interface AccuracyScore {
  readonly totalReviews: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly indistinguishable: boolean;
  readonly perReviewer: ReadonlyArray<{
    readonly reviewerId: string;
    readonly nReviews: number;
    readonly correct: number;
    readonly accuracy: number;
  }>;
  readonly confusionMatrix: ConfusionMatrix;
}

export function scoreVerdicts(input: ScoreInput): AccuracyScore {
  const bar = input.indistinguishabilityBar ?? INDISTINGUISHABILITY_BAR;
  const truth = new Map<string, DecisionAuthor>();
  for (const r of input.dataset.aiRecords) truth.set(r.id, r.author);
  for (const r of input.dataset.humanRecords) truth.set(r.id, r.author);

  let correct = 0;
  let aiCorrectlyIdentified = 0;
  let humanCorrectlyIdentified = 0;
  let aiMisidentifiedAsHuman = 0;
  let humanMisidentifiedAsAi = 0;
  const perReviewerStats = new Map<string, { n: number; correct: number }>();

  for (const v of input.verdicts) {
    const actual = truth.get(v.recordId);
    if (!actual) continue;
    const stats = perReviewerStats.get(v.reviewerId) ?? { n: 0, correct: 0 };
    const isCorrect = v.guess === actual;
    perReviewerStats.set(v.reviewerId, {
      n: stats.n + 1,
      correct: stats.correct + (isCorrect ? 1 : 0),
    });
    if (isCorrect) correct += 1;
    if (actual === 'ai' && v.guess === 'ai') aiCorrectlyIdentified += 1;
    if (actual === 'human' && v.guess === 'human') humanCorrectlyIdentified += 1;
    if (actual === 'ai' && v.guess === 'human') aiMisidentifiedAsHuman += 1;
    if (actual === 'human' && v.guess === 'ai') humanMisidentifiedAsAi += 1;
  }

  const totalReviews = input.verdicts.length;
  const accuracy = totalReviews === 0 ? 0 : correct / totalReviews;
  const perReviewer = Array.from(perReviewerStats.entries()).map(
    ([reviewerId, s]) => ({
      reviewerId,
      nReviews: s.n,
      correct: s.correct,
      accuracy: s.n === 0 ? 0 : s.correct / s.n,
    }),
  );

  return {
    totalReviews,
    correct,
    accuracy: Number(accuracy.toFixed(4)),
    indistinguishable: accuracy <= bar,
    perReviewer,
    confusionMatrix: {
      aiCorrectlyIdentified,
      humanCorrectlyIdentified,
      aiMisidentifiedAsHuman,
      humanMisidentifiedAsAi,
    },
  };
}

/**
 * Flag reviewers whose accuracy is unusually low / high. The M5 verdict
 * only depends on aggregate accuracy; this powers a QA dashboard.
 */
export function reliabilityFlags(
  perReviewer: AccuracyScore['perReviewer'],
  warnAbove = 0.7,
  warnBelow = 0.3,
): ReadonlyArray<{
  readonly reviewerId: string;
  readonly flag: 'above' | 'below';
  readonly accuracy: number;
}> {
  const flags: Array<{
    reviewerId: string;
    flag: 'above' | 'below';
    accuracy: number;
  }> = [];
  for (const r of perReviewer) {
    if (r.accuracy >= warnAbove) {
      flags.push({ reviewerId: r.reviewerId, flag: 'above', accuracy: r.accuracy });
    } else if (r.accuracy <= warnBelow) {
      flags.push({ reviewerId: r.reviewerId, flag: 'below', accuracy: r.accuracy });
    }
  }
  return flags;
}

/** Pull the author label out of a dataset by record id. */
export function authorOf(
  dataset: BlindReviewDataset,
  recordId: string,
): DecisionAuthor | null {
  return (
    dataset.aiRecords.find((r) => r.id === recordId)?.author ??
    dataset.humanRecords.find((r) => r.id === recordId)?.author ??
    null
  );
}
