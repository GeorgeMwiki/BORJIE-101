/**
 * report.ts — markdown report rendering for PMS-bench-1.
 *
 * Format (Phase E.5):
 *   1. Header — run mode (mock / anthropic) + SLO stream path
 *   2. Aggregate pass^k by scenario
 *   3. Per-scorer mean by scenario  (4 columns: action / escalation / comm / cost)
 *   4. Regression-vs-baseline (when reports/baseline.json exists)
 *   5. Per-task table
 *   6. Top-3 failures with first-failed-scorer rationales
 *   7. Methodology footnote
 */

import type { ScoreResult } from '../scorers/index.js';
import type { TaskRunSummary } from './run-bench.js';

/**
 * Persisted baseline shape. `reports/baseline.json` is hand-curated by
 * the team — when it exists, every report shows scenario-pass-rate delta.
 */
export interface BaselineSnapshot {
  readonly capturedAt: string;
  readonly mode: 'mock' | 'anthropic';
  readonly scenarioPassRate: Readonly<Record<string, number>>;
}

export interface RenderArgs {
  readonly summaries: ReadonlyArray<TaskRunSummary>;
  readonly mode: 'mock' | 'anthropic';
  readonly sloEventsPath: string;
  readonly baseline: BaselineSnapshot | null;
}

const SCORER_ORDER = [
  'action-correctness',
  'escalation-correctness',
  'communication-quality',
  'cost-efficiency',
] as const;

function groupByScenario(
  summaries: ReadonlyArray<TaskRunSummary>,
): ReadonlyMap<string, ReadonlyArray<TaskRunSummary>> {
  const byScenario = new Map<string, TaskRunSummary[]>();
  for (const s of summaries) {
    const list = byScenario.get(s.scenario) ?? [];
    list.push(s);
    byScenario.set(s.scenario, list);
  }
  return byScenario;
}

function meanScorerByScenario(
  list: ReadonlyArray<TaskRunSummary>,
): Readonly<Record<string, number>> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const t of list) {
    for (const r of t.runs) {
      for (const s of r.scores) {
        const e = sums.get(s.scorer) ?? { total: 0, count: 0 };
        e.total += s.score;
        e.count += 1;
        sums.set(s.scorer, e);
      }
    }
  }
  const out: Record<string, number> = {};
  for (const [name, e] of sums) {
    out[name] = e.count > 0 ? e.total / e.count : 0;
  }
  return out;
}

