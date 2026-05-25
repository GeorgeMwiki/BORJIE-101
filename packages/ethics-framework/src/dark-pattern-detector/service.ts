/**
 * Dark-pattern detector service.
 *
 * `scanComponent()` runs every detector against the input and returns
 * the union of detections. Pure — no I/O.
 */

import type { DarkPatternDetection } from '../types.js';
import { DEFAULT_DETECTORS, type Detector, type ScanInput } from './detectors.js';

export interface DarkPatternDetector {
  scanComponent(input: ScanInput): ReadonlyArray<DarkPatternDetection>;
}

export interface DarkPatternDetectorOptions {
  readonly detectors?: ReadonlyArray<Detector>;
}

export function createDarkPatternDetector(
  opts: DarkPatternDetectorOptions = {},
): DarkPatternDetector {
  const detectors = opts.detectors ?? DEFAULT_DETECTORS;
  return {
    scanComponent(input): ReadonlyArray<DarkPatternDetection> {
      const findings: DarkPatternDetection[] = [];
      for (const d of detectors) {
        const f = d(input);
        if (f) findings.push(f);
      }
      return findings;
    },
  };
}
