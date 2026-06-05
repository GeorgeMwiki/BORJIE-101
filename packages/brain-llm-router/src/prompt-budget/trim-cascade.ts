/**
 * trim-cascade — fit prompt layers to a token budget, lowest priority first.
 *
 * Ported from LITFIN `prompt-budget.ts:fitToBudget` and extended with the
 * `droppedLayers` telemetry hook this package requires.
 *
 * Contract (CRITICAL — relied on by the brain hot path):
 *   - PURE: returns new arrays, never mutates the input.
 *   - NEVER THROWS: an unrealistically small budget keeps the single
 *     highest-priority layer rather than returning nothing.
 *   - DETERMINISTIC: stable ordering — higher `priority` wins; ties break by
 *     original input order (so prompt-cache prefixes stay stable).
 */

import { estimateTokens } from './estimate-tokens.js';
import type { PromptBudget } from './intent-limits.js';
import { emitPromptBudgetEvent } from './telemetry.js';

export interface PromptLayer {
  /** Stable layer name (used in telemetry + dropped list). */
  readonly name: string;
  /** Layer text. */
  readonly content: string;
  /** Higher = more important = kept first. */
  readonly priority: number;
}

export interface TrimResult {
  /** Layers that fit, in priority order (highest first). */
  readonly kept: readonly PromptLayer[];
  /** Names of dropped layers, lowest-priority first. */
  readonly dropped: readonly string[];
  /** Estimated tokens of the kept layers. */
  readonly tokens: number;
  /** True if the soft `warnTokens` threshold was crossed. */
  readonly overWarn: boolean;
}

/**
 * Sort layers highest-priority-first while preserving input order on ties.
 * Returns a new array; does not mutate the input.
 */
function sortByPriorityStable(layers: readonly PromptLayer[]): PromptLayer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => {
      if (b.layer.priority !== a.layer.priority) return b.layer.priority - a.layer.priority;
      return a.index - b.index; // stable: keep original order on ties
    })
    .map((x) => x.layer);
}

/**
 * Trim `layers` to fit `budget.maxTokens`, dropping lowest-priority layers
 * first. The single highest-priority layer is always kept even if it alone
 * blows the budget (we never return an empty prompt).
 *
 * Pure + never-throws. Pass `intent` to emit a telemetry event with the
 * `droppedLayers` signal; omit it to skip telemetry entirely.
 */
export function trimToBudget(
  layers: readonly PromptLayer[],
  budget: PromptBudget,
  intent?: string,
): TrimResult {
  const sorted = sortByPriorityStable(layers);
  const kept: PromptLayer[] = [];
  const dropped: string[] = [];
  let total = 0;

  for (const layer of sorted) {
    const tokens = estimateTokens(layer.content);
    // Keep the first (highest-priority) layer unconditionally; thereafter only
    // keep a layer if it still fits under the hard ceiling.
    if (kept.length > 0 && total + tokens > budget.maxTokens) {
      dropped.push(layer.name);
      continue;
    }
    kept.push(layer);
    total += tokens;
  }

  // `dropped` is built in descending-priority iteration order, so it already
  // lists higher-priority-among-dropped first; reverse to surface the
  // lowest-priority casualties first (most-droppable → least), which reads
  // more naturally in telemetry.
  const droppedLowestFirst = [...dropped].reverse();
  const overWarn = total > budget.warnTokens;

  if (intent !== undefined) {
    emitPromptBudgetEvent({
      intent,
      tokens: total,
      maxTokens: budget.maxTokens,
      warnTokens: budget.warnTokens,
      overWarn,
      trimmed: droppedLowestFirst.length > 0,
      droppedLayers: droppedLowestFirst,
      at: new Date().toISOString(),
    });
  }

  return {
    kept,
    dropped: droppedLowestFirst,
    tokens: total,
    overWarn,
  };
}
