// Plan View — types
// A plan = ordered steps with cost & duration estimates, surfaceable to operators.

/**
 * A single step within a plan.
 *
 * `stepId` is a stable identifier within the plan; it MUST be unique within
 * the plan's `steps` array. Cost is USD; duration is milliseconds.
 */
export interface PlanStep {
  readonly stepId: string
  readonly description: string
  readonly estimatedCostUsd: number
  readonly estimatedDurationMs: number
}

/**
 * A plan — a totalled bundle of steps for one task.
 *
 * Totals are derived from steps. `applyPlanEdit` re-derives them so callers
 * never have to keep them in sync.
 */
export interface Plan {
  readonly id: string
  readonly steps: readonly PlanStep[]
  readonly totalEstimatedCostUsd: number
  readonly totalEstimatedDurationMs: number
}

/**
 * Input task for `buildPlan`. Deliberately minimal — bigger fields can be
 * added later without breaking this signature.
 */
export interface Task {
  readonly id: string
  readonly steps: readonly Omit<PlanStep, 'stepId'>[]
  /**
   * Optional clock; used so step IDs in tests are deterministic. The default
   * generator uses an index suffix so identifiers are stable without it.
   */
  readonly stepIdPrefix?: string
}

/**
 * A plan-edit operation. Strict, exhaustive sum type so the reducer can be
 * total.
 */
export type PlanEdit =
  | { readonly op: 'add-step'; readonly step: PlanStep; readonly atIndex?: number }
  | { readonly op: 'remove-step'; readonly stepId: string }
  | {
      readonly op: 'update-step'
      readonly stepId: string
      readonly patch: Partial<Omit<PlanStep, 'stepId'>>
    }
  | {
      readonly op: 'reorder'
      readonly stepId: string
      readonly toIndex: number
    }
