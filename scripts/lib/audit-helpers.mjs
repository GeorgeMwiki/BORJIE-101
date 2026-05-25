/**
 * Shared helpers for zero-hardcoded scanners (Piece P).
 *
 * Centralises the directory walk, test/fixture skip rules, and the JSON
 * report shape used by every `audit-hardcoded-*` script. Mirrors the
 * pattern already established by audit-hardcoded-currency-coverage.mjs
 * and audit-mock-data-coverage.mjs — they intentionally do NOT depend
 * on this module (those scanners are frozen by their respective PRs)
 * but every new Piece P scanner SHOULD import from here.
 *
 * Pure ES modules, no third-party imports.
 */

import {
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const TEST_DIR_NAMES = new Set([
  '__tests__',
  '__fixtures__',
  '__mocks__',
  'test',
  'tests',
  '__bench__',
]);

export const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.bench.ts',
  '.fixture.ts',
  '.fixtures.ts',
  '.mock.ts',
  '.stories.ts',
  '.stories.tsx',
];

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.audit',
  '.cache',
  'build',
  'coverage',
  '.git',
]);

/**
 * Walk a directory tree, collecting every file that matches `predicate`.
 * Pure recursive function; mutation kept local to `out`.
 */
export function walkDir(dir, predicate, out) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDir(full, predicate, out);
    else if (predicate(full, name)) out.push(full);
  }
}

/**
 * Standard "TypeScript or TSX, not a .d.ts" predicate.
 */
export function isProductionTsLike(_full, name) {
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !name.endsWith('.d.ts')
  );
}

/**
 * Path relative to `ROOT` that lives under a test/fixture/mocks dir or
 * has a test-suffix file name. Used by every scanner to auto-skip
 * non-production files before scanning.
 */
export function isTestPath(rel) {
  const parts = rel.split(sep);
  for (const p of parts) if (TEST_DIR_NAMES.has(p)) return true;
  for (const s of TEST_FILE_SUFFIXES) if (rel.endsWith(s)) return true;
  return false;
}

/**
 * Discover every production TypeScript/TSX file under the standard
 * top-level workspaces (packages/, services/, apps/).
 */
export function discoverProductionFiles(root, tops = ['packages', 'services', 'apps']) {
  const files = [];
  for (const top of tops) walkDir(join(root, top), isProductionTsLike, files);
  return files;
}

/**
 * Parse the standard scanner CLI flags.
 *   --report <path>   — write the JSON report here
 *   --summary <path>  — write the markdown summary here
 *   --json            — print the JSON report to stdout
 *   --strict          — exit non-zero on ANY violation (default true)
 *   --root <dir>      — override the scan root (used by tests)
 */
export function parseArgs(argv) {
  const out = {
    report: null,
    summary: null,
    json: false,
    strict: true,
    root: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--no-strict') out.strict = false;
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

/**
 * `mkdirSync(path, { recursive: true })` for the dirname of `p`.
 */
export function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/**
 * Read a UTF-8 file and split into lines preserving the original index.
 */
export function readLines(file) {
  return readFileSync(file, 'utf8').split('\n');
}

/**
 * Build a standard report object — the canonical shape every Piece P
 * scanner emits.
 */
export function buildReport(scanner, totals, violations, staleAllowlist) {
  return {
    scanner,
    scannedAt: new Date().toISOString(),
    totals,
    violations,
    staleAllowlist,
  };
}

/**
 * Render a generic markdown summary for any scanner report.
 */
export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.scanner} audit`);
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  for (const [key, value] of Object.entries(report.totals)) {
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    for (const v of report.violations) {
      const hitCount = v.hitCount ?? (v.hits?.length ?? 0);
      lines.push(`- [${v.severity}] \`${v.file}\` (${hitCount} hit${hitCount === 1 ? '' : 's'})`);
      for (const h of (v.hits ?? []).slice(0, 3)) {
        const detail = h.code ? `\`${h.code}\`` : '';
        lines.push(`  - L${h.line} ${detail}: \`${h.snippet}\``);
      }
    }
    lines.push('');
  }
  if (report.staleAllowlist?.length > 0) {
    lines.push('## Stale allowlist entries');
    lines.push('');
    for (const p of report.staleAllowlist) lines.push(`- \`${p}\``);
  }
  return lines.join('\n');
}

/**
 * Emit the report (optionally to disk) and human-readable summary to
 * stderr. Returns the pass/fail boolean — caller chooses how to map to
 * an exit code.
 */
export function emitReport(args, report, options = {}) {
  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }

  const passed =
    report.violations.length === 0 &&
    (report.staleAllowlist?.length ?? 0) === 0;

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const t = report.totals;
    const parts = Object.entries(t).map(([k, v]) => `${k}=${v}`);
    process.stderr.write(
      `${report.scanner}: ${parts.join(' ')} — ${passed ? 'PASS' : 'FAIL'}\n`,
    );
    const max = options.maxVerbose ?? 30;
    for (const v of report.violations.slice(0, max)) {
      const hitCount = v.hitCount ?? (v.hits?.length ?? 0);
      process.stderr.write(
        `  [${v.severity}] ${v.file} (${hitCount} hit${hitCount === 1 ? '' : 's'})\n`,
      );
      for (const h of (v.hits ?? []).slice(0, 3)) {
        const code = h.code ? ` '${h.code}'` : '';
        process.stderr.write(`      L${h.line}${code}: ${h.snippet}\n`);
      }
    }
    if (report.violations.length > max) {
      process.stderr.write(
        `  ... and ${report.violations.length - max} more\n`,
      );
    }
    for (const s of report.staleAllowlist ?? []) {
      process.stderr.write(`  [STALE ALLOWLIST] ${s}\n`);
    }
  }

  return passed;
}

/**
 * Standard stale-allowlist computation: every key in `allowlist` whose
 * path no longer exists on disk.
 */
export function computeStaleAllowlist(root, allowlist) {
  const stale = [];
  for (const p of allowlist.keys()) {
    if (!existsSync(join(root, p))) stale.push(p);
  }
  return stale;
}

/**
 * Format a path relative to `root` for cross-platform-stable reporting.
 */
export function rel(root, full) {
  return relative(root, full);
}
