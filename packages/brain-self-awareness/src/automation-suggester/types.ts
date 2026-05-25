// Automation Suggester — types

/**
 * Minimal decision-event shape this module consumes. Kept structurally
 * compatible with `DecisionEvent` from `decision-provenance` so callers can
 * pass the same objects in without conversion.
 */
export interface DecisionEventForAnalysis {
  readonly actionKind: string
  readonly createdAt: string
  readonly inputs?: Readonly<Record<string, unknown>>
}

/**
 * A sample invocation captured as a hint for the skill author.
 */
export interface SampleInvocation {
  readonly when: string
  readonly inputs: Readonly<Record<string, unknown>>
}

/**
 * A suggestion to add a new skill to the brain's repertoire.
 */
export interface SkillSuggestion {
  readonly name: string
  readonly description: string
  readonly when_to_use: string
  readonly sampleInvocations: readonly SampleInvocation[]
}

/**
 * Inputs to `analyzePatterns`.
 *
 * - `since` is an ISO timestamp; events with `createdAt < since` are ignored.
 * - `threshold` is the minimum count to emit a suggestion. Default = 5.
 * - `maxSamples` caps how many sample invocations are captured. Default = 3.
 */
export interface AnalyzePatternsInput {
  readonly decisionEvents: readonly DecisionEventForAnalysis[]
  readonly since: string
  readonly threshold?: number
  readonly maxSamples?: number
}

/**
 * Default threshold. Exposed so other modules / tests can reference it
 * without magic numbers.
 */
export const DEFAULT_SUGGESTION_THRESHOLD = 5
export const DEFAULT_MAX_SAMPLES = 3
