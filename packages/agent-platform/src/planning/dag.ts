/**
 * DAG validator + topological batcher.
 *
 * Pure functions. Given a `Plan`, returns either an ordered array of
 * batches (parallel-safe groups) or a structured error explaining
 * which dependency edge broke the contract.
 *
 * The batcher is greedy: every step whose deps are all satisfied lands
 * in the next batch. This minimises wall-clock without re-running any
 * step. For property-mgmt agents most plans are 5-30 steps, so the
 * O(steps^2) edge scan is irrelevant.
 */

import type { Plan, Step } from './types.js';

export interface DagValidationError {
  readonly kind: 'unknown-step' | 'cycle' | 'duplicate-step-id';
  readonly detail: string;
}

export type DagValidationResult =
  | { readonly ok: true; readonly batches: ReadonlyArray<ReadonlyArray<Step>> }
  | { readonly ok: false; readonly error: DagValidationError };

export function validatePlanDag(plan: Plan): DagValidationResult {
  // 1. Duplicate-id check.
  const stepIds = new Set<string>();
  for (const step of plan.steps) {
    if (stepIds.has(step.id)) {
      return {
        ok: false,
        error: { kind: 'duplicate-step-id', detail: `step id "${step.id}" appears twice` },
      };
    }
    stepIds.add(step.id);
  }

  // 2. Edge-validity check.
  for (const [from, to] of plan.deps) {
    if (!stepIds.has(from)) {
      return {
        ok: false,
        error: { kind: 'unknown-step', detail: `edge references unknown from-step "${from}"` },
      };
    }
    if (!stepIds.has(to)) {
      return {
        ok: false,
        error: { kind: 'unknown-step', detail: `edge references unknown to-step "${to}"` },
      };
    }
  }

  // 3. Build adjacency + in-degree.
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const step of plan.steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }
  for (const [from, to] of plan.deps) {
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // 4. Kahn's algorithm — produces batches level-by-level.
  const batches: Step[][] = [];
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  let remaining = new Set<string>(stepIds);

  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) ready.push(id);
    }
    if (ready.length === 0) {
      // Stuck → cycle.
      return {
        ok: false,
        error: {
          kind: 'cycle',
          detail: `dependency cycle among: ${[...remaining].join(', ')}`,
        },
      };
    }
    batches.push(ready.map((id) => byId.get(id)!));
    for (const id of ready) {
      for (const downstream of adjacency.get(id) ?? []) {
        inDegree.set(downstream, (inDegree.get(downstream) ?? 0) - 1);
      }
      remaining.delete(id);
    }
  }

  return { ok: true, batches };
}
