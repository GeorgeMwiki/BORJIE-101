/**
 * Owner-Style Dimensions — schema for the OwnerStyleProfile.
 *
 * Mr. Mwikila adapts to the MINING OWNER'S way of running their portfolio —
 * the licence holder whose name is on the mineral right. We model the owner
 * along 5 orthogonal dimensions, each a discrete category carrying a
 * confidence (a Dirichlet-Multinomial posterior projected to a category
 * distribution). The profile is the headline category PLUS the full
 * distribution so the Bayesian updater can refine smoothly.
 *
 * The 5 dimensions (gap-8 spec):
 *   - verbosity   how much text the owner wants     (terse|balanced|verbose)
 *   - detail      how much reasoning to surface      (low|medium|high)
 *   - language    EN / SW preference                 (en|sw + bilingual leans)
 *   - formality   register                           (formal|neutral|casual)
 *   - posture     decision/risk stance               (cautious|balanced|bold)
 *
 * Ported from the BossNyumba owner-style model and retargeted real-estate →
 * mining: the dimensions themselves are communication-style axes (domain
 * neutral); only the EN+SW lexicons in the profiler/feedback-loop carry
 * mining-owner idioms (pit, haul, royalty, assay). Currency-neutral;
 * complete EN + SW.
 *
 * All structures are deeply readonly — every update returns a NEW profile
 * (immutability hard rule).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Categorical dimensions
// ---------------------------------------------------------------------------

export const VerbositySchema = z.enum(['terse', 'balanced', 'verbose']);
export type Verbosity = z.infer<typeof VerbositySchema>;

export const DetailSchema = z.enum(['low', 'medium', 'high']);
export type Detail = z.infer<typeof DetailSchema>;

/**
 * Language preference. CLAUDE.md: English default, bilingual sw/en, toggle is
 * ABSOLUTE. The two bilingual leans are inferred ambient signals; the absolute
 * EN/SW toggle is owned by the user's settings and overrides any lean at
 * render time.
 */
export const LanguagePreferenceSchema = z.enum([
  'en',
  'en_leaning_bilingual',
  'sw_leaning_bilingual',
  'sw',
]);
export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>;

export const FormalitySchema = z.enum(['formal', 'neutral', 'casual']);
export type Formality = z.infer<typeof FormalitySchema>;

/** Decision + risk stance, folded into one axis. */
export const PostureSchema = z.enum(['cautious', 'balanced', 'bold']);
export type Posture = z.infer<typeof PostureSchema>;

// ---------------------------------------------------------------------------
// Dimension wrapper: headline value + full posterior + confidence
// ---------------------------------------------------------------------------

/**
 * A categorical dimension is stored as a posterior over its categories.
 * `weights` is a Dirichlet pseudo-count vector (positive reals). The headline
 * `value` is `argmax(weights)`; `confidence` is the share of probability mass
 * at that category.
 */
const PositiveWeights = z.record(z.string(), z.number().nonnegative());

/**
 * Headline value + full posterior + confidence for one categorical dimension.
 * All three fields are REQUIRED. We declare the TS type explicitly (rather than
 * via `z.infer`) because under this toolchain (TS 6.0.3 + zod 3.25) `z.infer`
 * widens every object key to optional, which would break consumers that require
 * a complete estimate (TS2345 at the call sites). The zod schemas below remain
 * the single source of truth at RUNTIME.
 */
export interface StyleDimension<TValue extends string> {
  readonly value: TValue;
  readonly weights: Record<string, number>;
  readonly confidence: number;
}

