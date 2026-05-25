/**
 * run-bench.ts — PMS-bench-1 driver (Phase E.5).
 *
 * Usage:
 *   pnpm pms-bench:run                  # real Anthropic if ANTHROPIC_API_KEY, else mock
 *   pnpm pms-bench:run --mock           # force deterministic mock (CI gate)
 *   pnpm pms-bench:run --scenario maintenance-dispatch
 *   pnpm pms-bench:run --k 3
 *
 * Phase E.5 changes:
 *   1. Real sub-MD adapter (LLM-driven plan extraction) replaces the
 *      Phase E.4 empty-observation stub.
 *   2. `--mock` flag for CI runs without an Anthropic key.
 *   3. SloEvent emission per scorer per run → JSONL under
 *      `reports/slo-events-<runId>.jsonl`.
 *   4. Report renders per-scorer means + regression vs baseline.json +
 *      top-3 failures.
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  ALL_SCORERS,
  type ObservedRun,
  type ScoreResult,
  type TaskFixture,
} from '../scorers/index.js';
import { renderReport, type BaselineSnapshot } from './report.js';
import { createMockLlm } from './mock-llm.js';
import { createAnthropicLlm } from './anthropic-llm.js';
import type { BenchLlmPort } from './llm-port.js';
import { runSubMd } from './sub-md-adapter.js';
import {
  createSloStreamWriter,
  type BenchSloEvent,
  type SloStreamWriter,
} from './slo-stream-writer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_DIR = join(ROOT, 'tasks');
const REPORTS_DIR = join(ROOT, 'reports');
const OUTPUT_DIR = join(ROOT, 'output');
const BASELINE_PATH = join(REPORTS_DIR, 'baseline.json');

interface Args {
  readonly scenario?: string;
  readonly k: number;
  readonly mock: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  let scenario: string | undefined;
  let k = 5;
  let mock = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') scenario = argv[++i];
    else if (a === '--k') k = Number(argv[++i] ?? 5);
    else if (a === '--mock') mock = true;
  }
  return scenario === undefined ? { k, mock } : { scenario, k, mock };
}

export async function listScenarios(): Promise<ReadonlyArray<string>> {
  const entries = await readdir(TASKS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function loadFixtures(scenario: string): Promise<ReadonlyArray<TaskFixture>> {
  const scenarioDir = join(TASKS_DIR, scenario);
  const files = await readdir(scenarioDir);
  const out: TaskFixture[] = [];
  for (const f of files) {
    if (!f.endsWith('.yaml')) continue;
    const raw = await readFile(join(scenarioDir, f), 'utf8');
    const parsed = parseYaml(raw) as TaskFixture;
    out.push(parsed);
  }
  return out;
}

interface TaskRunSummary {
  readonly taskId: string;
  readonly scenario: string;
  readonly subMd: string | null;
  readonly runs: ReadonlyArray<{
    readonly composite: number;
    readonly scores: ReadonlyArray<ScoreResult>;
    readonly pass: boolean;
    readonly observed: ObservedRun;
  }>;
  readonly passK: boolean;
  readonly passCount: number;
  readonly totalRuns: number;
}

function compose(
  scores: ReadonlyArray<ScoreResult>,
  weights: Readonly<Record<string, number>>,
): number {
  let total = 0;
  let denom = 0;
  for (const s of scores) {
    const w = weights[s.scorer] ?? 0;
    total += s.score * w;
    denom += w;
  }
  return denom > 0 ? total / denom : 0;
}

async function scoreRun(
  fixture: TaskFixture,
  run: ObservedRun,
): Promise<ReadonlyArray<ScoreResult>> {
  const results: ScoreResult[] = [];
  for (const name of Object.keys(fixture.scorer_weights)) {
    const scorer = ALL_SCORERS[name];
    if (!scorer) continue;
    results.push(await scorer(fixture, run));
  }
  return results;
}

/**
 * Map a scorer name onto the autonomy-governance SloMetric enum. The
 * 4 scorers don't map 1-to-1 onto the 4 SLO metrics by accident — the
 * bench was designed against this taxonomy in Phase E.4.
 */
function scorerToSloMetric(scorerName: string): BenchSloEvent['metric'] {
  switch (scorerName) {
    case 'action-correctness':
      return 'task-completion-rate';
    case 'escalation-correctness':
      return 'resolution-quality';
    case 'communication-quality':
      return 'owner-cs-score';
    case 'cost-efficiency':
      return 'cost-per-resolution';
    default:
      return 'task-completion-rate';
  }
}

/**
 * Per-run SLO event emission. The bench is the ground-truth, so
 * predictedValue is omitted and delta is "distance from perfect"
 * (1 - score), sign-flipped for the LOWER_IS_BETTER metric so the
 * SLO monitor's "delta < 0 = bad" convention holds.
 */
