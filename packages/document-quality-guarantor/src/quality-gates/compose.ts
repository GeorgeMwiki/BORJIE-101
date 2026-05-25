/**
 * composeGates — turns an array of gates into a single gate. The
 * composed gate runs each sub-gate sequentially (deterministic order
 * for replay), collects every report, and passes only if EVERY sub-
 * gate passed. The composed score is the minimum sub-score
 * (worst-case bound).
 *
 * Sub-gate inputs may differ; the caller supplies an input mapper
 * `inputFor(gateId)` so each gate gets exactly the shape it expects.
 */

import type { QualityReport } from '../types.js';
import type { Gate } from './types.js';

export interface ComposedGateInput<TByGateId extends Record<string, unknown>> {
  readonly inputs: TByGateId;
}

export interface ComposeGatesOptions {
  /** Stop on first failure; default false (collect all reports). */
  readonly bailOnFirstFailure?: boolean;
}

export function composeGates<TByGateId extends Record<string, unknown>>(
  gates: ReadonlyArray<Gate<unknown>>,
  opts: ComposeGatesOptions = {},
): Gate<ComposedGateInput<TByGateId>> {
  return {
    id: 'composedGate',
    async evaluate(input): Promise<QualityReport> {
      const reports: QualityReport[] = [];
      let minScore = 1;
      let allPassed = true;
      for (const gate of gates) {
        const gateInput = (input.inputs as Record<string, unknown>)[gate.id];
        if (gateInput === undefined) {
          // No input provided for this gate — treat as non-applicable
          // and skip rather than fail (caller convention).
          continue;
        }
        const report = await gate.evaluate(gateInput);
        reports.push(report);
        if (!report.score.passed) allPassed = false;
        if (report.score.value < minScore) minScore = report.score.value;
        if (opts.bailOnFirstFailure === true && !report.score.passed) break;
      }
      return {
        gateId: 'composedGate',
        score: { value: minScore, threshold: 1, passed: allPassed },
        reasons: reports.flatMap((r) =>
          r.reasons.map((reason) => `[${r.gateId}] ${reason}`),
        ),
        details: { childReports: reports },
      };
    },
  };
}
