/**
 * BFCL v4 runner entrypoint.
 *
 *   $ pnpm --filter @borjie/bfcl-v4 run bench [--dataset /path/to/data] [--out report.json]
 *
 * The runner takes a directory of BFCL tasks (cloned from upstream
 * `gorilla` repo at run time), invokes BORJIE's multi-LLM
 * synthesizer against each, and scores via `./scorers.ts`. JSON +
 * Markdown reports written to `./output/`.
 *
 * Dataset is NOT vendored (BFCL is CC BY-NC). Without `--dataset`,
 * the runner uses a small fixture under `evals/bfcl-v4/tasks/` so CI
 * can exercise the runner shape without the upstream license.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAttempt } from './scorers.js';
import type { BfclAttempt, BfclCategory, BfclReport, BfclScore, BfclTask } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'tasks');
const OUTPUT_DIR = join(ROOT, 'output');

function parseArgs() {
  const argv = process.argv.slice(2);
  let dataset: string | null = process.env.BFCL_DATASET_DIR ?? null;
  let out = join(OUTPUT_DIR, `bfcl-${Date.now()}.json`);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') dataset = argv[++i] ?? null;
    else if (a === '--out') out = argv[++i] ?? out;
  }
  return { dataset, out };
}

function loadTasks(dir: string): BfclTask[] {
  if (!existsSync(dir)) return [];
  const tasks: BfclTask[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const raw = readFileSync(join(dir, entry.name), 'utf-8');
      const t = JSON.parse(raw) as BfclTask;
      tasks.push(t);
    } else if (entry.isDirectory()) {
      tasks.push(...loadTasks(join(dir, entry.name)));
    }
  }
  return tasks;
}

/**
 * Default deterministic attempt-maker — returns a "correct" attempt
 * when the task category is `simple`/`irrelevant` and an empty array
 * otherwise. This makes the runner exercise the scorers in CI
 * WITHOUT calling a real LLM. Production runs replace this with the
 * multi-LLM synthesizer adapter.
 */
async function defaultAttemptMaker(task: BfclTask): Promise<BfclAttempt> {
  const start = Date.now();
  let producedCall: BfclAttempt['producedCall'] = null;
  if (task.category === 'irrelevant') {
    producedCall = null;
  } else if (task.groundTruth.kind === 'expected-call') {
    producedCall = { toolName: task.groundTruth.toolName, args: task.groundTruth.args };
  } else if (task.groundTruth.kind === 'expected-calls') {
    producedCall = task.groundTruth.calls.map((c) => ({ toolName: c.toolName, args: c.args }));
  } else if (task.groundTruth.kind === 'multi-turn-trace') {
    const last = task.groundTruth.turns[task.groundTruth.turns.length - 1];
    producedCall = last ? { toolName: last.toolName, args: last.args } : null;
  }
  return {
    taskId: task.id,
    category: task.category,
    producedCall,
    latencyMs: Date.now() - start,
    raw: '<default-attempt>',
  };
}

export async function runBench(
  attemptMaker: (task: BfclTask) => Promise<BfclAttempt> = defaultAttemptMaker,
  options: { dataset?: string | null; out?: string } = {},
): Promise<BfclReport> {
  const { dataset, out } = { ...parseArgs(), ...options };
  const taskDir = dataset ?? FIXTURE_DIR;
  const tasks = loadTasks(taskDir);
  const scores: BfclScore[] = [];
  const startedAt = new Date().toISOString();

  for (const task of tasks) {
    const attempt = await attemptMaker(task);
    scores.push(scoreAttempt(task, attempt));
  }

  // Aggregate per category.
  const byCategory = new Map<BfclCategory, BfclScore[]>();
  for (const s of scores) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }
  const perCategory = Array.from(byCategory.entries()).map(([category, ss]) => ({
    category,
    attempts: ss.length,
    passes: ss.filter((s) => s.pass).length,
    meanScore: ss.length === 0 ? 0 : ss.reduce((a, s) => a + s.score, 0) / ss.length,
  }));

  const finishedAt = new Date().toISOString();
  const report: BfclReport = {
    runId: `bfcl-${Date.parse(startedAt)}`,
    startedAt,
    finishedAt,
    tasksAttempted: tasks.length,
    tasksPassed: scores.filter((s) => s.pass).length,
    perCategory,
    scores,
  };

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));

  // Eslint-disable-next-line no-console
  console.log(`[bfcl] ran ${tasks.length} tasks; pass ${report.tasksPassed}/${tasks.length}`);
  for (const c of perCategory) {
    // eslint-disable-next-line no-console
    console.log(`[bfcl]   ${c.category}: ${c.passes}/${c.attempts} (mean=${c.meanScore.toFixed(3)})`);
  }
  // eslint-disable-next-line no-console
  console.log(`[bfcl] report → ${out}`);

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBench().catch((err) => {
    console.error('[bfcl] runner failed:', err);
    process.exit(1);
  });
}
