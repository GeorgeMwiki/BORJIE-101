/**
 * Deterministic SOTA empirical-validation release gate (LP-22a).
 *
 * Runs the SOTA property runners and writes one Markdown report per runner
 * plus a suite index to:
 *
 *   Docs/parity-tests/sota/results/<YYYY-MM-DD>/<runner-id>.md
 *   Docs/parity-tests/sota/results/<YYYY-MM-DD>/_suite.md
 *
 * Exit code: 0 if every runner passes, 1 if any fail, 2 on bad args / fatal.
 * Fully seeded — no network, no DB.
 *
 * Usage:
 *   tsx scripts/run-sota-validation/run-all.ts [--seed N] [--only id,id]
 *                                              [--out DIR] [--quiet]
 *
 * @module run-sota-validation/run-all
 */

import { pathToFileURL } from 'node:url';
import {
  finalizeSuite,
  parseEvalArgs,
  printSuiteLine,
} from '../eval-ops-lib/cli.js';
import { writeSuiteReports } from '../eval-ops-lib/report.js';
import {
  SOTA_RUNNER_IDS,
  runSotaSuite,
  type SotaRunnerId,
} from './runners.js';

const SUITE = 'sota';
const DEFAULT_SEED = 1337;

const USAGE = `SOTA empirical-validation release gate

Usage:
  tsx scripts/run-sota-validation/run-all.ts [--seed N] [--only id,id,...]

Options:
  --seed N      Deterministic seed (default ${DEFAULT_SEED})
  --only ids    Comma-separated runner ids. Valid:
                ${SOTA_RUNNER_IDS.join(', ')}
  --out DIR     Override the repo root used to resolve the results dir.
  --quiet       Suppress per-runner stdout.
  -h, --help    Show this help.

Outputs:
  Docs/parity-tests/sota/results/<YYYY-MM-DD>/<runner-id>.md
  Docs/parity-tests/sota/results/<YYYY-MM-DD>/_suite.md
`;

export function main(argv: ReadonlyArray<string>): number {
  const args = parseEvalArgs(argv, {
    defaultSeed: DEFAULT_SEED,
    validIds: SOTA_RUNNER_IDS,
    usage: USAGE,
  });
  if (args.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.kind === 'error') {
    process.stderr.write(`${args.message}\n${USAGE}`);
    return 2;
  }

  const reports = runSotaSuite(
    args.seed,
    args.only as ReadonlyArray<SotaRunnerId> | undefined,
  );
  if (reports.length === 0) {
    process.stderr.write(`No runners selected.\n${USAGE}`);
    return 2;
  }

  const suite = finalizeSuite(SUITE, args.seed, reports);
  const dir = writeSuiteReports({ cwd: args.cwd, suite: SUITE, suiteReport: suite });

  if (!args.quiet) {
    for (const r of reports) {
      process.stdout.write(
        `[sota] ${r.runnerId}: ${r.passed ? 'PASS' : 'FAIL'} — ${r.summary}\n`,
      );
    }
    printSuiteLine('sota', suite, dir);
  }
  return suite.passed ? 0 : 1;
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`[sota] FATAL ${String(err)}\n`);
    process.exit(2);
  }
}
