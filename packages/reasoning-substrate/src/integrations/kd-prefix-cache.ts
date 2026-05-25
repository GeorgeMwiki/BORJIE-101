/**
 * Integration shim — K-D prefix-cache.
 *
 * K-D is BORJIE's already-shipped three-tier memory substrate
 * (Context / Core / TemporalKG / Reflection). The prefix-cache is the
 * Anthropic prompt-cache layer that sits in front of every MD call:
 * static prefix bytes (system prompt + reasoning structure) become
 * cache-eligible chunks that bill at the 0.1× read rate.
 *
 * This shim turns a discovered `ReasoningStructure` into a stable,
 * cache-friendly prefix string that the api-gateway composition root
 * concatenates with the per-turn dynamic content. Determinism is the
 * whole point — if the prefix bytes vary across calls for the same
 * task_class, K-D's prefix cache misses and the savings evaporate.
 *
 * The shim is pure — it imports nothing from `@borjie/central-
 * intelligence` so the reasoning-substrate stays import-safe. The
 * api-gateway composition root is the only place that bridges the two.
 */

import { planAndSolveSkeleton } from '../plan-and-solve/wrap-with-plan-and-solve.js';
import type { PlanAndSolveConfig } from '../plan-and-solve/types.js';
import type { ReasoningStructure } from '../self-discover/types.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface BuildPrefixArgs {
  /** The discovered reasoning structure (cached in TemporalKG). */
  readonly structure: ReasoningStructure;
  /**
   * Optional Plan-and-Solve+ config. Defaults to strict variable
   * extraction with no required variables — the structure's steps
   * already enumerate the variables, but callers can override.
   */
  readonly planAndSolveConfig?: PlanAndSolveConfig;
  /** Optional caller voice / branding to prepend. */
  readonly callerVoice?: string;
}

/**
 * Build the static prefix string that goes into the system prompt.
 * The structure is rendered as a compact JSON block so Claude can
 * parse the DAG; the Plan-and-Solve+ skeleton sits below it.
 *
 * Determinism guarantees:
 *   - same `structureId` + same `planAndSolveConfig` + same
 *     `callerVoice` → byte-identical output.
 *   - The discoveredAt timestamp is OMITTED from the prefix (it
 *     varies between cache writes; including it would defeat the
 *     prefix cache).
 *   - All keys are emitted in sorted order so JSON.stringify is
 *     stable across engines.
 */
export function buildReasoningPrefix(args: BuildPrefixArgs): string {
  const lines: string[] = [];
  const voice = (args.callerVoice ?? '').trim();
  if (voice) {
    lines.push(voice);
    lines.push('');
  }
  lines.push('## Cached reasoning structure');
  lines.push(`Task class: ${args.structure.taskClass}`);
  lines.push(`Jurisdiction: ${args.structure.jurisdiction}`);
  lines.push(`Structure id: ${args.structure.structureId}`);
  lines.push('');
  lines.push('Adapted narrative:');
  lines.push(args.structure.adaptedNarrative);
  lines.push('');
  lines.push('Steps (JSON):');
  lines.push(stableStringify(args.structure.steps));
  lines.push('');
  lines.push(planAndSolveSkeleton(args.planAndSolveConfig ?? {}));
  return lines.join('\n');
}

/**
 * Stable JSON stringify — sorts object keys recursively to guarantee
 * byte-identical output for byte-identical input. Required for prefix
 * cache hit rate.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(v).sort();
      for (const k of keys) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  }, 2);
}
