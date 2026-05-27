/**
 * LinUCB — Linear Upper Confidence Bound contextual bandit.
 *
 * Disjoint-arm formulation: each arm a maintains
 *    A_a  := λ I + Σ x_t x_tᵀ  (over rounds where a was chosen)
 *    b_a  := Σ r_t x_t
 *    θ_a  := A_a^{-1} b_a
 *    UCB  := θ_aᵀ x + α √(xᵀ A_a^{-1} x)
 * The arm with the largest UCB is selected.
 *
 * No native matrix deps — we use the pure-TS Cholesky solver in
 * `util/linalg.ts`. Determinism: there's no PRNG; the solver is
 * exact arithmetic up to floating point.
 *
 * Citation: Li, Chu, Langford, Schapire — "A Contextual-Bandit
 * Approach to Personalized News Article Recommendation", WWW 2010 /
 * arXiv:1003.0146. The production-grade reference for contextual
 * bandits in recommendation; the regret bound is
 * O(d √T log T) under the linear-reward assumption.
 */

import { solveSymmetric } from '../util/linalg.js';

export interface LinUCBState {
  readonly arms: ReadonlyArray<string>;
  readonly d: number;
  readonly alpha: number;
  /** A_a matrices, one per arm. */
  readonly A: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
  /** b_a vectors, one per arm. */
  readonly b: ReadonlyArray<ReadonlyArray<number>>;
}

export interface LinUCBBandit {
  /** Choose an arm given a d-dimensional context x. */
  select(context: ReadonlyArray<number>): string;
  /** Update the chosen arm's matrices with the observed reward. */
  update(arm: string, context: ReadonlyArray<number>, reward: number): void;
  snapshot(): LinUCBState;
}

export interface LinUCBOptions {
  readonly arms: ReadonlyArray<string>;
  readonly d: number;
  /** Exploration coefficient α. Default 1.0. */
  readonly alpha?: number;
  /** Ridge regularization λ. Default 1.0. */
  readonly ridge?: number;
}

export function createLinUCBBandit(opts: LinUCBOptions): LinUCBBandit {
  if (opts.arms.length === 0)
    throw new Error('linucb: at least one arm required');
  if (opts.d <= 0) throw new Error('linucb: d must be > 0');
  const arms = [...opts.arms];
  const d = opts.d;
  const alpha = opts.alpha ?? 1.0;
  const ridge = opts.ridge ?? 1.0;
  if (ridge <= 0) throw new Error('linucb: ridge must be > 0');
  const A: number[][][] = arms.map(() => makeIdentity(d, ridge));
  const b: number[][] = arms.map(() => new Array<number>(d).fill(0));
  const index = new Map<string, number>();
  arms.forEach((a, i) => index.set(a, i));

  function checkContext(x: ReadonlyArray<number>): void {
    if (x.length !== d) {
      throw new Error(`linucb: context dim ${x.length} != configured d=${d}`);
    }
    for (const v of x) {
      if (!Number.isFinite(v))
        throw new Error('linucb: context contains non-finite');
    }
  }

  function select(context: ReadonlyArray<number>): string {
    checkContext(context);
    let bestArm = arms[0] as string;
    let bestUCB = -Infinity;
    for (let i = 0; i < arms.length; i += 1) {
      const Ai = A[i] as number[][];
      const bi = b[i] as number[];
      const theta = solveSymmetric(Ai, bi);
      const AiInvX = solveSymmetric(Ai, context);
      let mean = 0;
      let variance = 0;
      for (let j = 0; j < d; j += 1) {
        mean += (theta[j] as number) * (context[j] as number);
        variance += (context[j] as number) * (AiInvX[j] as number);
      }
      const ucb = mean + alpha * Math.sqrt(Math.max(0, variance));
      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestArm = arms[i] as string;
      }
    }
    return bestArm;
  }

  function update(
    arm: string,
    context: ReadonlyArray<number>,
    reward: number,
  ): void {
    checkContext(context);
    if (!Number.isFinite(reward)) throw new Error('linucb: reward must be finite');
    const i = index.get(arm);
    if (i === undefined) throw new Error(`linucb: unknown arm ${arm}`);
    const Ai = A[i] as number[][];
    const bi = b[i] as number[];
    // A += x xᵀ
    for (let r = 0; r < d; r += 1) {
      const xr = context[r] as number;
      const row = Ai[r] as number[];
      for (let col = 0; col < d; col += 1)
        row[col] = (row[col] as number) + xr * (context[col] as number);
    }
    // b += r * x
    for (let r = 0; r < d; r += 1)
      bi[r] = (bi[r] as number) + reward * (context[r] as number);
  }

  function snapshot(): LinUCBState {
    return {
      arms: [...arms],
      d,
      alpha,
      A: A.map((m) => m.map((row) => [...row])),
      b: b.map((row) => [...row]),
    };
  }

  return { select, update, snapshot };
}

function makeIdentity(d: number, ridge: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < d; i += 1) {
    const row = new Array<number>(d).fill(0);
    row[i] = ridge;
    m.push(row);
  }
  return m;
}
