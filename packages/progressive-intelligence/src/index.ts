/**
 * `@borjie/progressive-intelligence` — public barrel.
 *
 * Subsystems (each is also reachable via `.../<name>` subpath export):
 *   - entity-resolution: dedup + canonicalization + merge
 *   - active-learning: uncertain case flagging + label incorporation
 *   - live-coaching: inline AI hints during data entry
 *   - streaming: SSE-friendly streaming inference
 *   - profile-unification: multi-source identity unification
 *   - personalization: few-shot per-user prompt augmentation
 *
 * Composition root: `createProgressiveIntelligence({...})` returns a
 * thin facade so consumers can wire it once and pass the result
 * around. Each member is also exported directly for callers that
 * prefer the tree-shakeable form.
 */
export * from './types.js';
export {
  resolveEntity,
  mergeEntities,
  type ResolveEntityArgs,
  type MergeEntitiesArgs,
} from './entity-resolution/index.js';
export {
  cosineSimilarity,
  levenshtein,
  levenshteinSimilarity,
  jaroWinkler,
  fuzzyStringSimilarity,
  normalizeIdentifier,
} from './entity-resolution/scoring.js';
export { createDeterministicMockEmbedder } from './embedders.js';
export {
  flagUncertainCases,
  requestLabel,
  incorporateLabel,
  emptyModel,
  detectNoisyLabels,
  noisyLabelsToCases,
  type FlagUncertainCasesArgs,
  type RequestLabelArgs,
  type IncorporateLabelArgs,
  type DetectNoiseArgs,
} from './active-learning/index.js';
export {
  coach,
  heuristicCoach,
  createThrottledCoach,
  type CoachArgs,
  type HeuristicCoachArgs,
  type ThrottleOptions,
  type ThrottledCoach,
} from './live-coaching/index.js';
export {
  streamInference,
  streamInferenceAsSse,
  encodeSse,
  type StreamInferenceArgs,
} from './streaming/index.js';
export {
  linkFragments,
  unifyProfile,
  incorporateFragment,
  currentUnified,
  type LinkFragmentsArgs,
  type UnifyProfileArgs,
  type CurrentUnifiedArgs,
  type FragmentStore,
} from './profile-unification/index.js';
export {
  buildPersonalizedPrompt,
  type BuildPersonalizedPromptArgs,
} from './personalization/index.js';
export {
  createProgressiveIntelligence,
  type ProgressiveIntelligence,
  type ProgressiveIntelligenceOptions,
} from './factory.js';
