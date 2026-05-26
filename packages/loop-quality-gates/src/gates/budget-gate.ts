/**
 * Budget gate — Layer 4 gate #5.
 *
 * "Does the loop have ε-budget remaining to proceed?" The gate
 * compares the remaining budget (in USD cents, wall-clock ms, and
 * tool calls) against the proposed action's incremental cost. The
 * loop fails the gate if any axis would dip below the configured
 * floor.
 *
 * Three independent axes, each with a `min` floor:
 *
 *   1. usd_cents       — LLM / tool dollar budget.
 *   2. wall_clock_ms   — overall deadline for the loop.
 *   3. tool_invocations — number of remaining tool calls.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4 #5.
 */

import {
  DEFAULT_SIGNAL_WEIGHT,
  QualityGateError,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export interface BudgetAxis {
  /** Current remaining budget on this axis. */
  readonly remaining: number;
  /** Incremental cost the proposed action would consume. */
  readonly incremental: number;
  /** Minimum allowed after the action (default 0). */
  readonly min?: number;
}

export interface BudgetInput {
  readonly usdCents?: BudgetAxis;
  readonly wallClockMs?: BudgetAxis;
  readonly toolInvocations?: BudgetAxis;
}

const SIGNAL_NAME = 'budget';

function makeSignal(
  score: number,
  evidence: Readonly<Record<string, unknown>>,
): QualitySignal {
  return Object.freeze({
    signal: SIGNAL_NAME,
    score,
    weight: DEFAULT_SIGNAL_WEIGHT,
    evidence,
  });
}

function checkAxis(
  axis: BudgetAxis | undefined,
  name: string,
): { pass: boolean; reason: string; remainingAfter: number | null } {
  if (!axis) return { pass: true, reason: `${name}:unset`, remainingAfter: null };
  if (axis.remaining < 0) {
    throw new QualityGateError(
      `${name}.remaining must be non-negative, got ${axis.remaining}`,
      'INVALID_INPUT',
    );
  }
  if (axis.incremental < 0) {
    throw new QualityGateError(
      `${name}.incremental must be non-negative, got ${axis.incremental}`,
      'INVALID_INPUT',
    );
  }
  const min = axis.min ?? 0;
  const after = axis.remaining - axis.incremental;
  const pass = after >= min;
  return {
    pass,
    reason: pass
      ? `${name}:remaining-after-${after}-min-${min}`
      : `${name}:underflow-${after}-min-${min}`,
    remainingAfter: after,
  };
}

export function budgetGate(input: BudgetInput): QualityGateResult {
  if (!input) {
    throw new QualityGateError(
      'budget gate received null input',
      'INVALID_INPUT',
    );
  }

  const usd = checkAxis(input.usdCents, 'usdCents');
  const wall = checkAxis(input.wallClockMs, 'wallClockMs');
  const tools = checkAxis(input.toolInvocations, 'toolInvocations');

  const failedAxes: string[] = [];
  if (!usd.pass) failedAxes.push('usdCents');
  if (!wall.pass) failedAxes.push('wallClockMs');
  if (!tools.pass) failedAxes.push('toolInvocations');

  const evidence = Object.freeze({
    usdCents: usd,
    wallClockMs: wall,
    toolInvocations: tools,
    failedAxes: Object.freeze([...failedAxes]),
  });

  if (failedAxes.length === 0) {
    return Object.freeze({
      pass: true,
      signal: makeSignal(1.0, evidence),
      reason: 'pass:all-axes-have-headroom',
    });
  }

  return Object.freeze({
    pass: false,
    signal: makeSignal(0.0, evidence),
    reason: `fail:axes-${failedAxes.join(',')}`,
  });
}