export const VerbosityDimensionSchema = z.object({
  value: VerbositySchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type VerbosityDimension = StyleDimension<Verbosity>;

export const DetailDimensionSchema = z.object({
  value: DetailSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type DetailDimension = StyleDimension<Detail>;

export const LanguageDimensionSchema = z.object({
  value: LanguagePreferenceSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type LanguageDimension = StyleDimension<LanguagePreference>;

export const FormalityDimensionSchema = z.object({
  value: FormalitySchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type FormalityDimension = StyleDimension<Formality>;

export const PostureDimensionSchema = z.object({
  value: PostureSchema,
  weights: PositiveWeights,
  confidence: z.number().min(0).max(1),
});
export type PostureDimension = StyleDimension<Posture>;

// ---------------------------------------------------------------------------
// The full OwnerStyleProfile
// ---------------------------------------------------------------------------

export const OwnerStyleProfileSchema = z.object({
  tenantId: z.string().min(1),
  verbosity: VerbosityDimensionSchema,
  detail: DetailDimensionSchema,
  language: LanguageDimensionSchema,
  formality: FormalityDimensionSchema,
  posture: PostureDimensionSchema,
  /** ISO timestamp of the last refine. */
  lastUpdatedAt: z.string(),
  /** Total observations folded into this profile. */
  feedbackCount: z.number().int().nonnegative(),
  /** Aggregate confidence across all dimensions [0,1]. */
  confidence: z.number().min(0).max(1),
  /** The feedback signal kind that last moved the profile, if any. */
  updatedBySignal: z.string().nullable(),
});

/**
 * The full learned profile. Declared explicitly (not `z.infer`) so every field
 * — including the nested dimension estimates — is REQUIRED for consumers. The
 * schema above stays authoritative at runtime (`safeParse` in the persistence
 * port); this type is the compile-time contract.
 */
export interface OwnerStyleProfile {
  readonly tenantId: string;
  readonly verbosity: VerbosityDimension;
  readonly detail: DetailDimension;
  readonly language: LanguageDimension;
  readonly formality: FormalityDimension;
  readonly posture: PostureDimension;
  /** ISO timestamp of the last refine. */
  readonly lastUpdatedAt: string;
  /** Total observations folded into this profile. */
  readonly feedbackCount: number;
  /** Aggregate confidence across all dimensions [0,1]. */
  readonly confidence: number;
  /** The feedback signal kind that last moved the profile, if any. */
  readonly updatedBySignal: string | null;
}

// ---------------------------------------------------------------------------
// Defaults — the uniform prior we start from before any observation
// ---------------------------------------------------------------------------

/** Pseudo-count alpha used as the uniform Dirichlet prior. */
export const PRIOR_ALPHA = 1;

const uniformWeights = <T extends string>(
  values: ReadonlyArray<T>
): Record<T, number> =>
  Object.fromEntries(values.map((v) => [v, PRIOR_ALPHA])) as Record<T, number>;

const VERBOSITY_VALUES = VerbositySchema.options;
const DETAIL_VALUES = DetailSchema.options;
const LANGUAGE_VALUES = LanguagePreferenceSchema.options;
const FORMALITY_VALUES = FormalitySchema.options;
const POSTURE_VALUES = PostureSchema.options;

export function defaultDimension<T extends string>(
  values: ReadonlyArray<T>,
  initial: T
): { value: T; weights: Record<T, number>; confidence: number } {
  return {
    value: initial,
    weights: uniformWeights(values),
    confidence: 1 / values.length,
  };
}

/**
 * A neutral starting profile for a brand-new owner. The headline value of each
 * dimension is the middle-of-the-road default; confidence is at the floor
 * (1 / n_categories). Language defaults to `en` per the CLAUDE.md hard rule.
 */
export function makeDefaultProfile(args: {
  readonly tenantId: string;
  readonly now?: () => string;
}): OwnerStyleProfile {
  const now = (args.now ?? (() => new Date().toISOString()))();
  return {
    tenantId: args.tenantId,
    verbosity: defaultDimension(VERBOSITY_VALUES, 'balanced'),
    detail: defaultDimension(DETAIL_VALUES, 'medium'),
    language: defaultDimension(LANGUAGE_VALUES, 'en'),
    formality: defaultDimension(FORMALITY_VALUES, 'neutral'),
    posture: defaultDimension(POSTURE_VALUES, 'balanced'),
    lastUpdatedAt: now,
    feedbackCount: 0,
    confidence: 1 / VERBOSITY_VALUES.length,
    updatedBySignal: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers used by the profiler and adapters
// ---------------------------------------------------------------------------

export const DIMENSION_KEYS = [
  'verbosity',
  'detail',
  'language',
  'formality',
  'posture',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const CATEGORY_VALUES: Record<DimensionKey, ReadonlyArray<string>> = {
  verbosity: VERBOSITY_VALUES,
  detail: DETAIL_VALUES,
  language: LANGUAGE_VALUES,
  formality: FORMALITY_VALUES,
  posture: POSTURE_VALUES,
};
