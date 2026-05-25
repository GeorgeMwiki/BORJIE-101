#!/usr/bin/env tsx
/**
 * CLI entrypoint for the forecasting benchmark suite.
 *
 *   pnpm bench:forecast
 *     Runs every scenario against every default baseline. Writes:
 *       evals/forecasting-bench/results/results-<ISO-date>.json
 *       evals/forecasting-bench/results/results-<ISO-date>.md
 *       evals/forecasting-bench/results/results-<ISO-date>.csv
 *
 *   pnpm bench:forecast --scenario rent_forecast
 *     Runs only the named scenario.
 *
 *   pnpm bench:forecast --scenario rent_forecast --model ./path/to/forecaster.ts
 *     Imports a user-supplied forecaster module and benches it alongside
 *     the baselines. The module must default-export a `Forecaster`.
 *
 *   pnpm bench:forecast --out ./tmp/results
 *     Override the output directory.
 *
 *   pnpm bench:forecast --quiet
 *     Suppress per-run console output (still writes files).
 *
 * Exit codes:
 *   0 — every scenario/model combination ran successfully
 *   1 — one or more runs failed (errors written to JSON regardless)
 *   2 — CLI argument error (printed to stderr)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Forecaster, NamedForecaster } from './baselines.ts';
import { defaultBaselines } from './baselines.ts';
import { runBacktest, type BacktestRun } from './backtest.ts';
import {
  SCENARIO_IDS,
  buildScenario,
  type Scenario,
  type ScenarioId,
} from './scenarios.ts';

// ───────────────────────────────────────────────────────────────────────
// Arg parsing — kept tiny on purpose, zero deps.
// ───────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  readonly scenarios: ReadonlyArray<ScenarioId>;
  readonly modelPath: string | null;
  readonly outDir: string;
  readonly quiet: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let scenario: ScenarioId | null = null;
  let modelPath: string | null = null;
  let outDir: string | null = null;
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scenario' || arg === '-s') {
      const value = argv[i + 1];
      if (!value) {
        throw new ArgError('--scenario requires a value');
      }
      if (!SCENARIO_IDS.includes(value as ScenarioId)) {
        throw new ArgError(`unknown scenario '${value}' (allowed: ${SCENARIO_IDS.join(', ')})`);
      }
      scenario = value as ScenarioId;
      i += 1;
    } else if (arg === '--model' || arg === '-m') {
      const value = argv[i + 1];
      if (!value) {
        throw new ArgError('--model requires a path');
      }
      modelPath = value;
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      const value = argv[i + 1];
      if (!value) {
        throw new ArgError('--out requires a directory path');
      }
      outDir = value;
      i += 1;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg !== undefined && arg.startsWith('-')) {
      throw new ArgError(`unknown flag '${arg}'`);
    }
  }
  return {
    scenarios: scenario ? [scenario] : SCENARIO_IDS,
    modelPath,
    outDir: outDir ?? defaultOutDir(),
    quiet,
  };
}

class ArgError extends Error {}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: pnpm bench:forecast [options]

Options:
  --scenario <id>      Run only the named scenario (default: all)
                       allowed: ${SCENARIO_IDS.join(', ')}
  --model <path>       Path to a module default-exporting a Forecaster
  --out <dir>          Output directory (default: evals/forecasting-bench/results)
  --quiet              Suppress per-run console summaries
  --help               Show this message`);
}

function defaultOutDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'results');
}

// ───────────────────────────────────────────────────────────────────────
// Custom model loading.
// ───────────────────────────────────────────────────────────────────────

async function loadCustomModel(modelPath: string): Promise<NamedForecaster> {
  const absolute = path.resolve(process.cwd(), modelPath);
  const url = pathToFileURL(absolute).href;
  const mod = (await import(url)) as { default?: Forecaster; forecaster?: Forecaster; name?: string };
  const fn = mod.default ?? mod.forecaster;
  if (typeof fn !== 'function') {
    throw new Error(`bench:forecast: module ${modelPath} must export a default Forecaster function`);
  }
  return { name: mod.name ?? `custom:${path.basename(modelPath)}`, forecaster: fn };
}

// ───────────────────────────────────────────────────────────────────────
// Reporting.
// ───────────────────────────────────────────────────────────────────────

interface BenchResults {
  readonly generatedAt: string;
  readonly node: string;
  readonly runs: ReadonlyArray<BacktestRun>;
  readonly failures: ReadonlyArray<{ readonly scenarioId: string; readonly modelName: string; readonly error: string }>;
}

function fmt(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function renderMarkdown(results: BenchResults): string {
  const lines: Array<string> = [];
  lines.push('# Forecasting benchmark results');
  lines.push('');
  lines.push(`Generated at: \`${results.generatedAt}\`  `);
  lines.push(`Node version: \`${results.node}\`  `);
  lines.push(`Runs: ${results.runs.length}; Failures: ${results.failures.length}`);
  lines.push('');
  // Group by scenario.
  const byScenario = new Map<string, Array<BacktestRun>>();
  for (const run of results.runs) {
    const list = byScenario.get(run.scenarioId) ?? [];
    list.push(run);
    byScenario.set(run.scenarioId, list);
  }
  for (const [scenarioId, runs] of byScenario) {
    lines.push(`## Scenario: \`${scenarioId}\``);
    lines.push('');
    lines.push('| Model | MAE | RMSE | MAPE % | sMAPE | MASE | CRPS | Cov 80 | Cov 95 | Folds |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const run of runs) {
      const g = run.global.aggregate;
      lines.push(`| ${run.modelName} | ${fmt(g.mae)} | ${fmt(g.rmse)} | ${fmt(g.mape)} | ${fmt(g.smape)} | ${fmt(g.mase)} | ${fmt(g.crps)} | ${fmt(g.coverage80)} | ${fmt(g.coverage95)} | ${run.global.foldCount} |`);
    }
    lines.push('');
  }
  if (results.failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const f of results.failures) {
      lines.push(`- \`${f.scenarioId}\` / \`${f.modelName}\`: ${f.error}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderCsv(results: BenchResults): string {
  const rows: Array<string> = [];
  rows.push('scenario,model,tenant,series,fold_count,mae,rmse,mape,smape,mase,crps,coverage80,coverage95');
  for (const run of results.runs) {
    for (const series of run.perSeries) {
      const a = series.aggregate;
      rows.push([
        run.scenarioId,
        run.modelName,
        series.tenantId,
        series.seriesId,
        series.foldCount.toString(),
        fmt(a.mae),
        fmt(a.rmse),
        fmt(a.mape),
        fmt(a.smape),
        fmt(a.mase),
        fmt(a.crps),
        fmt(a.coverage80),
        fmt(a.coverage95),
      ].join(','));
    }
  }
  return rows.join('\n');
}

// ───────────────────────────────────────────────────────────────────────
// Main.
// ───────────────────────────────────────────────────────────────────────

async function main(argv: ReadonlyArray<string>): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      // eslint-disable-next-line no-console
      console.error(`bench:forecast: ${err.message}`);
      printHelp();
      return 2;
    }
    throw err;
  }

  const customModel = args.modelPath ? await loadCustomModel(args.modelPath) : null;
  const scenarios: Array<Scenario> = args.scenarios.map((id) => buildScenario(id));

  const runs: Array<BacktestRun> = [];
  const failures: Array<{ scenarioId: string; modelName: string; error: string }> = [];

  for (const scenario of scenarios) {
    const models: Array<NamedForecaster> = [
      ...defaultBaselines(scenario.seasonality),
    ];
    if (customModel) {
      models.push(customModel);
    }
    for (const model of models) {
      try {
        const run = runBacktest({
          modelName: model.name,
          scenarioId: scenario.id,
          series: scenario.series,
          forecaster: model.forecaster,
          config: scenario.config,
        });
        runs.push(run);
        if (!args.quiet) {
          const a = run.global.aggregate;
          // eslint-disable-next-line no-console
          console.log(
            `[${scenario.id}] ${model.name.padEnd(28)} mae=${fmt(a.mae)} mase=${fmt(a.mase)} smape=${fmt(a.smape)} crps=${fmt(a.crps)} cov80=${fmt(a.coverage80)} cov95=${fmt(a.coverage95)} folds=${run.global.foldCount} (${run.elapsedMs}ms)`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ scenarioId: scenario.id, modelName: model.name, error: message });
        // eslint-disable-next-line no-console
        console.error(`[${scenario.id}] ${model.name} FAILED: ${message}`);
      }
    }
  }

  const results: BenchResults = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    runs,
    failures,
  };

  await fs.mkdir(args.outDir, { recursive: true });
  const stamp = results.generatedAt.replace(/[:.]/g, '-');
  const baseName = `results-${stamp}`;
  const jsonPath = path.join(args.outDir, `${baseName}.json`);
  const mdPath = path.join(args.outDir, `${baseName}.md`);
  const csvPath = path.join(args.outDir, `${baseName}.csv`);
  await fs.writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, `${renderMarkdown(results)}\n`, 'utf8');
  await fs.writeFile(csvPath, `${renderCsv(results)}\n`, 'utf8');
  if (!args.quiet) {
    // eslint-disable-next-line no-console
    console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}\n  ${csvPath}`);
  }
  return failures.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('bench:forecast fatal error:', err);
      process.exit(1);
    });
}

export { main, parseArgs, renderMarkdown, renderCsv };
