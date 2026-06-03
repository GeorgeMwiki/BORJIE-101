/**
 * Shared report model + Markdown rendering + dated-path writing for the
 * eval-ops release-gate CLIs (LP-22a).
 *
 * Both `run-capability-evals` and `run-sota-validation` emit one Markdown
 * file per runner plus a suite index under a dated results directory:
 *
 *   Docs/parity-tests/<suite>/results/<YYYY-MM-DD>/<runner-id>.md
 *   Docs/parity-tests/<suite>/results/<YYYY-MM-DD>/_suite.md
 *
 * The suite verdict drives the process exit code (0 pass / 1 fail) so CI
 * can gate a release. Rendering is deterministic given a runner report.
 *
 * @module eval-ops-lib/report
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** One pass/fail criterion within a runner. */
export interface RunnerCriterion {
  readonly criterion: string;
  readonly observed: number;
  readonly threshold: number;
  /** Whether bigger `observed` is better (default true). */
  readonly higherIsBetter?: boolean;
  readonly passed: boolean;
}

/** One headline metric within a runner. */
export interface RunnerMetric {
  readonly key: string;
  readonly value: number;
  readonly unit?: string;
}

/** A single runner's outcome. */
export interface RunnerReport {
  readonly runnerId: string;
  readonly title: string;
  readonly seed: number;
  readonly nScenarios: number;
  readonly durationMs: number;
  readonly summary: string;
  readonly metrics: ReadonlyArray<RunnerMetric>;
  readonly criteria: ReadonlyArray<RunnerCriterion>;
  /** Verdict — derived from `criteria` (all passed). */
  readonly passed: boolean;
}

/** The whole-suite roll-up. */
export interface SuiteReport {
  readonly suite: string;
  readonly seed: number;
  readonly generatedAt: string;
  readonly reports: ReadonlyArray<RunnerReport>;
  readonly passed: boolean;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4);
}

/** Derive `passed` from criteria and build a {@link RunnerReport}. */
export function finalizeRunner(
  partial: Omit<RunnerReport, 'passed'>,
): RunnerReport {
  return { ...partial, passed: partial.criteria.every((c) => c.passed) };
}

/** Render a single runner report to Markdown (deterministic). */
export function renderRunnerMarkdown(r: RunnerReport): string {
  const metricRows = r.metrics
    .map((m) => `| ${m.key} | ${fmt(m.value)} | ${m.unit ?? ''} |`)
    .join('\n');
  const criteriaRows = r.criteria
    .map(
      (c) =>
        `| ${c.criterion} | ${fmt(c.observed)} | ${fmt(c.threshold)} | ${
          c.passed ? 'PASS' : 'FAIL'
        } |`,
    )
    .join('\n');
  return [
    `# ${r.title}`,
    '',
    `- Runner: \`${r.runnerId}\``,
    `- Verdict: **${r.passed ? 'PASS' : 'FAIL'}**`,
    `- Seed: ${r.seed}`,
    `- Scenarios: ${r.nScenarios}`,
    `- Duration: ${r.durationMs} ms`,
    '',
    '## Summary',
    '',
    r.summary,
    '',
    '## Pass criteria',
    '',
    '| Criterion | Observed | Threshold | Status |',
    '|-----------|----------|-----------|--------|',
    criteriaRows || '| _none_ | | | |',
    '',
    '## Headline metrics',
    '',
    '| Metric | Value | Unit |',
    '|--------|-------|------|',
    metricRows || '| _none_ | | |',
    '',
  ].join('\n');
}

/** Render the suite index to Markdown. */
export function renderSuiteMarkdown(s: SuiteReport): string {
  const rows = s.reports
    .map(
      (r) =>
        `| ${r.runnerId} | **${r.passed ? 'PASS' : 'FAIL'}** | ${r.durationMs} ms | ${r.nScenarios} |`,
    )
    .join('\n');
  return [
    `# ${s.suite} suite — ${s.generatedAt.slice(0, 10)}`,
    '',
    `- Verdict: **${s.passed ? 'ALL PASS' : 'FAIL'}**`,
    `- Seed: ${s.seed}`,
    `- Runners: ${s.reports.length} (passing: ${s.reports.filter((r) => r.passed).length})`,
    `- Generated: ${s.generatedAt}`,
    '',
    '## Per-runner verdicts',
    '',
    '| Runner | Verdict | Duration | Scenarios |',
    '|--------|---------|----------|-----------|',
    rows || '| _none_ | | | |',
    '',
    '## Machine-readable',
    '',
    '```json',
    JSON.stringify(
      s.reports.map((r) => ({
        runnerId: r.runnerId,
        passed: r.passed,
        seed: r.seed,
        nScenarios: r.nScenarios,
        metrics: r.metrics,
      })),
      null,
      2,
    ),
    '```',
    '',
  ].join('\n');
}

/** UTC `YYYY-MM-DD`. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Resolve the dated results directory for a suite under
 * `Docs/parity-tests/<suite>/results/<YYYY-MM-DD>`.
 */
export function resultsDir(
  cwd: string,
  suite: string,
  date: string = utcDate(),
): string {
  return resolve(cwd, 'Docs', 'parity-tests', suite, 'results', date);
}

/**
 * Write a runner report + suite index to disk. Returns the directory written.
 * Side-effecting — kept separate from rendering so renderers stay pure.
 */
export function writeSuiteReports(args: {
  readonly cwd: string;
  readonly suite: string;
  readonly suiteReport: SuiteReport;
  readonly date?: string;
}): string {
  const dir = resultsDir(args.cwd, args.suite, args.date ?? utcDate());
  mkdirSync(dir, { recursive: true });
  for (const r of args.suiteReport.reports) {
    writeFileSync(join(dir, `${r.runnerId}.md`), renderRunnerMarkdown(r), 'utf8');
  }
  writeFileSync(join(dir, '_suite.md'), renderSuiteMarkdown(args.suiteReport), 'utf8');
  return dir;
}