function meanComposite(list: ReadonlyArray<TaskRunSummary>): number {
  let total = 0;
  let count = 0;
  for (const t of list) {
    for (const r of t.runs) {
      total += r.composite;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

function lowestScorer(scores: ReadonlyArray<ScoreResult>): ScoreResult | null {
  if (scores.length === 0) return null;
  let lowest: ScoreResult = scores[0] as ScoreResult;
  for (const s of scores) {
    if (s.score < lowest.score) lowest = s;
  }
  return lowest;
}

function topFailures(
  summaries: ReadonlyArray<TaskRunSummary>,
  n: number,
): ReadonlyArray<{
  readonly taskId: string;
  readonly scenario: string;
  readonly meanComposite: number;
  readonly worstScorer: ScoreResult | null;
}> {
  const failures = summaries
    .filter((s) => !s.passK)
    .map((s) => {
      const meanComp = s.runs.reduce((a, r) => a + r.composite, 0) / Math.max(1, s.runs.length);
      // Worst single-scorer outcome across all runs of this task.
      let worst: ScoreResult | null = null;
      for (const r of s.runs) {
        const ls = lowestScorer(r.scores);
        if (ls && (worst === null || ls.score < worst.score)) worst = ls;
      }
      return { taskId: s.taskId, scenario: s.scenario, meanComposite: meanComp, worstScorer: worst };
    })
    .sort((a, b) => a.meanComposite - b.meanComposite);
  return failures.slice(0, n);
}

export function renderReport(args: RenderArgs): string {
  const { summaries, mode, sloEventsPath, baseline } = args;
  const byScenario = groupByScenario(summaries);

  const lines: string[] = [];
  lines.push('# PMS-bench-1 Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: \`${mode}\``);
  lines.push(`SLO events: \`${sloEventsPath}\``);
  lines.push('');

  // 1) Aggregate pass^k
  lines.push('## Aggregate pass^k by scenario');
  lines.push('');
  lines.push('| Scenario | Tasks | Passed | Pass rate | Δ vs baseline |');
  lines.push('|----------|-------|--------|-----------|---------------|');
  for (const [scenario, list] of byScenario) {
    const passed = list.filter((s) => s.passK).length;
    const rate = passed / list.length;
    const rateStr = (rate * 100).toFixed(1);
    let delta = '—';
    if (baseline && typeof baseline.scenarioPassRate[scenario] === 'number') {
      const base = baseline.scenarioPassRate[scenario];
      const diff = (rate - base) * 100;
      const sign = diff >= 0 ? '+' : '';
      delta = `${sign}${diff.toFixed(1)} pp`;
    }
    lines.push(`| ${scenario} | ${list.length} | ${passed} | ${rateStr}% | ${delta} |`);
  }
  const totalPassed = summaries.filter((s) => s.passK).length;
  const totalRate = ((totalPassed / Math.max(1, summaries.length)) * 100).toFixed(1);
  lines.push(`| **TOTAL** | **${summaries.length}** | **${totalPassed}** | **${totalRate}%** | — |`);
  lines.push('');

  // 2) Per-scorer means
  lines.push('## Per-scorer mean score by scenario');
  lines.push('');
  lines.push(
    '| Scenario | action-correctness | escalation-correctness | communication-quality | cost-efficiency | composite |',
  );
  lines.push('|----------|-------------------|----------------------|----------------------|-----------------|-----------|');
  for (const [scenario, list] of byScenario) {
    const means = meanScorerByScenario(list);
    const comp = meanComposite(list).toFixed(3);
    const cols = SCORER_ORDER.map((s) => (means[s] ?? 0).toFixed(3));
    lines.push(`| ${scenario} | ${cols[0]} | ${cols[1]} | ${cols[2]} | ${cols[3]} | ${comp} |`);
  }
  lines.push('');

  // 3) Per-task table
  lines.push('## Per-task results');
  lines.push('');
  for (const [scenario, list] of byScenario) {
    lines.push(`### ${scenario}`);
    lines.push('');
    lines.push('| Task | Passes / Runs | Mean composite | Verdict |');
    lines.push('|------|---------------|----------------|---------|');
    for (const s of list) {
      const mean =
        s.runs.reduce((sum, r) => sum + r.composite, 0) / Math.max(1, s.runs.length);
      const verdict = s.passK ? 'PASS' : 'FAIL';
      lines.push(
        `| ${s.taskId} | ${s.passCount}/${s.totalRuns} | ${mean.toFixed(3)} | ${verdict} |`,
      );
    }
    lines.push('');
  }

  // 4) Top failures
  const failures = topFailures(summaries, 3);
  if (failures.length > 0) {
    lines.push('## Top 3 failures');
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.taskId}** (${f.scenario}) — mean composite \`${f.meanComposite.toFixed(3)}\``);
      if (f.worstScorer) {
        lines.push(`  - worst scorer: \`${f.worstScorer.scorer}\` @ \`${f.worstScorer.score.toFixed(3)}\` — ${f.worstScorer.rationale}`);
      }
    }
    lines.push('');
  }

  // 5) Methodology
  lines.push('## Methodology');
  lines.push('');
  lines.push('- Each task runs `k` times against the sub-MD via the LLM-driven adapter (default `k=5`).');
  lines.push('- Each run is scored by 4 scorers (action / escalation / communication / cost).');
  lines.push('- A run is a `pass` iff the weighted composite score `>= 0.80`.');
  lines.push('- A task passes (`pass^k`) iff `>= ceil(k * 0.6)` runs pass.');
  lines.push('- Per-scorer SLO events are streamed to the JSONL file noted above.');
  lines.push('- Scenarios without a shipped sub-MD (arrears, kra-filing, lease-renewal) fail by design until Tier-B/C ships.');
  return lines.join('\n');
}
