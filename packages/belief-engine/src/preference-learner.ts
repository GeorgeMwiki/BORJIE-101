/**
 * Preference learner — DPO-style logistic head over action-variant pairs.
 *
 * The brain frequently picks one action over another at decision time
 * (which nudge wording, which appraisal question, which routing arm). When
 * the chosen variant earns a better outcome than the rejected variant, that
 * pair becomes a (winner, loser) preference example.
 *
 * SOTA reference: DPO (Rafailov et al., NeurIPS 2023, arXiv 2305.18290). We
 * do NOT fine-tune a base model — we train a tiny logistic head on the
 * feature delta with L2-regularised SGD:
 *
 *   P(winner | z_w, z_l) = sigmoid(beta · (w · z_w − w · z_l))
 *
 * PURE module. State is passed in + returned out so storage adapters own
 * persistence (preference_pairs / preference_head_weights, migration 0274).
 *
 * Ported from LITFIN learning/preference-learner.ts (I/O layer dropped —
 * persistence is the caller's job via the injected store).
 */

import type { PreferencePair } from './learning-types.js';

export interface PreferenceHeadState {
  /** Logistic weights, one per feature dim. */
  readonly weights: ReadonlyArray<number>;
  /** Dimensionality. */
  readonly d: number;
  /** Inverse-temperature beta. */
  readonly beta: number;
  /** Number of pairs absorbed so far. */
  readonly seenPairs: number;
}

export interface TrainConfig {
  readonly learningRate: number;
  readonly l2: number;
  readonly epochs: number;
}

export const DEFAULT_TRAIN_CONFIG: TrainConfig = Object.freeze({
  learningRate: 0.05,
  l2: 0.001,
  epochs: 20,
});

const DEFAULT_BETA = 0.1;

export function createHeadState(
  d: number,
  beta: number = DEFAULT_BETA,
): PreferenceHeadState {
  return Object.freeze({
    weights: Object.freeze(Array.from({ length: d }, () => 0) as number[]),
    d,
    beta,
    seenPairs: 0,
  });
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function dot(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function deltaVector(pair: PreferencePair, d: number): number[] | null {
  if (pair.winnerFeatures.length !== d || pair.loserFeatures.length !== d) {
    return null;
  }
  const diff: number[] = [];
  for (let i = 0; i < d; i += 1) {
    diff.push(pair.winnerFeatures[i] - pair.loserFeatures[i]);
  }
  return diff;
}

/**
 * Train the head over a batch of preference pairs with L2-regularised SGD.
 * PURE — returns a new state; the input stays immutable.
 */
export function trainHead(
  state: PreferenceHeadState,
  pairs: ReadonlyArray<PreferencePair>,
  config: TrainConfig = DEFAULT_TRAIN_CONFIG,
): PreferenceHeadState {
  if (pairs.length === 0) return state;
  const weights: number[] = [...state.weights];
  const d = state.d;
  const lr = config.learningRate;
  const l2 = config.l2;

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    const grad: number[] = Array.from({ length: d }, () => 0);
    for (const pair of pairs) {
      const diff = deltaVector(pair, d);
      if (!diff) continue;
      const score = state.beta * dot(weights, diff);
      const p = sigmoid(score);
      // ∂(−log p(winner)) / ∂w = −(1 − p) · beta · diff
      const scale = -(1 - p) * state.beta;
      for (let i = 0; i < d; i += 1) grad[i] += scale * diff[i];
    }
    for (let i = 0; i < d; i += 1) grad[i] += 2 * l2 * weights[i];
    for (let i = 0; i < d; i += 1) weights[i] -= (lr / pairs.length) * grad[i];
  }

  return Object.freeze({
    weights: Object.freeze(weights),
    d,
    beta: state.beta,
    seenPairs: state.seenPairs + pairs.length,
  });
}

/**
 * Probability that variant A beats variant B under the current head.
 */
export function predictWinProbability(
  state: PreferenceHeadState,
  featuresA: ReadonlyArray<number>,
  featuresB: ReadonlyArray<number>,
): number {
  if (featuresA.length !== state.d || featuresB.length !== state.d) {
    return 0.5;
  }
  const diff: number[] = [];
  for (let i = 0; i < state.d; i += 1) {
    diff.push(featuresA[i] - featuresB[i]);
  }
  return sigmoid(state.beta * dot(state.weights, diff));
}

/**
 * DPO loss over a batch — numerically stable. Used by tests + the dashboard.
 */
export function dpoLoss(
  state: PreferenceHeadState,
  pairs: ReadonlyArray<PreferencePair>,
): number {
  if (pairs.length === 0) return 0;
  let loss = 0;
  let counted = 0;
  for (const pair of pairs) {
    const diff = deltaVector(pair, state.d);
    if (!diff) continue;
    const score = state.beta * dot(state.weights, diff);
    // −log sigmoid(score) = log(1 + exp(−score)), stable in both branches.
    loss += score >= 0 ? Math.log1p(Math.exp(-score)) : -score + Math.log1p(Math.exp(score));
    counted += 1;
  }
  return counted === 0 ? 0 : loss / counted;
}

/**
 * Rank candidate variants by predicted win-probability vs the incumbent
 * (index 0). Additive: this only re-orders; it never gates a decision. The
 * incumbent scores 0.5 against itself, a natural pivot. Mis-shaped candidate
 * vectors keep the input order.
 */
export function rankByPreferenceHead<
  T extends { readonly features: ReadonlyArray<number> },
>(state: PreferenceHeadState, candidates: ReadonlyArray<T>): ReadonlyArray<T> {
  if (candidates.length <= 1) return candidates;
  const incumbent = candidates[0];
  if (incumbent.features.length !== state.d) return candidates;
  const scored = candidates.map((c) => ({
    candidate: c,
    win:
      c.features.length === state.d
        ? predictWinProbability(state, c.features, incumbent.features)
        : 0,
  }));
  scored.sort((a, b) => b.win - a.win);
  return Object.freeze(scored.map((s) => s.candidate));
}

/**
 * Infer the modal feature dimensionality from a batch so a schema change
 * never mixes incompatible vectors into one head. Returns 0 for an empty
 * batch.
 */
export function inferModalDimension(
  pairs: ReadonlyArray<PreferencePair>,
): number {
  const counts = new Map<number, number>();
  for (const p of pairs) {
    counts.set(
      p.winnerFeatures.length,
      (counts.get(p.winnerFeatures.length) ?? 0) + 1,
    );
  }
  let d = 0;
  let best = -1;
  for (const [dim, count] of counts) {
    if (count > best) {
      best = count;
      d = dim;
    }
  }
  return d;
}
