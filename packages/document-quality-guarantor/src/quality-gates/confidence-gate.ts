/**
 * confidenceGate — rejects extractions whose document-level confidence
 * is below `minConfidence`. The simplest possible gate; serves as the
 * canonical reference implementation other gates pattern-match against.
 */

import type { QualityReport } from '../types.js';
import type { ConfidenceGateInput, Gate } from './types.js';

export interface ConfidenceGateOptions {
  readonly minConfidence: number;
}

export function confidenceGate(opts: ConfidenceGateOptions): Gate<ConfidenceGateInput> {
  return {
    id: 'confidenceGate',
    async evaluate({ extracted }): Promise<QualityReport> {
      const passed = extracted.confidence >= opts.minConfidence;
      return {
        gateId: 'confidenceGate',
        score: {
          value: extracted.confidence,
          threshold: opts.minConfidence,
          passed,
        },
        reasons: passed
          ? [`confidence ${extracted.confidence} >= threshold ${opts.minConfidence}`]
          : [
              `confidence ${extracted.confidence} below threshold ${opts.minConfidence}; producedBy=${extracted.producedBy}`,
            ],
        details: { producedBy: extracted.producedBy, pages: extracted.pages.length },
      };
    },
  };
}
