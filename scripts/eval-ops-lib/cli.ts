/**
 * Shared CLI plumbing for the eval-ops release-gate runners (LP-22a).
 *
 * Argument parsing is pure + total (returns a tagged union; never throws,
 * never calls `process.exit`) so it is unit-testable. The caller maps the
 * parsed result to an exit code.
 *
 * @module eval-ops-lib/cli
 */

import {
  renderSuiteMarkdown,
  utcDate,
  type RunnerReport,
  type SuiteReport,
} from './report.js';

export type ParsedEvalArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'run';
      readonly seed: number;
      readonly only: ReadonlyArray<string> | undefined;
      readonly cwd: string;
      readonly quiet: boolean;
    };

export interface ParseEvalArgsOpts {
  readonly defaultSeed: number;
  readonly validIds: ReadonlyArray<string>;
  readonly usage: string;
}

/**
 * Parse `[--seed N] [--only a,b] [--out DIR] [--quiet] [-h|--help]`.
 *
 * Unknown `--only` ids and a non-numeric `--seed` are reported as errors so
 * a typo can't silently run the wrong (or empty) set in CI.
 */
export function parseEvalArgs(
  argv: ReadonlyArray<string>,
  opts: ParseEvalArgsOpts,
): ParsedEvalArgs {
  let seed = opts.defaultSeed;
  let only: ReadonlyArray<string> | undefined;
  let cwd = process.cwd();
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { kind: 'help' };
    if (a === '--quiet') {
      quiet = true;
      continue;
    }
    if (a === '--seed' || a?.startsWith('--seed=')) {
      const raw = a.includes('=') ? a.split('=')[1] : argv[++i];
      const n = Number.parseInt(raw ?? '', 10);
      if (!Number.isFinite(n)) {
        return { kind: 'error', message: `--seed expects an integer, got '${raw}'.` };
      }
      seed = n;
      continue;
    }
    if (a === '--only' || a?.startsWith('--only=')) {
      const raw = a.includes('=') ? a.split('=')[1] : argv[++i];
      const ids = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = ids.filter((id) => !opts.validIds.includes(id));
      if (unknown.length > 0) {
        return {
          kind: 'error',
          message: `Unknown runner id(s): ${unknown.join(', ')}. Valid: ${opts.validIds.join(', ')}.`,
        };
      }
      only = ids;
      continue;
    }
    if (a === '--out' || a?.startsWith('--out=')) {
      const raw = a.includes('=') ? a.split('=')[1] : argv[++i];
      if (raw) cwd = raw;
      continue;
    }
    return { kind: 'error', message: `Unknown argument '${a}'.` };
  }

  return { kind: 'run', seed, only, cwd, quiet };
}

/** Roll runner reports into a {@link SuiteReport}. */
export function finalizeSuite(
  suite: string,
  seed: number,
  reports: ReadonlyArray<RunnerReport>,
  now: Date = new Date(),
): SuiteReport {
  return {
    suite,
    seed,
    generatedAt: now.toISOString(),
    reports,
    passed: reports.every((r) => r.passed),
  };
}

/** Print the one-line suite verdict to stdout. */
export function printSuiteLine(
  label: string,
  suite: SuiteReport,
  dir: string,
): void {
  process.stdout.write(
    `[${label}] suite ${suite.passed ? 'PASS' : 'FAIL'} ` +
      `(${suite.reports.filter((r) => r.passed).length}/${suite.reports.length}) — ${dir}\n`,
  );
}

/** Re-export for callers that want to render without writing. */
export { renderSuiteMarkdown, utcDate };
