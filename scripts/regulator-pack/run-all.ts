/**
 * Deterministic regulator-readiness release gate (LP-16 consumer).
 *
 * This is the first real consumer of `@borjie/regulator-sim` (audit-replay +
 * supervision pack + PDPA drills) and `@borjie/blind-review` (M5
 * indistinguishability panel) — both were built + tested but orphaned. It runs
 * each as a release-gate runner and writes one Markdown report per runner plus
 * a suite index to:
 *
 *   Docs/parity-tests/regulator/results/<YYYY-MM-DD>/<runner-id>.md
 *   Docs/parity-tests/regulator/results/<YYYY-MM-DD>/_suite.md
 *
 * Exit code: 0 if every runner passes, 1 if any fail, 2 on bad args / fatal.
 * Fully seeded with an injected clock — no network, no DB — so CI can gate a
 * release on it reproducibly.
 *
 * Usage:
 *   tsx scripts/regulator-pack/run-all.ts [--seed N] [--only id,id]
 *        [--from ISO] [--to ISO] [--now ISO] [--count N] [--blind-limit N]
 *        [--out DIR] [--quiet]
 *
 * @module regulator-pack/run-all
 */

import { pathToFileURL } from 'node:url';
import {
  finalizeSuite,
  parseEvalArgs,
  printSuiteLine,
} from '../eval-ops-lib/cli.js';
import { writeSuiteReports } from '../eval-ops-lib/report.js';
import {
  REGULATOR_RUNNER_IDS,
  runRegulatorSuite,
  type RegulatorRunnerId,
} from './runners.js';

const SUITE = 'regulator';
const DEFAULT_SEED = 20260603;

/** Default audit-replay window + clock — overridable for reproducible CI. */
const DEFAULT_FROM_ISO = '2026-01-01T00:00:00.000Z';
const DEFAULT_TO_ISO = '2026-06-03T00:00:00.000Z';
const DEFAULT_NOW_ISO = '2026-06-03T12:00:00.000Z';
const DEFAULT_DECISION_COUNT = 120;
const DEFAULT_BLIND_LIMIT = 100;

const USAGE = `Regulator-readiness release gate

Usage:
  tsx scripts/regulator-pack/run-all.ts [--seed N] [--only id,id,...]

Options:
  --seed N         Deterministic seed (default ${DEFAULT_SEED})
  --only ids       Comma-separated runner ids. Valid:
                   ${REGULATOR_RUNNER_IDS.join(', ')}
  --from ISO       Audit-replay window start (default ${DEFAULT_FROM_ISO})
  --to ISO         Audit-replay window end (default ${DEFAULT_TO_ISO})
  --now ISO        Injected clock for freshness/timestamps (default ${DEFAULT_NOW_ISO})
  --count N        Synthetic decisions to replay (default ${DEFAULT_DECISION_COUNT})
  --blind-limit N  Blind-review records per reviewer (default ${DEFAULT_BLIND_LIMIT})
  --out DIR        Override the repo root used to resolve the results dir.
  --quiet          Suppress per-runner stdout.
  -h, --help       Show this help.

Outputs:
  Docs/parity-tests/regulator/results/<YYYY-MM-DD>/<runner-id>.md
  Docs/parity-tests/regulator/results/<YYYY-MM-DD>/_suite.md
`;

/** Extra args this gate accepts beyond the shared eval-ops parser. */
interface RegulatorExtras {
  readonly fromIso: string;
  readonly toIso: string;
  readonly nowIso: string;
  readonly decisionCount: number;
  readonly blindLimit: number;
}

type ExtrasResult =
  | { readonly kind: 'ok'; readonly extras: RegulatorExtras }
  | { readonly kind: 'error'; readonly message: string };

/** The flags consumed by the shared parser — skip them + their values here. */
const SHARED_VALUE_FLAGS: ReadonlyArray<string> = ['--seed', '--only', '--out'];

