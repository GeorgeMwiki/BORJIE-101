/**
 * Owner-Style Profile — public module surface.
 *
 * The MD adapts to the owner's way of running their business. Profiles
 * are Bayesian: every observation blends with the prior; old observations
 * decay; reactions amplify.
 */

export type {
  Tone,
  Verbosity,
  DecisionStyle,
  RiskAppetite,
  LanguagePreference,
  ChannelPreference,
  DomainPriority,
  TimeOfDayBand,
  ToneDimension,
  VerbosityDimension,
  DecisionStyleDimension,
  RiskAppetiteDimension,
  LanguageDimension,
  ChannelDimension,
  DomainDimension,
  TimeOfDayPattern,
  OwnerStyleProfile,
  DimensionKey,
} from "./style-dimensions";

export {
  OwnerStyleProfileSchema,
  makeDefaultProfile,
  PRIOR_ALPHA,
  DIMENSION_KEYS,
  CATEGORY_VALUES,
} from "./style-dimensions";

export type {
  ChatTurnObservation,
  EvidenceVector,
  ProfilerOptions,
} from "./profiler";

export {
  ChatTurnObservationSchema,
  bandForTimestamp,
  extractEvidence,
  updateProfile,
  updateProfileBatch,
} from "./profiler";

export type {
  ClassifierResult,
  StyleClassifier,
  InferInitialProfileArgs,
} from "./style-inferrer";

export {
  inferInitialProfile,
  lexicalClassifier,
  STYLE_CLASSIFIER_PROMPT,
} from "./style-inferrer";

export type { BasePrompt, AdaptedPrompt } from "./prompt-adapter";
export { adaptPrompt, buildStyleDirective } from "./prompt-adapter";

export type { StyledOutput } from "./output-styler";
export { styleOutput } from "./output-styler";

export type { FeedbackSignal } from "./feedback-loop";
export {
  FeedbackSignalSchema,
  applyFeedback,
  applyFeedbackText,
  parseFeedbackText,
} from "./feedback-loop";

export type { ProfileStore, SupabaseLike } from "./style-persistence";
export {
  createInMemoryProfileStore,
  createSupabaseProfileStore,
  fetchOrDefault,
} from "./style-persistence";

export type {
  OwnerStyleService,
  OwnerKey,
  CreateServiceOptions,
} from "./owner-style-service";
export {
  createOwnerStyleService,
  defaultProfileFor,
} from "./owner-style-service";
