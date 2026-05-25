/**
 * Plan-and-Solve+ — shared types.
 *
 * Implements Wang ACL 2023 (https://arxiv.org/abs/2305.04091) plus the
 * "Extract Variables" step from PS+. The MD system-prompt skeleton is
 * deterministic and small; the per-task config sets the strictness of
 * the variable-extraction step.
 */

/**
 * How strictly the wrapper enforces the variable-extraction step.
 *
 *   - 'lenient'      : variables may be missing; the MD proceeds with
 *                      whatever it could extract.
 *   - 'strict'       : missing variables are emitted as `<UNKNOWN>` in
 *                      the variable list and the MD MUST flag this in
 *                      the plan before solving.
 *   - 'all-or-fail'  : if ANY required variable is missing, the MD must
 *                      stop and ask the user / tool the missing value
 *                      before proceeding to step 3.
 */
export type ExtractionStrictness = 'lenient' | 'strict' | 'all-or-fail';

export interface PlanAndSolveConfig {
  /** Strictness of the Extract Variables step. Defaults to 'strict'. */
  readonly extractionStrictness?: ExtractionStrictness;
  /**
   * Required variable names for THIS task. If non-empty the MD must
   * list each in the Extract step and surface any that remain unknown.
   */
  readonly requiredVariables?: ReadonlyArray<string>;
  /**
   * Optional additional instructions appended after the canonical
   * skeleton — e.g. jurisdiction-specific reminders.
   */
  readonly addendum?: string;
}
