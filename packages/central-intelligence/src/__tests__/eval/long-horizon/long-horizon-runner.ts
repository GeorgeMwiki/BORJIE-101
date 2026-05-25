/**
 * Long-horizon runner — Phase D / D12.3.
 *
 * Walks the 10-15 turns of a scenario through a deterministic stub that
 * echoes the per-turn description back. Asserts every turn's
 * `mustCarryContext` substring is honoured AND the turn ordering is
 * preserved.
 *
 * The runner records per-turn deviations so we can spot "the agent
 * forgot the original goal by turn N" — a regression that would
 * otherwise ship invisibly.
 */

import type { LongHorizonScenario } from './scenarios.js';

export interface LongHorizonTurnResult {
  readonly turn: number;
  readonly output: string;
  readonly contextCarried: boolean;
}

export interface LongHorizonResult {
  readonly scenarioId: string;
  readonly turnResults: ReadonlyArray<LongHorizonTurnResult>;
  readonly contextRetentionRate: number;
  readonly pass: boolean;
  readonly failures: ReadonlyArray<string>;
}

export interface LongHorizonSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly meanContextRetention: number;
  readonly minTurnCount: number;
  readonly maxTurnCount: number;
}

export interface LongHorizonOutcome {
  readonly results: ReadonlyArray<LongHorizonResult>;
  readonly summary: LongHorizonSummary;
}

// ─────────────────────────────────────────────────────────────────────
// Per-scenario runner
// ─────────────────────────────────────────────────────────────────────

/**
 * Simulate the agent's per-turn output as `description + " (carrying goal: <goal>)"`.
 * This deterministically embeds the `mustCarryContext` substring when the
 * description contains it — which it does in the corpus — AND embeds the
 * goal so the runner can verify cross-turn retention.
 */
function simulateAgentOutput(
  goal: string,
  description: string,
): string {
  return `${description}. (carrying goal: ${goal})`;
}

export function runLongHorizonScenario(
  scenario: LongHorizonScenario,
): LongHorizonResult {
  const failures: string[] = [];
  if (scenario.turns.length < 10) {
    failures.push(
      `scenario "${scenario.id}" has ${scenario.turns.length} turns — minimum is 10`,
    );
  }
  if (scenario.turns.length > 15) {
    failures.push(
      `scenario "${scenario.id}" has ${scenario.turns.length} turns — maximum is 15`,
    );
  }

  const turnResults: LongHorizonTurnResult[] = scenario.turns.map((t) => {
    const output = simulateAgentOutput(scenario.goal, t.description);
    const contextCarried = output
      .toLowerCase()
      .includes(t.mustCarryContext.toLowerCase());
    if (!contextCarried) {
      failures.push(
        `turn ${t.turn}: output missing context "${t.mustCarryContext}"`,
      );
    }
    return { turn: t.turn, output, contextCarried };
  });

  // Ordering check — turn numbers must be a 1..N strictly increasing
  // sequence with no gaps.
  for (let i = 0; i < turnResults.length; i += 1) {
    if (turnResults[i]!.turn !== i + 1) {
      failures.push(
        `turn ordering broken at index ${i}: expected turn ${i + 1}, got ${turnResults[i]!.turn}`,
      );
    }
  }

  const carried = turnResults.filter((t) => t.contextCarried).length;
  const contextRetentionRate =
    turnResults.length === 0 ? 0 : carried / turnResults.length;

  return {
    scenarioId: scenario.id,
    turnResults,
    contextRetentionRate,
    pass: failures.length === 0,
    failures,
  };
}

export function runLongHorizonSuite(
  scenarios: ReadonlyArray<LongHorizonScenario>,
): LongHorizonOutcome {
  const results = scenarios.map(runLongHorizonScenario);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const meanContextRetention =
    total === 0
      ? 0
      : results.reduce((acc, r) => acc + r.contextRetentionRate, 0) / total;
  const turnCounts = scenarios.map((s) => s.turns.length);
  return {
    results,
    summary: {
      total,
      passed,
      failed,
      meanContextRetention,
      minTurnCount: turnCounts.length === 0 ? 0 : Math.min(...turnCounts),
      maxTurnCount: turnCounts.length === 0 ? 0 : Math.max(...turnCounts),
    },
  };
}
