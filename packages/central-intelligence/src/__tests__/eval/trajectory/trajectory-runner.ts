/**
 * Trajectory runner — Phase D / D12.1.
 *
 * Computes the edit distance between each scenario's `proposedPath` and
 * `expectOptimalPath` (both arrays of tool names) and asserts the
 * deviation does not exceed `tolerance`. Returns per-scenario results
 * + aggregate summary (mean/max deviation, pass rate).
 *
 * Pure deterministic; no I/O.
 */

import type { TrajectoryScenario } from './scenarios.js';

export interface TrajectoryResult {
  readonly scenarioId: string;
  readonly category: TrajectoryScenario['category'];
  readonly deviation: number;
  readonly pass: boolean;
  readonly failures: ReadonlyArray<string>;
  readonly proposedLength: number;
  readonly optimalLength: number;
}

export interface TrajectorySummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly meanDeviation: number;
  readonly maxDeviation: number;
  readonly perCategoryPassRate: Readonly<
    Record<TrajectoryScenario['category'], number>
  >;
}

export interface TrajectoryOutcome {
  readonly results: ReadonlyArray<TrajectoryResult>;
  readonly summary: TrajectorySummary;
}

// ─────────────────────────────────────────────────────────────────────
// Levenshtein-style edit distance over a sequence of tool names.
// ─────────────────────────────────────────────────────────────────────

export function editDistance(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  const curr: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

// ─────────────────────────────────────────────────────────────────────
// Per-scenario + suite runners
// ─────────────────────────────────────────────────────────────────────

export function runTrajectoryScenario(
  scenario: TrajectoryScenario,
): TrajectoryResult {
  const deviation = editDistance(
    scenario.proposedPath,
    scenario.expectOptimalPath,
  );
  const failures: string[] = [];
  if (deviation > scenario.tolerance) {
    failures.push(
      `deviation ${deviation} exceeds tolerance ${scenario.tolerance} ` +
        `(optimal=${scenario.expectOptimalPath.length} tool(s), proposed=${scenario.proposedPath.length} tool(s))`,
    );
  }
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    deviation,
    pass: failures.length === 0,
    failures,
    proposedLength: scenario.proposedPath.length,
    optimalLength: scenario.expectOptimalPath.length,
  };
}

export function runTrajectorySuite(
  scenarios: ReadonlyArray<TrajectoryScenario>,
): TrajectoryOutcome {
  const results = scenarios.map(runTrajectoryScenario);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  const meanDeviation =
    total === 0
      ? 0
      : results.reduce((acc, r) => acc + r.deviation, 0) / total;
  const maxDeviation =
    total === 0 ? 0 : results.reduce((m, r) => Math.max(m, r.deviation), 0);

  const categories = new Set(scenarios.map((s) => s.category));
  const perCategory: Record<string, number> = {};
  for (const cat of categories) {
    const inCat = results.filter((r) => r.category === cat);
    perCategory[cat] =
      inCat.length === 0
        ? 0
        : inCat.filter((r) => r.pass).length / inCat.length;
  }

  return {
    results,
    summary: {
      total,
      passed,
      failed,
      meanDeviation,
      maxDeviation,
      perCategoryPassRate: perCategory as TrajectorySummary['perCategoryPassRate'],
    },
  };
}