async function emitSloEvents(args: {
  readonly subMd: string;
  readonly scores: ReadonlyArray<ScoreResult>;
  readonly observed: ObservedRun;
  readonly writer: SloStreamWriter;
  readonly timestamp: string;
}): Promise<void> {
  const { subMd, scores, observed, writer, timestamp } = args;
  for (const s of scores) {
    const metric = scorerToSloMetric(s.scorer);
    // For higher-is-better metrics: actual = score; delta = score - 1 (negative when bad).
    // For cost-per-resolution (lower is better): actual = cost in cents; delta = budget - actual.
    let actualValue: number;
    let delta: number;
    if (metric === 'cost-per-resolution') {
      const budget = 10;
      actualValue = observed.costUsdCents;
      delta = budget - observed.costUsdCents;
    } else {
      actualValue = s.score;
      delta = s.score - 1.0; // 0 when perfect, negative when below target
    }
    const event: BenchSloEvent = {
      subMd,
      tenantId: null,
      timestamp,
      metric,
      actualValue,
      delta,
    };
    await writer.emit(event);
  }
}

interface SingleRunResult {
  readonly composite: number;
  readonly scores: ReadonlyArray<ScoreResult>;
  readonly pass: boolean;
  readonly observed: ObservedRun;
  readonly subMd: string | null;
}

export async function runTask(args: {
  readonly fixture: TaskFixture;
  readonly k: number;
  readonly llm: BenchLlmPort;
  readonly sloWriter: SloStreamWriter;
}): Promise<TaskRunSummary> {
  const { fixture, k, llm, sloWriter } = args;
  const results: ReadonlyArray<SingleRunResult> = await Promise.all(
    Array.from({ length: k }, async (_, i): Promise<SingleRunResult> => {
      const result = await runSubMd({ fixture, llm, seed: i });
      const scores = await scoreRun(fixture, result.observed);
      const composite = compose(scores, fixture.scorer_weights);
      const subMdName = result.subMd ?? `unsupported:${fixture.scenario}`;
      await emitSloEvents({
        subMd: subMdName,
        scores,
        observed: result.observed,
        writer: sloWriter,
        timestamp: new Date().toISOString(),
      });
      return Object.freeze({
        composite,
        scores,
        pass: composite >= 0.8,
        observed: result.observed,
        subMd: result.subMd,
      });
    }),
  );
  const runs = results.map((r) => ({
    composite: r.composite,
    scores: r.scores,
    pass: r.pass,
    observed: r.observed,
  }));
  const passCount = runs.filter((r) => r.pass).length;
  const required = Math.ceil(k * 0.6);
  return Object.freeze({
    taskId: fixture.id,
    scenario: fixture.scenario,
    subMd: results[0]?.subMd ?? null,
    runs,
    passCount,
    totalRuns: k,
    passK: passCount >= required,
  });
}

async function loadBaseline(): Promise<BaselineSnapshot | null> {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = await readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(raw) as BaselineSnapshot;
  } catch {
    return null;
  }
}

interface LlmSelection {
  readonly llm: BenchLlmPort;
  readonly mode: 'mock' | 'anthropic';
  readonly notice: string;
}

function selectLlm(args: Args): LlmSelection | null {
  if (args.mock) {
    return Object.freeze({
      llm: createMockLlm(),
      mode: 'mock',
      notice: 'Using deterministic mock LLM (--mock).',
    });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return Object.freeze({
    llm: createAnthropicLlm({ apiKey }),
    mode: 'anthropic',
    notice: `Using Anthropic LLM (model = ${process.env.BENCH_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'}).`,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const sel = selectLlm(args);
  if (sel === null) {
    process.stdout.write(
      'pms-bench: no ANTHROPIC_API_KEY set and --mock not passed; skipping (use --mock for CI).\n',
    );
    process.exit(0);
  }
  process.stdout.write(`${sel.notice}\n`);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const sloPath = join(OUTPUT_DIR, `slo-events-${runId}.jsonl`);
  const sloWriter = createSloStreamWriter({ outputPath: sloPath });

  const scenarios = args.scenario ? [args.scenario] : await listScenarios();

  const allSummaries: TaskRunSummary[] = [];
  for (const scenario of scenarios) {
    const fixtures = await loadFixtures(scenario);
    for (const fixture of fixtures) {
      const summary = await runTask({
        fixture,
        k: args.k,
        llm: sel.llm,
        sloWriter,
      });
      allSummaries.push(summary);
      const verdict = summary.passK ? 'PASS' : 'FAIL';
      process.stdout.write(
        `[${verdict}] ${summary.taskId} (${summary.passCount}/${summary.totalRuns})\n`,
      );
    }
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const baseline = await loadBaseline();
  const reportPath = join(REPORTS_DIR, `${runId}.md`);
  const markdown = renderReport({
    summaries: allSummaries,
    mode: sel.mode,
    sloEventsPath: sloPath,
    baseline,
  });
  await writeFile(reportPath, markdown, 'utf8');
  process.stdout.write(`\nReport written: ${reportPath}\n`);
  process.stdout.write(`SLO events written: ${sloPath}\n`);
}

/**
 * Only invoke `main()` when this module is executed directly (e.g. via
 * `tsx run-bench.ts`). Tests import the module to call individual helpers
 * and must not trigger the full CLI.
 */
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`pms-bench run failed: ${String(err)}\n`);
    process.exit(1);
  });
}

export type { TaskRunSummary };
export { main };
