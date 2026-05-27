/**
 * Placebo refutation — pure TypeScript.
 *
 * Runs the same estimator on a SYNTHETIC outcome that, by
 * construction, has no causal connection to the treatment. If the
 * estimator returns a non-zero effect on the placebo outcome, the
 * estimator (or the data) is suspect.
 *
 * Two placebo strategies:
 *
 *  - 'random-outcome' — replace the outcome column with i.i.d. draws
 *    from a fixed-mean Gaussian (mean = observed-Y mean, sigma = 1).
 *  - 'permuted-outcome' — randomly shuffle the outcome column,
 *    breaking the treatment-outcome alignment.
 *
 * Caller supplies the estimator as a function from
 * (observations-with-replaced-outcome) -> effect. The placebo runs
 * `numReplications` times and returns the absolute mean placebo
 * effect.
 *
 * @module @borjie/causal-inference/refute/placebo
 */

import { mulberry32 } from './prng.js';

export interface PlaceboObservation {
  readonly outcome: number;
  /** Arbitrary opaque payload the estimator needs. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PlaceboOptions {
  readonly strategy?: 'random-outcome' | 'permuted-outcome';
  readonly numReplications?: number;
  readonly seed?: number;
}

export interface PlaceboReport {
  readonly meanEffect: number;
  readonly absMeanEffect: number;
  readonly replications: ReadonlyArray<number>;
}

export function placeboRefutation(
  observations: ReadonlyArray<PlaceboObservation>,
  estimator: (obs: ReadonlyArray<PlaceboObservation>) => number,
  options: PlaceboOptions = {},
): PlaceboReport {
  const strategy = options.strategy ?? 'permuted-outcome';
  const reps = Math.max(1, options.numReplications ?? 200);
  const rng = mulberry32(options.seed ?? 1729);
  const outcomes = observations.map((o) => o.outcome);
  let outcomeMean = 0;
  for (const v of outcomes) outcomeMean += v;
  outcomeMean /= Math.max(1, outcomes.length);

  const effects: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    let replaced: PlaceboObservation[];
    if (strategy === 'random-outcome') {
      replaced = observations.map((o) => ({
        outcome: outcomeMean + standardNormal(rng),
        payload: o.payload,
      }));
    } else {
      const idx = permutation(observations.length, rng);
      replaced = observations.map((o, i) => ({
        outcome: outcomes[idx[i] as number] as number,
        payload: o.payload,
      }));
    }
    effects.push(estimator(replaced));
  }
  let mean = 0;
  for (const e of effects) mean += e;
  mean /= Math.max(1, effects.length);
  let absMean = 0;
  for (const e of effects) absMean += Math.abs(e);
  absMean /= Math.max(1, effects.length);
  return Object.freeze({
    meanEffect: mean,
    absMeanEffect: absMean,
    replications: Object.freeze(effects.slice()),
  });
}

function permutation(n: number, rng: () => number): number[] {
  const a: number[] = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i] as number;
    a[i] = a[j] as number;
    a[j] = tmp;
  }
  return a;
}

function standardNormal(rng: () => number): number {
  // Box-Muller.
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