/** Return `raw` if it parses as a date, else `null` (caller reports which flag). */
function parseIso(raw: string | undefined): string | null {
  if (raw === undefined || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

/**
 * Parse the regulator-only flags. Pure + total: returns a tagged union and
 * never throws, mirroring the shared `parseEvalArgs` contract.
 */
function parseExtras(argv: ReadonlyArray<string>): ExtrasResult {
  let fromIso = DEFAULT_FROM_ISO;
  let toIso = DEFAULT_TO_ISO;
  let nowIso = DEFAULT_NOW_ISO;
  let decisionCount = DEFAULT_DECISION_COUNT;
  let blindLimit = DEFAULT_BLIND_LIMIT;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const readValue = (): string | undefined =>
      a?.includes('=') ? a.split('=')[1] : argv[++i];

    if (a === '--from' || a?.startsWith('--from=')) {
      const v = parseIso(readValue());
      if (v === null) return { kind: 'error', message: `--from expects an ISO date.` };
      fromIso = v;
    } else if (a === '--to' || a?.startsWith('--to=')) {
      const v = parseIso(readValue());
      if (v === null) return { kind: 'error', message: `--to expects an ISO date.` };
      toIso = v;
    } else if (a === '--now' || a?.startsWith('--now=')) {
      const v = parseIso(readValue());
      if (v === null) return { kind: 'error', message: `--now expects an ISO date.` };
      nowIso = v;
    } else if (a === '--count' || a?.startsWith('--count=')) {
      const n = Number.parseInt(readValue() ?? '', 10);
      if (!Number.isFinite(n) || n <= 0) {
        return { kind: 'error', message: `--count expects a positive integer.` };
      }
      decisionCount = n;
    } else if (a === '--blind-limit' || a?.startsWith('--blind-limit=')) {
      const n = Number.parseInt(readValue() ?? '', 10);
      if (!Number.isFinite(n) || n <= 0) {
        return { kind: 'error', message: `--blind-limit expects a positive integer.` };
      }
      blindLimit = n;
    }
    // Anything else is the shared parser's concern (handled below).
  }

  if (Date.parse(toIso) <= Date.parse(fromIso)) {
    return { kind: 'error', message: `--to must be after --from.` };
  }
  return {
    kind: 'ok',
    extras: { fromIso, toIso, nowIso, decisionCount, blindLimit },
  };
}

/**
 * Strip the regulator-only flags (and their values) before handing argv to the
 * shared parser, which would otherwise reject them as unknown arguments.
 */
function stripExtras(argv: ReadonlyArray<string>): ReadonlyArray<string> {
  const REGULATOR_VALUE_FLAGS = ['--from', '--to', '--now', '--count', '--blind-limit'];
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    const bare = a.includes('=') ? a.split('=')[0] : a;
    if (REGULATOR_VALUE_FLAGS.includes(bare)) {
      // Drop the flag; if it used a separate token for its value, drop that too.
      if (!a.includes('=')) i++;
      continue;
    }
    out.push(a);
    // Keep the shared parser's own value tokens intact (they are not ours).
    if (!a.includes('=') && SHARED_VALUE_FLAGS.includes(a)) {
      const next = argv[i + 1];
      if (next !== undefined) {
        out.push(next);
        i++;
      }
    }
  }
  return out;
}

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const args = parseEvalArgs(stripExtras(argv), {
    defaultSeed: DEFAULT_SEED,
    validIds: REGULATOR_RUNNER_IDS,
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

  const extras = parseExtras(argv);
  if (extras.kind === 'error') {
    process.stderr.write(`${extras.message}\n${USAGE}`);
    return 2;
  }

  const reports = await runRegulatorSuite(
    {
      seed: args.seed,
      fromIso: extras.extras.fromIso,
      toIso: extras.extras.toIso,
      nowIso: extras.extras.nowIso,
      decisionCount: extras.extras.decisionCount,
      blindLimit: extras.extras.blindLimit,
    },
    args.only as ReadonlyArray<RegulatorRunnerId> | undefined,
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
        `[regulator] ${r.runnerId}: ${r.passed ? 'PASS' : 'FAIL'} — ${r.summary}\n`,
      );
    }
    printSuiteLine('regulator', suite, dir);
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
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`[regulator] FATAL ${String(err)}\n`);
      process.exit(2);
    });
}
