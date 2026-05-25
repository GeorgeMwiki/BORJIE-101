/**
 * Dark-pattern detector — public surface.
 */
export { createDarkPatternDetector } from './service.js';
export type {
  DarkPatternDetector,
  DarkPatternDetectorOptions,
} from './service.js';
export { BRIGNULL_TAXONOMY, specFor } from './taxonomy.js';
export type { BrignullCategorySpec } from './taxonomy.js';
export {
  DEFAULT_DETECTORS,
  baitAndSwitchDetector,
  confirmshamingDetector,
  disguisedAdsDetector,
  forcedActionDetector,
  hiddenCostsDetector,
  misdirectionDetector,
  obstructionDetector,
  priceComparisonPreventionDetector,
  privacyZuckeringDetector,
  roachMotelDetector,
  scarcityDetector,
  sneakingDetector,
  socialProofDetector,
  urgencyDetector,
} from './detectors.js';
export type { Detector, ScanInput } from './detectors.js';
