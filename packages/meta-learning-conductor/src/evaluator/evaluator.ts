/**
 * Evaluator: runs the held-out eval on both the current ('before')
 * and proposed ('after') policy, returns the per-side metric.
 *
 * The actual evaluation logic lives behind the `EvaluatorPort`. This
 * module is a thin orchestration wrapper that runs both sides + does
 * basic sanity checks (NaN, out-of-range).
 *
 * Spec: Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md §2.4.
 */

import type { EvaluatorPort, Logger } from '../types.js';

export interface RunEvalParams {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly port: EvaluatorPort;
  readonly logger?: Logger;
}

export interface EvalOutcome {
  readonly evalMetricBefore: number;
  readonly evalMetricAfter: number;
}

export class EvaluatorError extends Error {
  public override readonly name = 'EvaluatorError';
}

/**
 * Run the before/after eval. Throws `EvaluatorError` on NaN /
 * out-of-range scores. We refuse to advance the loop on bad eval
 * data — the curator must fix the eval set, not the conductor.
 */
export async function runBeforeAfterEval(
  params: RunEvalParams,
): Promise<EvalOutcome> {
  const before = await params.port.score({
    tenantId: params.tenantId,
    capabilityId: params.capabilityId,
    side: 'before',
  });
  const after = await params.port.score({
    tenantId: params.tenantId,
    capabilityId: params.capabilityId,
    side: 'after',
  });

  assertValidScore(before, 'before');
  assertValidScore(after, 'after');

  params.logger?.info('meta-learning eval complete', {
    tenantId: params.tenantId,
    capabilityId: params.capabilityId,
    before,
    after,
  });

  return Object.freeze({
    evalMetricBefore: before,
    evalMetricAfter: after,
  });
}

function assertValidScore(score: number, side: string): void {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new EvaluatorError(`Eval score for '${side}' is not finite`);
  }
  if (score < 0 || score > 1) {
    throw new EvaluatorError(
      `Eval score for '${side}' out of [0,1]: ${String(score)}`,
    );
  }
}
