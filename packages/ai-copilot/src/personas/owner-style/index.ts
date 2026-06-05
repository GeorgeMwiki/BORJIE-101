/**
 * Owner-Style learning loop — public module surface.
 *
 * Mr. Mwikila adapts to the mining owner's way of running their portfolio.
 * Profiles are Bayesian: every observation blends with the prior; old
 * observations decay (0.98); explicit reactions amplify (reaction-boost).
 *
 * Ported from the BossNyumba owner-style learning loop and retargeted
 * real-estate → mining. The 5 dimensions (verbosity, detail, language,
 * formality, posture) are communication-style axes; the EN + SW lexicons
 * carry mining-owner idioms. Currency-neutral; complete EN + SW signal
 * detection.
 */

export type {
  Verbosity,
  Detail,
  LanguagePreference,
  Formality,
  Posture,
  VerbosityDimension,
  DetailDimension,
  LanguageDimension,
  FormalityDimension,
  PostureDimension,
  OwnerStyleProfile,
  DimensionKey,
} from './style-dimensions.js';

export {
  OwnerStyleProfileSchema,
  makeDefaultProfile,
  defaultDimension,
  PRIOR_ALPHA,
  DIMENSION_KEYS,
  CATEGORY_VALUES,
} from './style-dimensions.js';

export type {
  ChatTurnObservation,
  EvidenceVector,
  ProfilerOptions,
} from './profiler.js';

export {
  ChatTurnObservationSchema,
  extractEvidence,
  updateProfile,
  updateProfileBatch,
} from './profiler.js';

export type {
  ClassifierResult,
  StyleClassifier,
  InferInitialProfileArgs,
} from './style-inferrer.js';

export {
  inferInitialProfile,
  lexicalClassifier,
  STYLE_CLASSIFIER_PROMPT,
} from './style-inferrer.js';

export type { FeedbackSignal, FeedbackSignalKind } from './feedback-loop.js';
export {
  FeedbackSignalSchema,
  applyFeedback,
  applyFeedbackText,
  parseFeedbackText,
} from './feedback-loop.js';

export { buildStyleHint, applyStyleHint } from './style-hint.js';

export type { OwnerStyleProfileStore } from './persistence-port.js';
export {
  createInMemoryProfileStore,
  fetchOrDefault,
} from './persistence-port.js';

export type {
  OwnerStyleService,
  CreateOwnerStyleServiceOptions,
  RefineResult,
} from './owner-style-service.js';
export {
  createOwnerStyleService,
  defaultProfileFor,
} from './owner-style-service.js';
