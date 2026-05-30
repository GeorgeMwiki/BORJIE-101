/**
 * Owner-Style Dimensions — schema for the OwnerStyleProfile.
 *
 * The MD adapts to the OWNER'S way of running the business. We model the
 * owner along ~7 orthogonal dimensions, each a discrete category with a
 * confidence (Dirichlet-Multinomial posterior projected to a category
 * distribution). The profile is the headline category PLUS the full
 * distribution so the Bayesian updater can refine smoothly.
 *
 * All structures are deeply readonly — every update returns a new profile.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Categorical dimensions
// ---------------------------------------------------------------------------

export const ToneSchema = z.enum([
  "formal",
  "casual",
  "collegial",
  "coach_like",
]);
export type Tone = z.infer<typeof ToneSchema>;

export const VerbositySchema = z.enum(["terse", "balanced", "verbose"]);
export type Verbosity = z.infer<typeof VerbositySchema>;

export const DecisionStyleSchema = z.enum([
  "directive",
  "collaborative",
  "consultative",
]);
export type DecisionStyle = z.infer<typeof DecisionStyleSchema>;

export const RiskAppetiteSchema = z.enum([
  "conservative",
  "moderate",
  "aggressive",
]);
export type RiskAppetite = z.infer<typeof RiskAppetiteSchema>;

export const LanguagePreferenceSchema = z.enum([
  "english_only",
  "swahili_leaning_bilingual",
  "english_leaning_bilingual",
  "swahili_only",
]);
export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>;

export const ChannelPreferenceSchema = z.enum([
  "chat_only",
  "chat_plus_email",
  "chat_plus_voice",
  "multi_channel",
]);
export type ChannelPreference = z.infer<typeof ChannelPreferenceSchema>;

export const DomainPrioritySchema = z.enum([
  "sales_led",
  "ops_led",
  "people_led",
  "finance_led",
  "balanced",
]);
export type DomainPriority = z.infer<typeof DomainPrioritySchema>;

export const TimeOfDayBandSchema = z.enum([
  "early_morning", //  04-08
  "morning", //         08-12
  "afternoon", //       12-16
  "evening", //         16-20
  "night", //           20-04
]);
export type TimeOfDayBand = z.infer<typeof TimeOfDayBandSchema>;

// ---------------------------------------------------------------------------
// Dimension wrapper: headline value + full posterior + sample size
// ---------------------------------------------------------------------------

/**
 * A categorical dimension is stored as a posterior over its categories.
 * `weights` is a Dirichlet pseudo-count vector (positive reals). The
 * headline `value` is `argmax(weights)`; `confidence` is the share of
 * probability mass at that category.
 */
const PositiveWeights = z.record(z.string(), z.number().nonnegative());

