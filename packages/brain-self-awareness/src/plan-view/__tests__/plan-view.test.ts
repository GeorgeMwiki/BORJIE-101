// Plan View — unit tests (6 fixtures + edge cases).

import { describe, expect, it } from 'vitest'
import {
  applyPlanEdit,
  buildPlan,
  deriveTotals,
  type Plan,
  type PlanStep,
  type Task
} from '../index.js'

const TASK_A: Task = {
  id: 'task-a',
  steps: [
    { description: 'Fetch tenant', estimatedCostUsd: 0.01, estimatedDurationMs: 200 },
    { description: 'Draft reply', estimatedCostUsd: 0.05, estimatedDurationMs: 800 },
    { description: 'Send email', estimatedCostUsd: 0.001, estimatedDurationMs: 300 }
  ]
}

const NEW_STEP: PlanStep = {
  stepId: 'task-a#extra',
  description: 'Attach lease PDF',
  estimatedCostUsd: 0.02,
  estimatedDurationMs: 400
}

describe('buildPlan', () => {
  it('fixture #1: derives totals correctly for a 3-step plan', () => {
    const plan = buildPlan(TASK_A)
    expect(plan.steps).toHaveLength(3)
    expect(plan.totalEstimatedCostUsd).toBeCloseTo(0.061, 6)
    expect(plan.totalEstimatedDurationMs).toBe(1300)
  })

  it('fixture #2: assigns deterministic step IDs', () => {
    const plan = buildPlan(TASK_A)
    expect(plan.steps[0]!.stepId).toBe('task-a#0')
    expect(plan.steps[1]!.stepId).toBe('task-a#1')
    expect(plan.steps[2]!.stepId).toBe('task-a#2')
  })

  it('fixture #3: empty steps -> zero totals, no error', () => {
    const plan = buildPlan({ id: 'empty', steps: [] })
    expect(plan.steps).toEqual([])
    expect(plan.totalEstimatedCostUsd).toBe(0)
    expect(plan.totalEstimatedDurationMs).toBe(0)
  })

  it('honours stepIdPrefix override', () => {
    const plan = buildPlan({ ...TASK_A, stepIdPrefix: 'P' })
    expect(plan.steps[0]!.stepId).toBe('P#0')
  })

  it('deriveTotals is a pure helper', () => {
    const totals = deriveTotals([
      { stepId: 'a', description: '', estimatedCostUsd: 1, estimatedDurationMs: 10 },
      { stepId: 'b', description: '', estimatedCostUsd: 2, estimatedDurationMs: 20 }
    ])
    expect(totals).toEqual({
      totalEstimatedCostUsd: 3,
      totalEstimatedDurationMs: 30
    })
  })
})

describe('applyPlanEdit', () => {
  function baselinePlan(): Plan {
    return buildPlan(TASK_A)
  }

  it('fixture #4: add-step appends and updates totals', () => {
    const plan = applyPlanEdit(baselinePlan(), { op: 'add-step', step: NEW_STEP })
    expect(plan.steps).toHaveLength(4)
    expect(plan.steps.at(-1)).toEqual(NEW_STEP)
    expect(plan.totalEstimatedCostUsd).toBeCloseTo(0.081, 6)
    expect(plan.totalEstimatedDurationMs).toBe(1700)
  })

  it('add-step at atIndex=0 inserts at head', () => {
    const plan = applyPlanEdit(baselinePlan(), {
      op: 'add-step',
      step: NEW_STEP,
      atIndex: 0
    })
    expect(plan.steps[0]).toEqual(NEW_STEP)
  })

  it('add-step with out-of-range atIndex clamps to end', () => {
    const plan = applyPlanEdit(baselinePlan(), {
      op: 'add-step',
      step: NEW_STEP,
      atIndex: 999
    })
    expect(plan.steps.at(-1)).toEqual(NEW_STEP)
  })

  it('fixture #5: remove-step deletes and updates totals', () => {
    const plan = applyPlanEdit(baselinePlan(), {
      op: 'remove-step',
      stepId: 'task-a#1'
    })
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps.find((s) => s.stepId === 'task-a#1')).toBeUndefined()
    expect(plan.totalEstimatedCostUsd).toBeCloseTo(0.011, 6)
  })

  it('remove-step with unknown id returns SAME plan reference', () => {
    const before = baselinePlan()
    const after = applyPlanEdit(before, {
      op: 'remove-step',
      stepId: 'nope'
    })
    expect(after).toBe(before)
  })

  it('fixture #6: update-step patches fields and recomputes totals', () => {
    const plan = applyPlanEdit(baselinePlan(), {
      op: 'update-step',
      stepId: 'task-a#1',
      patch: { estimatedCostUsd: 0.5 }
    })
    expect(plan.steps[1]!.estimatedCostUsd).toBe(0.5)
    expect(plan.steps[1]!.estimatedDurationMs).toBe(800)
    expect(plan.totalEstimatedCostUsd).toBeCloseTo(0.511, 6)
  })

  it('update-step with unknown id returns SAME plan reference', () => {
    const before = baselinePlan()
    const after = applyPlanEdit(before, {
      op: 'update-step',
      stepId: 'nope',
      patch: { estimatedCostUsd: 999 }
    })
    expect(after).toBe(before)
  })

  it('reorder moves step to target index', () => {
    const plan = applyPlanEdit(baselinePlan(), {
      op: 'reorder',
      stepId: 'task-a#2',
      toIndex: 0
    })
    expect(plan.steps[0]!.stepId).toBe('task-a#2')
    expect(plan.steps[1]!.stepId).toBe('task-a#0')
    expect(plan.steps[2]!.stepId).toBe('task-a#1')
    // Totals unchanged by reorder
    expect(plan.totalEstimatedCostUsd).toBeCloseTo(0.061, 6)
  })

  it('reorder with unknown id returns SAME plan reference', () => {
    const before = baselinePlan()
    const after = applyPlanEdit(before, {
      op: 'reorder',
      stepId: 'nope',
      toIndex: 0
    })
    expect(after).toBe(before)
  })

  it('immutability: applyPlanEdit never mutates input', () => {
    const before = baselinePlan()
    const stepsRef = before.steps
    applyPlanEdit(before, { op: 'add-step', step: NEW_STEP })
    expect(before.steps).toBe(stepsRef)
    expect(before.steps).toHaveLength(3)
  })
})
