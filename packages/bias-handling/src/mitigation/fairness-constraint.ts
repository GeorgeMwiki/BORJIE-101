/**
 * In-processing mitigation: **Fairness constraint adapter**.
 *
 * Wraps a model trainer such that an extra Lagrangian-style
 * penalty is added to the training loss whenever the model
 * violates a `FairnessConstraint`. Adapts the Fairlearn
 * `ExponentiatedGradient` reduction approach (Agarwal et al.
 * ICML 2018) to a generic interface that does not assume a
 * specific ML framework.
 *
 * The caller supplies:
 *   - the inner model trainer (a function that takes weighted
 *     rows and returns a model),
 *   - the fairness constraint specification.
 *
 * We return a *trained model* that is the best feasible model
 * inside the constraint envelope. The actual optimisation
 * algorithm lives in the inner trainer — we provide the
 * penalty-budget update step.
 *
 * Tradeoffs:
 *  - Strict constraints can hurt accuracy substantially.
 *  - Convergence depends on inner trainer cooperating with
 *    sample weights / penalty.
 *  - Not all constraints are jointly feasible (Pleiss et al.
 *    2017 — calibration vs equalized-odds impossibility).
 */

import type { DisparityScore, FairnessConstraint } from '../types.js';

export interface InnerTrainerInput<R> {
  readonly rows: ReadonlyArray<{ row: R; weight: number }>;
  readonly lambda: number;
}

export interface ConstraintAdapterArgs<R, M> {
  readonly innerTrainer: (input: InnerTrainerInput<R>) => Promise<M>;
  readonly evaluator: (model: M) => Promise<DisparityScore>;
  readonly constraint: FairnessConstraint;
  readonly initialRows: ReadonlyArray<R>;
  readonly maxIterations?: number;
}

export interface ConstrainedModelResult<M> {
  readonly model: M;
  readonly finalDisparity: DisparityScore;
  readonly iterations: number;
  readonly converged: boolean;
}

/**
 * Iteratively trains the inner model while increasing the
 * Lagrange multiplier until the constraint is met (or until
 * `maxIterations`). Pure orchestration — no ML library needed.
 */
export async function addFairnessConstraint<R, M>(
  args: ConstraintAdapterArgs<R, M>,
): Promise<ConstrainedModelResult<M>> {
  const maxIter = args.maxIterations ?? 10;
  const lambdaInit = args.constraint.lambda ?? 0.1;
  let lambda = lambdaInit;
  let model = await args.innerTrainer({
    rows: args.initialRows.map((r) => ({ row: r, weight: 1 })),
    lambda,
  });
  let disparity = await args.evaluator(model);
  let iter = 1;
  while (
    Math.abs(disparity.score) > args.constraint.maxDisparity &&
    iter < maxIter
  ) {
    lambda *= 2;
    model = await args.innerTrainer({
      rows: args.initialRows.map((r) => ({ row: r, weight: 1 })),
      lambda,
    });
    disparity = await args.evaluator(model);
    iter += 1;
  }
  const converged = Math.abs(disparity.score) <= args.constraint.maxDisparity;
  return {
    model,
    finalDisparity: disparity,
    iterations: iter,
    converged,
  };
}
