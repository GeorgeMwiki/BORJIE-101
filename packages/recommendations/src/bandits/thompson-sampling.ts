/**
 * Bernoulli Thompson Sampling — pure-TS, seed-deterministic.
 *
 * For each arm we maintain a Beta(α, β) posterior over its reward
 * probability. On each `select`, we sample θ_k ~ Beta(α_k, β_k) for
 * every arm and return the arm with the highest sample. On
 * `update`, we increment α by `reward` and β by `1 - reward` for
 * the selected arm.
 *
 * The Beta sample is generated via two Gamma samples (Marsaglia &
 * Tsang shape-≥1 method, with α' = α + 1 / x^(1/α) lift for
 * shape < 1). Deterministic under the injected PRNG so the test
 * `thompson-sampling-converges` produces the same regret trajectory
 * on every run.
 *
 * Citation: Agrawal & Goyal — "Analysis of Thompson Sampling for the
 * Multi-armed Bandit Problem", COLT 2012 / arXiv:1209.3352. Proves
 * a Θ(√KT log T) regret bound — the SOTA regret for stochastic
 * Bernoulli bandits and the reference proof used in 2024-2026 RL
 * textbooks.
 */

import { createPRNG, type PRNG } from '../util/prng.js';

export interface ThompsonSamplingState {
  readonly arms: ReadonlyArray<string>;
  readonly alpha: ReadonlyArray<number>;
  readonly beta: ReadonlyArray<number>;
}

export interface ThompsonSamplingBandit {
  /** Sample θ for every arm and return the arm with the max draw.
   *  Returns the chosen arm id. */
  select(): string;
  /** Update the posterior for the chosen arm with a Bernoulli
   *  reward (0 or 1) or a fractional reward in [0, 1]. */
  update(arm: string, reward: number): void;
  /** Read-only snapshot of the posterior. */
  snapshot(): ThompsonSamplingState;
}

export interface ThompsonSamplingOptions {
  readonly arms: ReadonlyArray<string>;
  /** Prior α. Default 1 (uniform). */
  readonly priorAlpha?: number;
  /** Prior β. Default 1 (uniform). */
  readonly priorBeta?: number;
  /** PRNG seed. Default deterministic. */
  readonly seed?: number;
}

export function createThompsonSamplingBandit(
  opts: ThompsonSamplingOptions,
): ThompsonSamplingBandit {
  if (opts.arms.length === 0) {
    throw new Error('thompson_sampling: at least one arm required');
  }
  const arms = [...opts.arms];
  const priorA = opts.priorAlpha ?? 1;
  const priorB = opts.priorBeta ?? 1;
  if (priorA <= 0 || priorB <= 0) {
    throw new Error('thompson_sampling: priors must be > 0');
  }
  const alpha = arms.map(() => priorA);
  const beta = arms.map(() => priorB);
  const prng = createPRNG(opts.seed ?? 0xdecafbad);
  const index = new Map<string, number>();
  arms.forEach((a, i) => index.set(a, i));

  function select(): string {
    let bestArm = arms[0] as string;
    let bestSample = -Infinity;
    for (let i = 0; i < arms.length; i += 1) {
      const sample = betaSample(prng, alpha[i] as number, beta[i] as number);
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arms[i] as string;
      }
    }
    return bestArm;
  }

  function update(arm: string, reward: number): void {
    const i = index.get(arm);
    if (i === undefined) {
      throw new Error(`thompson_sampling: unknown arm ${arm}`);
    }
    if (reward < 0 || reward > 1 || !Number.isFinite(reward)) {
      throw new Error(
        `thompson_sampling: reward must be in [0,1], got ${reward}`,
      );
    }
    alpha[i] = (alpha[i] as number) + reward;
    beta[i] = (beta[i] as number) + (1 - reward);
  }

  function snapshot(): ThompsonSamplingState {
    return { arms: [...arms], alpha: [...alpha], beta: [...beta] };
  }

  return { select, update, snapshot };
}

/** Beta(α, β) sample via two Gamma samples. */
function betaSample(prng: PRNG, a: number, b: number): number {
  const x = gammaSample(prng, a);
  const y = gammaSample(prng, b);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

/**
 * Gamma(shape, 1) sample. Marsaglia & Tsang for shape >= 1; the
 * shape < 1 case uses the standard α → α+1; U^(1/α) lift.
 */
function gammaSample(prng: PRNG, shape: number): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const g = gammaSample(prng, shape + 1);
    let u = prng.next();
    while (u === 0) u = prng.next();
    return g * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bound the loop to avoid pathological infinite spins in the
  // unlikely event of a degenerate PRNG state.
  for (let iter = 0; iter < 1000; iter += 1) {
    const z = prng.nextGaussian();
    const v0 = 1 + c * z;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    let u = prng.next();
    while (u === 0) u = prng.next();
    if (u < 1 - 0.0331 * z * z * z * z) return d * v;
    if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // last-resort fallback; the loop almost never reaches here
}
