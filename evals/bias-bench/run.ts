#!/usr/bin/env tsx
/**
 * Bias bench CLI — the in-tree CI gate for fairness regressions.
 *
 *   pnpm --filter @borjie/bias-bench bench
 *     Runs all 5 LLM bias suites against the deterministic baseline
 *     brains + the group-fairness metrics, prints a report, and exits
 *     non-zero if the GATE brain breaches any suite threshold.
 *
 *   pnpm --filter @borjie/bias-bench bench --model ./path/to/brain.ts
 *     Loads a module default-exporting a `BiasBrain` and gates IT
 *     instead of the safe-refusal baseline (the adversarial ceiling is
 *     always run alongside as a discrimination check, never gated).
 *
 *   pnpm --filter @borjie/bias-bench bench --quiet
 *     Suppress the per-suite console table (exit code still set).
 *
 * Exit codes:
 *   0 — the gate brain is within every threshold AND the metrics
 *       discriminate (ceiling brain scores strictly above the floor).
 *   1 — a threshold breach or a non-discriminating metric (stub guard).
 *   2 — CLI argument error.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runBBQ,
  runStereoSet,
  runCrowSPairs,
  runHONEST,
  runRealToxicityPrompts,
  type BiasBrain,
  type LLMBiasBenchmark,
} from '@borjie/bias-handling';
import { defaultBrains, safeRefusalBrain, type NamedBrain } from './baselines.ts';
import { SUITE_THRESHOLDS, thresholdForSuite, type BiasSuite } from './thresholds.ts';
import { scoreGroupFairness, BALANCED_DECISION_FIXTURE } from './group-fairness.ts';

interface ParsedArgs {
  readonly modelPath: string | null;
  readonly quiet: boolean;
}

class ArgError extends Error {}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let modelPath: string | null = null;
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model' || arg === '-m') {
      const value = argv[i + 1];
      if (!value) throw new ArgError('--model requires a path');
      modelPath = value;
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
  return { modelPath, quiet };
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: pnpm --filter @borjie/bias-bench bench [options]',
      '',
      'Options:',
      '  --model <path>   Module default-exporting a BiasBrain to gate',
      '  --quiet          Suppress per-suite console output',
      '  --help           Show this message',
      '',
    ].join('\n'),
  );
}

async function loadModelBrain(modelPath: string): Promise<NamedBrain> {
  const absolute = path.resolve(process.cwd(), modelPath);
  const url = pathToFileURL(absolute).href;
  const mod = (await import(url)) as { default?: BiasBrain; brain?: BiasBrain; name?: string };
  const brain = mod.default ?? mod.brain;
  if (!brain || typeof brain.complete !== 'function') {
    throw new Error(`bias-bench: module ${modelPath} must default-export a BiasBrain`);
  }
  return { name: mod.name ?? `custom:${path.basename(modelPath)}`, brain };
}

/** Run all 5 suites against one brain. */
async function runAllSuites(brain: BiasBrain): Promise<ReadonlyArray<LLMBiasBenchmark>> {
  return [
    await runBBQ({ brain }),
    await runStereoSet({ brain }),
    await runCrowSPairs({ brain }),
    await runHONEST({ brain }),
    await runRealToxicityPrompts({ brain }),
  ];
}

function fmt(n: number): string {
  return n.toFixed(4);
}

function printSuiteTable(brainName: string, results: ReadonlyArray<LLMBiasBenchmark>): void {
  process.stdout.write(`\n# ${brainName}\n`);
  process.stdout.write('suite                 score    threshold  status\n');
  for (const r of results) {
    const threshold = thresholdForSuite(r.suite as BiasSuite);
    const status = r.overallScore <= threshold ? 'PASS' : 'FAIL';
    process.stdout.write(
      `${r.suite.padEnd(21)} ${fmt(r.overallScore).padEnd(8)} ${fmt(threshold).padEnd(10)} ${status}\n`,
    );
  }
}

interface GateOutcome {
  readonly breaches: ReadonlyArray<string>;
}

function gateBrain(results: ReadonlyArray<LLMBiasBenchmark>): GateOutcome {
  const breaches: string[] = [];
  for (const r of results) {
    const threshold = thresholdForSuite(r.suite as BiasSuite);
    if (r.overallScore > threshold) {
      breaches.push(`${r.suite}: ${fmt(r.overallScore)} > ${fmt(threshold)}`);
    }
  }
  return { breaches };
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      process.stderr.write(`bias-bench: ${err.message}\n`);
      printHelp();
      return 2;
    }
    throw err;
  }

  // The brain we GATE on: the custom model if provided, else the
  // unbiased floor. The adversarial ceiling is always run for the
  // discrimination check.
  const gateNamed: NamedBrain = args.modelPath
    ? await loadModelBrain(args.modelPath)
    : { name: 'safe-refusal (unbiased floor)', brain: safeRefusalBrain };

  const ceiling = defaultBrains().find((b) => b.name.includes('ceiling'))!;

  const gateResults = await runAllSuites(gateNamed.brain);
  const ceilingResults = await runAllSuites(ceiling.brain);

  if (!args.quiet) {
    printSuiteTable(gateNamed.name, gateResults);
    printSuiteTable(ceiling.name, ceilingResults);
  }

  // Group-fairness signal over the balanced decision fixture.
  const gf = scoreGroupFairness({
    rows: BALANCED_DECISION_FIXTURE,
    privilegedGroup: 'male',
    jurisdiction: 'TZ',
    context: 'employment',
  });
  if (!args.quiet) {
    process.stdout.write('\n# group-fairness (balanced fixture, TZ/employment)\n');
    process.stdout.write(
      `disparate_impact      ${fmt(gf.disparateImpact.score)} violates=${gf.disparateImpact.violates}\n`,
    );
    process.stdout.write(
      `demographic_parity    ${fmt(gf.demographicParity.score)} violates=${gf.demographicParity.violates}\n`,
    );
    process.stdout.write(
      `protected_attributes  ${gf.protectedAttributes.map((p) => p.id).join(', ')}\n`,
    );
  }

  // ── Gate decisions ──────────────────────────────────────────────
  const gate = gateBrain(gateResults);

  // Stub-guard: the metrics must DISCRIMINATE — the adversarial ceiling
  // has to score strictly worse than the floor on at least one suite,
  // otherwise the suite isn't actually measuring anything.
  let discriminates = false;
  for (let i = 0; i < gateResults.length; i += 1) {
    if ((ceilingResults[i]?.overallScore ?? 0) > (gateResults[i]?.overallScore ?? 0)) {
      discriminates = true;
      break;
    }
  }

  const problems: string[] = [...gate.breaches];
  if (!gf.passes) {
    problems.push('group-fairness: balanced fixture unexpectedly violates 80%-rule');
  }
  if (!discriminates) {
    problems.push('stub-guard: metrics did not discriminate floor vs ceiling brain');
  }

  if (problems.length > 0) {
    process.stderr.write(`\nbias-bench GATE FAILED:\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    return 1;
  }

  if (!args.quiet) {
    process.stdout.write(
      `\nbias-bench GATE PASSED — ${Object.keys(SUITE_THRESHOLDS).length} suites + group-fairness within thresholds.\n`,
    );
  }
  return 0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`bias-bench fatal error: ${String(err)}\n`);
      process.exit(1);
    });
}

export { main, parseArgs, runAllSuites, gateBrain };
