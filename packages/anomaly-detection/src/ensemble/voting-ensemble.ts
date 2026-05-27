/**
 * Voting ensemble — combine multiple detector verdicts.
 *
 * Two modes:
 *
 *   - 'majority': anomalous when ⌈k/2⌉ or more members fire.
 *   - 'weighted': normalise each member's score into [0, 1] and
 *                 take a weighted sum. Anomalous if the sum exceeds
 *                 `threshold` (default 0.5).
 *
 * Each member contributes its `AnomalyScore` plus an optional weight.
 * The combined verdict carries a per-member breakdown so consumers
 * can show Mr. Mwikila *which* detectors agreed.
 *
 * Score normalisation per `scoreKind`:
 *   - 'iforest' — already in [0, 1].
 *   - 'lof' — squash via 1 - 1/(1+lof) so 1 -> 0.5, 2 -> 0.67, etc.
 *   - 'zscore' / 'mad' — squash via |z| / (|z| + threshold) so the
 *     detector's own threshold maps to 0.5.
 *   - 'one-class-svm' — invert the sklearn convention: more-negative
 *     decision means more anomalous, so we use 1/(1+exp(decision)).
 *   - 'autoencoder' — squash error / (error + threshold).
 *   - 'ensemble' — already in [0, 1].
 *
 * @module @borjie/anomaly-detection/ensemble/voting-ensemble
 */

import type {
  AnomalyScore,
  EnsembleMember,
  EnsembleVerdict,
  VotingEnsembleConfig,
} from '../types.js';

const DEFAULT_THRESHOLD = 0.5;

function normaliseScore(score: AnomalyScore): number {
  switch (score.scoreKind) {
    case 'iforest':
    case 'ensemble':
      return Math.min(1, Math.max(0, score.score));
    case 'lof': {
      // 1 -> 0.5 mapping; LOF >= 1 means denser-than-neighbours is unusual.
      const lof = Math.max(0, score.score);
      return lof / (1 + lof);
    }
    case 'zscore':
    case 'mad': {
      const t = score.threshold === 0 ? 3 : Math.abs(score.threshold);
      const z = Math.abs(score.score);
      return z / (z + t);
    }
    case 'one-class-svm': {
      // Negative decision is more anomalous; logistic on (-decision).
      return 1 / (1 + Math.exp(score.score - score.threshold));
    }
    case 'autoencoder': {
      const t = score.threshold === 0 ? 1 : score.threshold;
      const e = Math.max(0, score.score);
      return e / (e + t);
    }
    default:
      return 0;
  }
}

export function combineVotes(
  members: ReadonlyArray<EnsembleMember>,
  config: VotingEnsembleConfig = {},
): EnsembleVerdict {
  if (members.length === 0) {
    throw new Error('combineVotes: ensemble requires at least one member');
  }
  const mode = config.mode ?? 'majority';
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;

  const contributions = members.map((m) => ({
    detectorId: m.detectorId,
    anomalous: m.score.anomalous,
    normalisedScore: normaliseScore(m.score),
    weight: m.weight ?? 1 / members.length,
  }));

  const votes = contributions.filter((c) => c.anomalous).length;
  const required = Math.ceil(members.length / 2);

  let combinedScore: number;
  let anomalous: boolean;

  if (mode === 'majority') {
    combinedScore = votes / members.length;
    anomalous = votes >= required;
  } else {
    // Weighted score combination.
    const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
    const denom = totalWeight > 0 ? totalWeight : 1;
    combinedScore =
      contributions.reduce((s, c) => s + c.normalisedScore * c.weight, 0) /
      denom;
    anomalous = combinedScore >= threshold;
  }

  return Object.freeze({
    anomalous,
    mode,
    combinedScore,
    threshold,
    votes,
    totalMembers: members.length,
    contributions: contributions.map((c) => Object.freeze(c)),
  });
}