export const ToneDimensionSchema = z.object({
  value: ToneSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type ToneDimension = z.infer<typeof ToneDimensionSchema>;

export const VerbosityDimensionSchema = z.object({
  value: VerbositySchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type VerbosityDimension = z.infer<typeof VerbosityDimensionSchema>;

export const DecisionStyleDimensionSchema = z.object({
  value: DecisionStyleSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type DecisionStyleDimension = z.infer<
  typeof DecisionStyleDimensionSchema
>;

export const RiskAppetiteDimensionSchema = z.object({
  value: RiskAppetiteSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type RiskAppetiteDimension = z.infer<typeof RiskAppetiteDimensionSchema>;

export const LanguageDimensionSchema = z.object({
  value: LanguagePreferenceSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type LanguageDimension = z.infer<typeof LanguageDimensionSchema>;

export const ChannelDimensionSchema = z.object({
  value: ChannelPreferenceSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type ChannelDimension = z.infer<typeof ChannelDimensionSchema>;

export const DomainDimensionSchema = z.object({
  value: DomainPrioritySchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type DomainDimension = z.infer<typeof DomainDimensionSchema>;

export const TimeOfDayPatternSchema = z.object({
  /** posterior distribution over five bands; sums to ~1 */
  bands: z.record(TimeOfDayBandSchema, z.number().nonnegative()),
  /** band with highest mass */
  peakBand: TimeOfDayBandSchema,
  /** count of observations contributing to this distribution */
  sampleSize: z.number().int().nonnegative(),
});
export type TimeOfDayPattern = z.infer<typeof TimeOfDayPatternSchema>;

// ---------------------------------------------------------------------------
// The full OwnerStyleProfile
// ---------------------------------------------------------------------------

export const OwnerStyleProfileSchema = z.object({
  tenantId: z.string().min(1),
  ownerUserId: z.string().min(1),
  tone: ToneDimensionSchema,
  verbosity: VerbosityDimensionSchema,
  decisionStyle: DecisionStyleDimensionSchema,
  riskAppetite: RiskAppetiteDimensionSchema,
  languagePreference: LanguageDimensionSchema,
  channelPreference: ChannelDimensionSchema,
  timeOfDayPatterns: TimeOfDayPatternSchema,
  domainPriorities: DomainDimensionSchema,
  lastUpdatedAt: z.string(),
  sampleSize: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});
export type OwnerStyleProfile = z.infer<typeof OwnerStyleProfileSchema>;

// ---------------------------------------------------------------------------
// Defaults — the uniform prior we start from before any observation
// ---------------------------------------------------------------------------

/** Pseudo-count alpha used as the uniform Dirichlet prior. */
export const PRIOR_ALPHA = 1;

const uniformWeights = <T extends string>(values: ReadonlyArray<T>) =>
  Object.fromEntries(values.map((v) => [v, PRIOR_ALPHA])) as Record<T, number>;

const TONE_VALUES = ToneSchema.options;
const VERBOSITY_VALUES = VerbositySchema.options;
const DECISION_VALUES = DecisionStyleSchema.options;
const RISK_VALUES = RiskAppetiteSchema.options;
const LANG_VALUES = LanguagePreferenceSchema.options;
const CHANNEL_VALUES = ChannelPreferenceSchema.options;
const DOMAIN_VALUES = DomainPrioritySchema.options;
const TOD_VALUES = TimeOfDayBandSchema.options;

export function defaultDimension<T extends string>(
  values: ReadonlyArray<T>,
  initial: T,
): { value: T; weights: Record<T, number>; confidence: number } {
  const weights = uniformWeights(values);
  return {
    value: initial,
    weights,
    confidence: 1 / values.length,
  };
}

/**
 * A neutral starting profile for a brand-new owner. The headline value of
 * each dimension is the middle-of-the-road default; confidence is at the
 * floor (1 / n_categories).
 */
export function makeDefaultProfile(args: {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly now?: () => string;
}): OwnerStyleProfile {
  const now = (args.now ?? (() => new Date().toISOString()))();
  const todBands = Object.fromEntries(
    TOD_VALUES.map((b) => [b, PRIOR_ALPHA]),
  ) as Record<TimeOfDayBand, number>;
  return {
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    tone: defaultDimension(TONE_VALUES, "collegial"),
    verbosity: defaultDimension(VERBOSITY_VALUES, "balanced"),
    decisionStyle: defaultDimension(DECISION_VALUES, "collaborative"),
    riskAppetite: defaultDimension(RISK_VALUES, "moderate"),
    languagePreference: defaultDimension(LANG_VALUES, "english_only"),
    channelPreference: defaultDimension(CHANNEL_VALUES, "chat_only"),
    timeOfDayPatterns: {
      bands: todBands,
      peakBand: "morning",
      sampleSize: 0,
    },
    domainPriorities: defaultDimension(DOMAIN_VALUES, "balanced"),
    lastUpdatedAt: now,
    sampleSize: 0,
    confidence: 1 / TONE_VALUES.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers used by the profiler and adapters
// ---------------------------------------------------------------------------

export const DIMENSION_KEYS = [
  "tone",
  "verbosity",
  "decisionStyle",
  "riskAppetite",
  "languagePreference",
  "channelPreference",
  "domainPriorities",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const CATEGORY_VALUES: Record<DimensionKey, ReadonlyArray<string>> = {
  tone: TONE_VALUES,
  verbosity: VERBOSITY_VALUES,
  decisionStyle: DECISION_VALUES,
  riskAppetite: RISK_VALUES,
  languagePreference: LANG_VALUES,
  channelPreference: CHANNEL_VALUES,
  domainPriorities: DOMAIN_VALUES,
};
