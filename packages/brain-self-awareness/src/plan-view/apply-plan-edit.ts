// applyPlanEdit — immutable reducer for plan edits.
// All branches must return a NEW Plan; never mutate `plan` or `plan.steps`.

import { deriveTotals } from './build-plan.js'
import type { Plan, PlanEdit, PlanStep } from './types.js'

function withTotals(plan: Pick<Plan, 'id' | 'steps'>): Plan {
  return {
    id: plan.id,
    steps: plan.steps,
    ...deriveTotals(plan.steps)
  }
}

function clampIndex(idx: number, len: number): number {
  if (idx < 0) return 0
  if (idx > len) return len
  return idx
}

/**
 * Returns a NEW Plan with the given edit applied.
 *
 * Unknown stepIds for remove/update/reorder are no-ops (returns the input
 * plan unchanged) — caller decides whether to throw upstream.
 */
export function applyPlanEdit(plan: Plan, edit: PlanEdit): Plan {
  switch (edit.op) {
    case 'add-step': {
      const at = clampIndex(edit.atIndex ?? plan.steps.length, plan.steps.length)
      const next: readonly PlanStep[] = [
        ...plan.steps.slice(0, at),
        edit.step,
        ...plan.steps.slice(at)
      ]
      return withTotals({ id: plan.id, steps: next })
    }
    case 'remove-step': {
      const next = plan.steps.filter((s) => s.stepId !== edit.stepId)
      if (next.length === plan.steps.length) return plan
      return withTotals({ id: plan.id, steps: next })
    }
    case 'update-step': {
      let touched = false
      const next: readonly PlanStep[] = plan.steps.map((s) => {
        if (s.stepId !== edit.stepId) return s
        touched = true
        return { ...s, ...edit.patch }
      })
      if (!touched) return plan
      return withTotals({ id: plan.id, steps: next })
    }
    case 'reorder': {
      const fromIdx = plan.steps.findIndex((s) => s.stepId === edit.stepId)
      if (fromIdx === -1) return plan
      const without = [
        ...plan.steps.slice(0, fromIdx),
        ...plan.steps.slice(fromIdx + 1)
      ]
      const target = clampIndex(edit.toIndex, without.length)
      const next: readonly PlanStep[] = [
        ...without.slice(0, target),
        plan.steps[fromIdx]!,
        ...without.slice(target)
      ]
      return withTotals({ id: plan.id, steps: next })
    }
  }
}
