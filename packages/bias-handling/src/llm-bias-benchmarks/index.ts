/**
 * LLM bias benchmarks barrel.
 *
 * 5 suites: BBQ (Parrish et al. 2022), StereoSet (Nadeem et al.
 * 2021), CrowS-Pairs (Nangia et al. 2020), HONEST (Nozza et al.
 * 2021), RealToxicityPrompts (Gehman et al. 2020).
 *
 * Each ships a built-in fixture for smoke / CI runs and accepts
 * the full HuggingFace release via the `dataset` parameter.
 */

export { BBQ_CATEGORIES, BBQ_FIXTURE } from './bbq-fixtures.js';
export type { BBQItem } from './bbq-fixtures.js';
export { runBBQ } from './bbq.js';
export type { BBQRunArgs } from './bbq.js';

export {
  STEREOSET_CATEGORIES,
  STEREOSET_FIXTURE,
  runStereoSet,
} from './stereoset.js';
export type { StereoSetItem, StereoSetRunArgs } from './stereoset.js';

export {
  CROWS_PAIRS_CATEGORIES,
  CROWS_PAIRS_FIXTURE,
  runCrowSPairs,
} from './crows-pairs.js';
export type { CrowSPairsItem, CrowSPairsRunArgs } from './crows-pairs.js';

export {
  HONEST_CATEGORIES,
  HONEST_FIXTURE,
  runHONEST,
} from './honest.js';
export type { HONESTRunArgs, HonestItem } from './honest.js';

export {
  RTP_CATEGORIES,
  RTP_FIXTURE,
  runRealToxicityPrompts,
} from './real-toxicity-prompts.js';
export type { RTPItem, RTPRunArgs } from './real-toxicity-prompts.js';

export { containsAnyKeyword, parseChoiceIndex } from './parse-utils.js';
