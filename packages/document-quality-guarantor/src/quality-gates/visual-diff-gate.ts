/**
 * visualDiffGate — pixelmatch-style per-pixel diff with a configurable
 * tolerance. We intentionally implement the diff in-tree (rather than
 * pulling pixelmatch as a hard dep) so the package stays zero-dep.
 *
 * The diff returns the fraction of pixels exceeding the per-channel
 * tolerance; the gate passes when fraction ≤ pixelTolerance (in [0,1]).
 * Anti-aliasing is treated as noise by allowing a per-channel delta of
 * up to `colorTolerance` (0–255) before counting the pixel as different.
 */

import type { QualityReport } from '../types.js';
import type { Gate, VisualDiffGateInput } from './types.js';

export interface VisualDiffGateOptions {
  /** Max fraction of pixels allowed to differ (0..1). Default 0.005. */
  readonly pixelTolerance: number;
  /** Max per-channel delta tolerated as noise (0..255). Default 8. */
  readonly colorTolerance?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function visualDiffGate(opts: VisualDiffGateOptions): Gate<VisualDiffGateInput> {
  const colorTolerance = opts.colorTolerance ?? 8;
  return {
    id: 'visualDiffGate',
    async evaluate(input): Promise<QualityReport> {
      const { baseline, candidate, width, height } = input;
      const expectedLen = width * height * 4;
      if (baseline.length !== expectedLen || candidate.length !== expectedLen) {
        return {
          gateId: 'visualDiffGate',
          score: { value: 0, threshold: 1, passed: false },
          reasons: [
            `dimension mismatch: expected ${expectedLen} bytes (${width}x${height} RGBA), got baseline=${baseline.length}, candidate=${candidate.length}`,
          ],
        };
      }
      let differing = 0;
      const totalPixels = width * height;
      for (let i = 0; i < expectedLen; i += 4) {
        const dr = Math.abs((baseline[i] ?? 0) - (candidate[i] ?? 0));
        const dg = Math.abs((baseline[i + 1] ?? 0) - (candidate[i + 1] ?? 0));
        const db = Math.abs((baseline[i + 2] ?? 0) - (candidate[i + 2] ?? 0));
        const da = Math.abs((baseline[i + 3] ?? 0) - (candidate[i + 3] ?? 0));
        if (dr > colorTolerance || dg > colorTolerance || db > colorTolerance || da > colorTolerance) {
          differing += 1;
        }
      }
      const fraction = totalPixels === 0 ? 0 : differing / totalPixels;
      const score = clamp(1 - fraction, 0, 1);
      const passed = fraction <= opts.pixelTolerance;
      return {
        gateId: 'visualDiffGate',
        score: { value: score, threshold: 1 - opts.pixelTolerance, passed },
        reasons: passed
          ? [`pixel diff ${(fraction * 100).toFixed(3)}% within tolerance`]
          : [
              `pixel diff ${(fraction * 100).toFixed(3)}% exceeds tolerance ${(opts.pixelTolerance * 100).toFixed(3)}%`,
            ],
        details: { differingPixels: differing, totalPixels, colorTolerance },
      };
    },
  };
}
