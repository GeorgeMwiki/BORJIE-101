/**
 * wrapWithPlanAndSolve — decorate any sub-MD's system prompt with the
 * Plan-and-Solve+ skeleton.
 *
 * The skeleton is deliberately short and stable so prefix-caching
 * (K-D) achieves a 100% cache hit on the wrapping bytes for every
 * MD task class. The variable-extraction step is the "+" in PS+ — it
 * meaningfully closes "missing step" errors per the Wang ACL 2023
 * paper.
 *
 * Usage:
 *
 *   const sysPrompt = wrapWithPlanAndSolve(
 *     'You are BORJIE MD. Tone: firm but non-threatening.',
 *     {
 *       extractionStrictness: 'all-or-fail',
 *       requiredVariables: ['tenantId', 'leaseId', 'jurisdiction', 'unpaidAmount'],
 *     },
 *   );
 */

import type { ExtractionStrictness, PlanAndSolveConfig } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Canonical skeleton — these strings are part of the prefix-cache
// boundary. Changing them invalidates K-D's cache for every MD task
// class. Do not edit casually.
// ─────────────────────────────────────────────────────────────────────

const SKELETON_HEADER =
  '## Plan-and-Solve+ reasoning protocol\n' +
  'Before answering, ALWAYS work through these four steps in order:\n';

const STEP_1 =
  'Step 1 — Plan. Enumerate the steps you will take as a numbered list. Be exhaustive; ' +
  'each step should be one concrete action (read a record, apply a rule, compute a quantity, ' +
  'draft a clause). Do not solve yet.';

const STEP_2_BASE =
  'Step 2 — Extract variables. List every variable / quantity / identifier needed to execute ' +
  'the plan. Use the form `name = <value or UNKNOWN>`. Include units (KES / TZS / days / %).';

const STEP_3 =
  'Step 3 — Solve. Execute the plan step by step, citing the variables from Step 2. ' +
  'When you must do arithmetic, show the formula and the substitution explicitly.';

const STEP_4 =
  'Step 4 — Reflect. Re-read your solution. State any assumption you made, any edge case ' +
  'you did not cover, and the confidence (0–1) you have in the final answer.';

function strictnessLine(s: ExtractionStrictness): string {
  switch (s) {
    case 'lenient':
      return 'You may proceed to Step 3 even if some variables remain UNKNOWN; flag them in Step 4.';
    case 'strict':
      return 'List UNKNOWN variables explicitly. In Step 3 mark each line that depends on an UNKNOWN as TENTATIVE.';
    case 'all-or-fail':
      return 'If ANY required variable is UNKNOWN, STOP at Step 2. Do not proceed to Step 3. Instead, request the missing value from the user or via a tool call.';
  }
}

function requiredVariablesLine(required: ReadonlyArray<string>): string {
  return `Required variables for this task: ${required.join(', ')}. Each must appear in Step 2.`;
}

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_EXTRACTION_STRICTNESS: ExtractionStrictness = 'strict';

/**
 * Returns the original `systemPrompt` augmented with the canonical
 * Plan-and-Solve+ skeleton plus any per-task configuration. Pure
 * function — no IO.
 *
 * The wrapper is appended AFTER the caller's prompt so the caller's
 * voice / branding stays at the top of the system prompt (closer to
 * the model's instruction-following bias).
 */
export function wrapWithPlanAndSolve(
  systemPrompt: string,
  config: PlanAndSolveConfig = {},
): string {
  const strictness = config.extractionStrictness ?? DEFAULT_EXTRACTION_STRICTNESS;
  const required = config.requiredVariables ?? [];
  const lines: string[] = [];
  const trimmedPrompt = (systemPrompt ?? '').trim();
  if (trimmedPrompt) {
    lines.push(trimmedPrompt);
    lines.push('');
  }
  lines.push(SKELETON_HEADER);
  lines.push(STEP_1);
  if (required.length > 0) {
    lines.push(`${STEP_2_BASE} ${requiredVariablesLine(required)}`);
  } else {
    lines.push(STEP_2_BASE);
  }
  lines.push(strictnessLine(strictness));
  lines.push(STEP_3);
  lines.push(STEP_4);
  const addendum = (config.addendum ?? '').trim();
  if (addendum) {
    lines.push('');
    lines.push(addendum);
  }
  return lines.join('\n');
}

/**
 * Returns just the canonical skeleton (without the caller's system
 * prompt), useful for tests that need to assert on the boundary text.
 */
export function planAndSolveSkeleton(
  config: PlanAndSolveConfig = {},
): string {
  return wrapWithPlanAndSolve('', config).trim();
}
