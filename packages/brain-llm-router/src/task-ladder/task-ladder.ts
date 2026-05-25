/**
 * task-ladder/ — declarative per-task model preference.
 *
 * Each TaskKind maps to an ordered list of ModelTiers. The orchestrator
 * walks the ladder top-down: try first; on quality/cost/fallback miss,
 * try next. Per-tenant overrides allow VIP tenants to pin a specific
 * model or escalate earlier.
 *
 * Source of truth — research §8 + §6 (Pareto frontier):
 *   plan      -> Opus / Sonnet@Bedrock / GPT-5 Pro
 *   tool-use  -> Sonnet / Sonnet@Bedrock / GPT-5
 *   critic    -> Haiku / GPT-5-mini / Qwen-3-6+
 *   classify  -> Haiku / GPT-5-nano / MiniMax M2-7
 *   chat      -> Haiku / Sonnet / GPT-5            (cost-cascade target)
 *   longdoc   -> Gemini 3.1 Pro / Sonnet / GPT-5   (long-context strength)
 *   codegen   -> Sonnet / Opus / GPT-5             (Sonnet on SWE-bench frontier)
 *
 * Pure module: no I/O, no mutation. All exports are `Readonly<...>`.
 */

import type { ModelTier, TaskKind } from '../types.js';

/** Default ladder. Tenant overrides supersede per-task. */
export const TASK_LADDER: Readonly<Record<TaskKind, readonly ModelTier[]>> = Object.freeze({
  plan: Object.freeze([
    'anthropic/claude-opus-4-7',
    'anthropic/claude-sonnet-4-6@bedrock',
    'openai/gpt-5-pro',
  ]),
  'tool-use': Object.freeze([
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-sonnet-4-6@bedrock',
    'openai/gpt-5',
  ]),
  critic: Object.freeze([
    'anthropic/claude-haiku-4-5',
    'openai/gpt-5-mini',
    'vllm/qwen-3-6-plus',
  ]),
  classify: Object.freeze([
    'anthropic/claude-haiku-4-5',
    'openai/gpt-5-nano',
    'vllm/minimax-m2-7',
  ]),
  chat: Object.freeze([
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-5',
  ]),
  longdoc: Object.freeze([
    'google/gemini-3-1-pro',
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-5',
  ]),
  codegen: Object.freeze([
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-7',
    'openai/gpt-5',
  ]),
});

/** Per-tenant overrides (loaded from K-F BudgetMonitor / tenant config). */
export type TenantLadderOverride = Readonly<Partial<Record<TaskKind, readonly ModelTier[]>>>;

export type TenantLadderMap = Readonly<Record<string, TenantLadderOverride>>;

/**
 * Resolve the effective ladder for (task, tenant), preferring tenant override
 * when present. Always returns a defensively-copied frozen array — callers
 * can iterate without risk of mutation upstream.
 */
export function resolveLadder(
  task: TaskKind,
  tenantId: string,
  overrides: TenantLadderMap = {},
  callOverride?: readonly ModelTier[]
): readonly ModelTier[] {
  if (callOverride !== undefined && callOverride.length > 0) {
    return Object.freeze([...callOverride]);
  }
  const tenant = overrides[tenantId];
  if (tenant !== undefined) {
    const override = tenant[task];
    if (override !== undefined && override.length > 0) {
      return Object.freeze([...override]);
    }
  }
  const base = TASK_LADDER[task];
  return Object.freeze([...base]);
}

/**
 * Pure helper: return the model at depth `depth` in the resolved ladder,
 * or `undefined` if depth exceeds ladder length.
 */
export function selectAtDepth(
  task: TaskKind,
  tenantId: string,
  depth: number,
  overrides?: TenantLadderMap
): ModelTier | undefined {
  const ladder = resolveLadder(task, tenantId, overrides);
  return ladder[depth];
}

/** All supported task kinds (useful for iteration in eval suites). */
export const ALL_TASK_KINDS: readonly TaskKind[] = Object.freeze([
  'plan',
  'tool-use',
  'critic',
  'classify',
  'chat',
  'longdoc',
  'codegen',
]);
