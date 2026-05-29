/**
 * Plan-DAG — CE-2 multi-turn orchestrator data model.
 *
 * Companion to
 * `Docs/research/CHAT_HANDLES_EVERYTHING_SOTA_2026-05-29.md` §4.1.
 *
 * A `PlanDag` is the canonical representation of a multi-step chat
 * intent: a topologically-sorted list of `PlanStep`s plus the edges
 * that wire them together. The brain produces a plan; the user
 * reviews it as a `<plan_preview>` inline block; the user taps Run;
 * the runner walks the steps in topological order, pausing at every
 * `humanCheckpoint` for confirmation.
 *
 * Frontier reference: Manus AI Agent Mode generates a plan-with-
 * dependencies graph users can review before execution; this module
 * is the canonical Borjie analogue.
 *
 * Discipline:
 *   - Pure data + pure functions only. No I/O.
 *   - Immutable construction (`coding-style.md` immutability rule).
 *   - Zod-validated boundaries for runtime validation (`patterns.md`
 *     input validation rule).
 *   - Function bodies <50 lines, nesting <4 levels.
 */

import { z } from 'zod';

/** Risk tier — drives the human-checkpoint default per CE-4. */
export const riskTierSchema = z.enum(['low', 'medium', 'high']);
export type RiskTier = z.infer<typeof riskTierSchema>;

/** Human-checkpoint kind. */
export const humanCheckpointSchema = z.enum([
  /** Show preview only — autoproceeds after `previewTtlMs`. */
  'preview',
  /** Single-tap confirm required. */
  'confirm',
  /** Two-tap confirm required (HIGH stakes irreversibles). */
  'two-tap',
]);
export type HumanCheckpoint = z.infer<typeof humanCheckpointSchema>;

/**
 * A single step in the plan. `toolId` MUST exist in the brain-tool
 * catalog (`services/api-gateway/src/composition/brain-tools/`).
 * `input` is the payload validated against that tool's
 * `inputSchema`.
 */
export const planStepSchema = z
  .object({
    id: z.string().min(1).max(64),
    toolId: z.string().min(1).max(120),
    /** Free-form payload — validated downstream by tool's inputSchema. */
    input: z.unknown(),
    riskTier: riskTierSchema,
    evidenceIds: z.array(z.string().min(1).max(120)).max(20),
    humanCheckpoint: humanCheckpointSchema.optional(),
    /** Short bilingual label rendered in the <plan_preview> block. */
    labelEn: z.string().min(1).max(160),
    labelSw: z.string().min(1).max(160),
  })
  .strict();
export type PlanStep = z.infer<typeof planStepSchema>;

/** Directed edge — `from` must complete before `to` may start. */
export const planEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
  })
  .strict();
export type PlanEdge = z.infer<typeof planEdgeSchema>;

export const planDagSchema = z
  .object({
    planId: z.string().min(1).max(120),
    intent: z.string().min(1).max(2000),
    steps: z.array(planStepSchema).min(1).max(30),
    edges: z.array(planEdgeSchema).max(60),
    /** Optional plan-level evidence shared by every step. */
    sharedEvidenceIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  })
  .strict();
export type PlanDag = z.infer<typeof planDagSchema>;

/** Per-step execution state. */
export const planStepStateSchema = z.enum([
  'pending',
  'awaiting-confirmation',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
export type PlanStepState = z.infer<typeof planStepStateSchema>;

export interface PlanRunSnapshot {
  readonly planId: string;
  readonly steps: ReadonlyArray<{
    readonly id: string;
    readonly state: PlanStepState;
    readonly result?: unknown;
    readonly error?: string;
  }>;
  readonly status: 'idle' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
}

/**
 * Validate the plan's edge set against the step set. Returns an
 * array of validation problems; empty array = valid.
 *
 * Pure function. Caller decides whether to throw or surface to UI.
 */
export function validatePlanEdges(plan: PlanDag): ReadonlyArray<string> {
  const stepIds = new Set(plan.steps.map((s) => s.id));
  const problems: string[] = [];
  for (const edge of plan.edges) {
    if (edge.from === edge.to) {
      problems.push(`self-loop on step ${edge.from}`);
    }
    if (!stepIds.has(edge.from)) {
      problems.push(`edge.from references missing step ${edge.from}`);
    }
    if (!stepIds.has(edge.to)) {
      problems.push(`edge.to references missing step ${edge.to}`);
    }
  }
  if (hasCycle(plan)) {
    problems.push('plan contains a cycle — DAGs must be acyclic');
  }
  return Object.freeze(problems);
}

/**
 * Topologically sort the steps. Throws if the plan is invalid.
 * Stable across runs — uses step id as tiebreak so the rendered
 * `<plan_preview>` ordering is deterministic.
 */
export function topologicalOrder(plan: PlanDag): ReadonlyArray<PlanStep> {
  const problems = validatePlanEdges(plan);
  if (problems.length > 0) {
    throw new Error(`invalid plan: ${problems.join('; ')}`);
  }
  const indegree = new Map<string, number>();
  for (const step of plan.steps) {
    indegree.set(step.id, 0);
  }
  for (const edge of plan.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const stepById = new Map(plan.steps.map((s) => [s.id, s] as const));
  const ready: string[] = [];
  for (const [id, n] of indegree.entries()) {
    if (n === 0) ready.push(id);
  }
  ready.sort();
  const out: PlanStep[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(stepById.get(id)!);
    for (const edge of plan.edges) {
      if (edge.from !== id) continue;
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) {
        // Insert preserving sort.
        const ins = sortedInsertIndex(ready, edge.to);
        ready.splice(ins, 0, edge.to);
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Apply the risk-tier policy — every step's `humanCheckpoint` is
 * filled in from the risk tier if not explicitly set. Returns a NEW
 * PlanDag (immutability).
 *
 * Mapping (per CE-4 risk tier table in the SOTA doc):
 *   low    → no checkpoint (autonomous)
 *   medium → 'preview'
 *   high   → 'two-tap'
 */
export function applyRiskTierPolicy(plan: PlanDag): PlanDag {
  const steps = plan.steps.map((step) => {
    if (step.humanCheckpoint !== undefined) return step;
    const cp = defaultCheckpointFor(step.riskTier);
    if (cp === undefined) return step;
    return { ...step, humanCheckpoint: cp };
  });
  return { ...plan, steps };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function hasCycle(plan: PlanDag): boolean {
  const adj = new Map<string, ReadonlyArray<string>>();
  for (const step of plan.steps) adj.set(step.id, []);
  for (const edge of plan.edges) {
    const cur = adj.get(edge.from) ?? [];
    adj.set(edge.from, [...cur, edge.to]);
  }
  const seen = new Set<string>();
  const stack = new Set<string>();
  for (const step of plan.steps) {
    if (dfsHasCycle(step.id, adj, seen, stack)) return true;
  }
  return false;
}

function dfsHasCycle(
  id: string,
  adj: Map<string, ReadonlyArray<string>>,
  seen: Set<string>,
  stack: Set<string>,
): boolean {
  if (stack.has(id)) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  stack.add(id);
  for (const next of adj.get(id) ?? []) {
    if (dfsHasCycle(next, adj, seen, stack)) return true;
  }
  stack.delete(id);
  return false;
}

function sortedInsertIndex(sorted: ReadonlyArray<string>, value: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function defaultCheckpointFor(tier: RiskTier): HumanCheckpoint | undefined {
  if (tier === 'low') return undefined;
  if (tier === 'medium') return 'preview';
  return 'two-tap';
}
