/**
 * In-processing mitigation: **Adversarial Debiasing** (Zhang,
 * Lemoine, Mitchell AIES 2018 — "Mitigating Unwanted Biases with
 * Adversarial Learning").
 *
 * Trains a predictor + adversary jointly. The predictor minimises
 * its task loss; the adversary tries to recover the protected
 * attribute from the predictor's output. The predictor is trained
 * with a gradient *against* the adversary's success.
 *
 * Because the actual GD loop needs a differentiable framework
 * (PyTorch / TF), we expose an adapter / interface — the caller
 * plugs in the framework. The package provides the orchestration:
 * - alternates predictor + adversary updates,
 * - exposes a stopping criterion when the adversary's accuracy
 *   approaches chance.
 *
 * Tradeoffs:
 *  - Requires a differentiable framework.
 *  - Optimisation is unstable; needs careful tuning.
 *  - Strong adversary can collapse the predictor.
 */

export interface AdversarialPredictor<R, O> {
  trainStep(rows: ReadonlyArray<R>, adversaryGradScale: number): Promise<void>;
  predict(row: R): Promise<O>;
}

export interface AdversaryNetwork<O> {
  /**
   * Returns the adversary's accuracy at recovering the protected
   * attribute from the predictor output `O`. Closer to chance =
   * better debiasing.
   */
  trainAndScore(samples: ReadonlyArray<{ output: O; group: string }>): Promise<number>;
  /** Number of groups; chance accuracy = 1/nGroups. */
  readonly nGroups: number;
}

export interface AdversarialDebiasingArgs<R, O> {
  readonly predictor: AdversarialPredictor<R, O>;
  readonly adversary: AdversaryNetwork<O>;
  readonly rows: ReadonlyArray<R>;
  readonly groupOf: (row: R) => string;
  readonly maxEpochs?: number;
  /** Stop when adversary accuracy within `tol` of chance. */
  readonly stoppingTol?: number;
  /** How aggressively to scale adversary gradient. */
  readonly adversaryWeight?: number;
}

export interface AdversarialDebiasingResult {
  readonly epochs: number;
  readonly finalAdversaryAccuracy: number;
  readonly chanceAccuracy: number;
  readonly converged: boolean;
}

export async function adversarialDebiasing<R, O>(
  args: AdversarialDebiasingArgs<R, O>,
): Promise<AdversarialDebiasingResult> {
  const maxEpochs = args.maxEpochs ?? 20;
  const tol = args.stoppingTol ?? 0.05;
  const weight = args.adversaryWeight ?? 1.0;
  const chance = 1 / args.adversary.nGroups;
  let advAcc = 1.0;
  let epoch = 0;
  while (epoch < maxEpochs && advAcc - chance > tol) {
    await args.predictor.trainStep(args.rows, weight);
    const samples = await Promise.all(
      args.rows.map(async (r) => ({
        output: await args.predictor.predict(r),
        group: args.groupOf(r),
      })),
    );
    advAcc = await args.adversary.trainAndScore(samples);
    epoch += 1;
  }
  return {
    epochs: epoch,
    finalAdversaryAccuracy: advAcc,
    chanceAccuracy: chance,
    converged: advAcc - chance <= tol,
  };
}
