/**
 * TeachingStyle — per-tenant configuration of Mr. Mwikila's Professor voice.
 *
 * Some tenants want a verbose mentor. Others want a terse consultant.
 * Some operate in Tanzania and want all examples localised; global
 * customers want neutral examples. This module captures those preferences
 * as a typed, immutable shape + pure helpers that compose the Professor
 * prompt layer.
 *
 * Storage / persistence of TeachingStyle belongs to the tenant-settings
 * service; this module is pure and has no DB coupling. Tenants pin their
 * preference once; the classroom + Professor persona respect it every turn.
 */

import { z } from 'zod';
import { logger } from '../../logger.js';

// -----------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------

export const VerbosityLevelSchema = z.enum(['terse', 'balanced', 'verbose']);
export type VerbosityLevel = z.infer<typeof VerbosityLevelSchema>;

export const ExamplesDensitySchema = z.enum(['low', 'medium', 'high']);
export type ExamplesDensity = z.infer<typeof ExamplesDensitySchema>;

export const SocraticQuestionRateSchema = z.enum(['low', 'medium', 'high']);
export type SocraticQuestionRate = z.infer<typeof SocraticQuestionRateSchema>;

export const CultureContextSchema = z.enum([
  'east-african',
  'neutral',
  'global',
]);
export type CultureContext = z.infer<typeof CultureContextSchema>;

export const TeachingStyleSchema = z.object({
  verbosity: VerbosityLevelSchema.default('balanced'),
  examplesDensity: ExamplesDensitySchema.default('medium'),
  socraticQuestionRate: SocraticQuestionRateSchema.default('medium'),
  cultureContext: CultureContextSchema.default('east-african'),
});
export type TeachingStyle = z.infer<typeof TeachingStyleSchema>;

export const DEFAULT_TEACHING_STYLE: TeachingStyle = Object.freeze({
  verbosity: 'balanced',
  examplesDensity: 'medium',
  socraticQuestionRate: 'medium',
  cultureContext: 'east-african',
});

// -----------------------------------------------------------------------
// Pure helpers — no mutation, return fresh objects/strings only.
// -----------------------------------------------------------------------

/**
 * Merge partial tenant preferences into a complete TeachingStyle.
 * Immutable: caller keeps ownership of the input object.
 */
export function resolveTeachingStyle(
  input: Partial<TeachingStyle> | undefined,
): TeachingStyle {
  return TeachingStyleSchema.parse({
    ...DEFAULT_TEACHING_STYLE,
    ...(input ?? {}),
  });
}

/**
 * Approximate hard word-budget per Professor turn. Professor prompt uses
 * this as a hint; it is advisory, not a hard truncation.
 */
export function verbosityWordBudget(verbosity: VerbosityLevel): number {
  switch (verbosity) {
    case 'terse':
      return 80;
    case 'balanced':
      return 220;
    case 'verbose':
      return 450;
  }
}

/** Numerical examples per concept-introducing turn. */
export function examplesPerConcept(density: ExamplesDensity): number {
  switch (density) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 4;
  }
}

/** Questions per statement, floor. */
export function socraticRatioFloor(rate: SocraticQuestionRate): number {
  switch (rate) {
    case 'low':
      return 0.5;
    case 'medium':
      return 1.0;
    case 'high':
      return 1.5;
  }
}

/**
 * Compose a small prompt addendum that pins the Professor persona to the
 * tenant's TeachingStyle. Spliced after PROFESSOR_PROMPT_LAYER at compose
 * time. Deterministic, no randomness.
 */
export function renderTeachingStyleAddendum(style: TeachingStyle): string {
  const culture = renderCulture(style.cultureContext);
  const wordBudget = verbosityWordBudget(style.verbosity);
  const examples = examplesPerConcept(style.examplesDensity);
  const qRatio = socraticRatioFloor(style.socraticQuestionRate);

  return `## TeachingStyle (tenant preference, respected every turn)

- Verbosity: ${style.verbosity} (soft word budget per turn: ${wordBudget}).
- Examples density: ${style.examplesDensity} (aim for ${examples} numeric example(s) per concept).
- Socratic question rate: ${style.socraticQuestionRate} (question-to-statement ratio floor: ${qRatio.toFixed(1)}).
- Culture context: ${style.cultureContext}.
${culture}

These preferences override general verbosity defaults. Rubric rules (Socratic discipline, Bloom's labelling, productive-struggle modality switch, teach-back close) are NOT negotiable and always apply.`;
}

function renderCulture(ctx: CultureContext): string {
  switch (ctx) {
    case 'east-african':
      return '- Currency: Ksh / Tsh. Rails: M-Pesa / Tigo-Pesa / Airtel Money. Neighbourhoods: Kilimani, Westlands, Lavington, Embakasi, Kinondoni, Mikocheni, Oyster Bay. Code-switch EN/SW naturally.';
    case 'neutral':
      return '- Currency: USD unless the learner uses another. No location-specific flavour; generic worked numerics.';
    case 'global':
      return '- Mirror the learner\'s region. Infer currency, rails, neighbourhoods from context; if unknown, ask before inventing.';
  }
}

/**
 * Parse a store row (possibly JSON-stringified) into a TeachingStyle.
 * Returns DEFAULT_TEACHING_STYLE on parse failure — the Professor must
 * never crash on bad tenant config.
 */
export function safeParseTeachingStyle(raw: unknown): TeachingStyle {
  try {
    if (typeof raw === 'string') {
      return TeachingStyleSchema.parse(JSON.parse(raw));
    }
    return TeachingStyleSchema.parse(raw);
  } catch (error) {
    logger.error('safeParseTeachingStyle: falling back to default', { error: error });
    return DEFAULT_TEACHING_STYLE;
  }
}
