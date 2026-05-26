/**
 * Composite gate — AND-combines per-gate verdicts and collects every
 * emitted signal.
 *
 * The composite is the *only* surface the loop runner (Layer 5) is
 * allowed to invoke. Individual gates are exposed for testing and for
 * surgical re-runs (e.g. a brand re-check after a re-render). The
 * overall pass is the logical AND of every gate's `pass`.
 *
 * Even failed signals are returned in the result — the learning layer
 * (Layer 5) consumes them to downweight skills / cells / calibrator
 * priors. This is the principle from Constitutional AI: a failed
 * critique is still a learning signal.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4.
 */

import {
  QualityGateError,
  type CompositeGateResult,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export interface NamedGateInvocation {
  /** Stable name used in `failedGates` and audit signals. */
  readonly name: string;
  /** The gate's `QualityGateResult` (sync or async). */
  readonly result: QualityGateResult | Promise<QualityGateResult>;
}

export interface CompositeInput {
  readonly invocations: ReadonlyArray<NamedGateInvocation>;
}

export async function compositeGate(
  input: CompositeInput,
): Promise<CompositeGateResult> {
  if (!input || !input.invocations) {
    throw new QualityGateError(
      'composite gate received null input',
      'INVALID_INPUT',
    );
  }
  if (input.invocations.length === 0) {
    throw new QualityGateError(
      'composite gate received zero invocations',
      'INVALID_INPUT',
    );
  }

  // Run all gates concurrently — order-independent by contract.
  const results = await Promise.all(
    input.invocations.map(async (inv) => {
      const result = await inv.result;
      return { name: inv.name, result };
    }),
  );

  const signals: QualitySignal[] = [];
  const failedGates: string[] = [];
  const reasonParts: string[] = [];
  let overallPass = true;

  for (const { name, result } of results) {
    signals.push(result.signal);
    if (!result.pass) {
      overallPass = false;
      failedGates.push(name);
      reasonParts.push(`${name}:${result.reason}`);
    }
  }

  return Object.freeze({
    pass: overallPass,
    signals: Object.freeze([...signals]),
    failedGates: Object.freeze([...failedGates]),
    reason: overallPass
      ? 'pass:all-gates-clean'
      : `fail:${reasonParts.join('|')}`,
  });
}
