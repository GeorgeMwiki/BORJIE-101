/**
 * Plan-and-Execute (LangGraph 0.5, 2026) — separates PLANNING from
 * EXECUTION so the planner can use a powerful model and the executor
 * can use cheap workers. Beats sequential ReAct on cross-tool
 * benchmarks (cf. n1n.ai 2026: 92% completion, 3.6× speedup).
 *
 * Flow:
 *   1. planner.plan(task)  -> Plan { steps }
 *   2. for each step (respecting deps): executor.execute(step)
 *   3. compose final answer
 *
 * The planner and executor are typed PORTS so callers can wire any
 * implementation (LLM-driven, deterministic, hybrid).
 */

import type {
  ExecutionResult,
  ExecutionTraceEntry,
  Plan,
  Step,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage } from '../types.js';
import {
  action,
  finalEntry,
  makeExecutionResult,
  observation,
  planEntry,
} from '../internal/trace.js';

export interface StepExecutionResult {
  readonly stepId: string;
  readonly ok: boolean;
  readonly output: unknown;
  readonly error?: string;
  readonly usage?: TokenUsage;
}

export interface Planner {
  plan(task: Task): Promise<{ plan: Plan; usage?: TokenUsage }>;
}

export interface Executor {
  execute(step: Step, planContext: Plan, priorResults: ReadonlyArray<StepExecutionResult>): Promise<StepExecutionResult>;
}

export interface Composer {
  compose(task: Task, plan: Plan, results: ReadonlyArray<StepExecutionResult>): Promise<{ answer: string; usage?: TokenUsage }>;
}

export interface RunPlanAndExecuteInput {
  readonly task: Task;
  readonly planner: Planner;
  readonly executor: Executor;
  readonly composer: Composer;
  /** Bound on how many total steps are tolerable. */
  readonly maxSteps?: number;
}

export const DEFAULT_PLAN_EXECUTE_MAX_STEPS = 32;

export async function runPlanAndExecute(input: RunPlanAndExecuteInput): Promise<ExecutionResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_PLAN_EXECUTE_MAX_STEPS;
  const trace: ExecutionTraceEntry[] = [];
  let usage: TokenUsage = emptyUsage();
  let brainCalls = 0;

  // 1. Plan
  const { plan, usage: plannerUsage } = await input.planner.plan(input.task);
  brainCalls += 1;
  if (plannerUsage) usage = addUsage(usage, plannerUsage);
  trace.push(planEntry(`plan ${plan.id}: ${plan.steps.length} step(s)`));

  if (plan.steps.length === 0) {
    const composed = await input.composer.compose(input.task, plan, []);
    if (composed.usage) usage = addUsage(usage, composed.usage);
    trace.push(finalEntry(composed.answer));
    return finish(trace, composed.answer, usage, brainCalls + 1, 'success');
  }

  if (plan.steps.length > maxSteps) {
    return finish(
      trace,
      '',
      usage,
      brainCalls,
      'failed',
      `planner produced ${plan.steps.length} steps > maxSteps ${maxSteps}`,
    );
  }

  // 2. Topological execution respecting dependsOn edges.
  const stepById = new Map<string, Step>(plan.steps.map((s) => [s.id, s]));
  const completed = new Set<string>();
  const results: StepExecutionResult[] = [];

  // Safety: detect impossible deps.
  const order = topologicalOrder(plan.steps);
  if (!order.ok) {
    return finish(trace, '', usage, brainCalls, 'failed', `plan has dependency cycle: ${order.detail}`);
  }

  for (const stepId of order.order) {
    const step = stepById.get(stepId);
    if (!step) continue;
    // Verify deps satisfied.
    const missing = step.dependsOn.filter((d) => !completed.has(d));
    if (missing.length > 0) {
      return finish(
        trace,
        '',
        usage,
        brainCalls,
        'failed',
        `step ${stepId} missing deps: ${missing.join(', ')}`,
      );
    }
    trace.push(action(`exec ${step.id}: ${step.description}`));
    const result = await input.executor.execute(step, plan, results);
    if (result.usage) usage = addUsage(usage, result.usage);
    brainCalls += 1;
    results.push(result);
    trace.push(observation(result.ok ? `ok ${stringify(result.output)}` : `fail ${result.error ?? 'unknown error'}`));
    if (!result.ok) {
      // Hard-stop on first failure; callers using Reflexion can retry.
      return finish(trace, '', usage, brainCalls, 'failed', `step ${stepId} failed: ${result.error ?? 'unknown'}`);
    }
    completed.add(stepId);
  }

  // 3. Compose.
  const composed = await input.composer.compose(input.task, plan, results);
  brainCalls += 1;
  if (composed.usage) usage = addUsage(usage, composed.usage);
  trace.push(finalEntry(composed.answer));
  return finish(trace, composed.answer, usage, brainCalls, 'success');
}

function topologicalOrder(steps: ReadonlyArray<Step>):
  | { ok: true; order: ReadonlyArray<string> }
  | { ok: false; detail: string } {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.id, s.dependsOn.length);
    for (const d of s.dependsOn) {
      const list = adj.get(d) ?? [];
      list.push(s.id);
      adj.set(d, list);
    }
  }
  const ready: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) ready.push(id);
  }
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  if (order.length !== steps.length) {
    return { ok: false, detail: 'cycle detected or missing dependency' };
  }
  return { ok: true, order };
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function finish(
  trace: ReadonlyArray<ExecutionTraceEntry>,
  answer: string,
  usage: TokenUsage,
  brainCalls: number,
  outcome: ExecutionResult['outcome'],
  reason?: string,
): ExecutionResult {
  return reason !== undefined
    ? makeExecutionResult({ outcome, answer, trace, usage, brainCalls, reason })
    : makeExecutionResult({ outcome, answer, trace, usage, brainCalls });
}
