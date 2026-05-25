// buildPlan — pure constructor + total derivation.

import type { Plan, PlanStep, Task } from './types.js'

/**
 * Sums step costs and durations. Pure; no mutation.
 */
export function deriveTotals(
  steps: readonly PlanStep[]
): Pick<Plan, 'totalEstimatedCostUsd' | 'totalEstimatedDurationMs'> {
  let totalEstimatedCostUsd = 0
  let totalEstimatedDurationMs = 0
  for (const s of steps) {
    totalEstimatedCostUsd += s.estimatedCostUsd
    totalEstimatedDurationMs += s.estimatedDurationMs
  }
  return { totalEstimatedCostUsd, totalEstimatedDurationMs }
}

/**
 * Builds a Plan from a Task. Pure.
 *
 * Step IDs default to `${prefix ?? task.id}#${index}` so identifiers are
 * stable across invocations with the same input.
 */
export function buildPlan(task: Task): Plan {
  const prefix = task.stepIdPrefix ?? task.id
  const steps: readonly PlanStep[] = task.steps.map((s, i) => ({
    stepId: `${prefix}#${i}`,
    description: s.description,
    estimatedCostUsd: s.estimatedCostUsd,
    estimatedDurationMs: s.estimatedDurationMs
  }))
  return {
    id: task.id,
    steps,
    ...deriveTotals(steps)
  }
}
