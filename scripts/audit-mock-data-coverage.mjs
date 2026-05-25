#!/usr/bin/env node
/**
 * Universal mock-data coverage scanner (Phase J7).
 *
 * Vision: "no MOCK DATA, no hardcoded fallbacks anywhere across the platform."
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags any reference to:
 *   - identifier `mockData` (lower-camel)
 *   - any identifier starting with `MOCK_` (screaming-snake)
 *   - a relative path containing `__mocks__/`
 *
 * Auto-allowlisted (NOT a violation):
 *   - Files under `__tests__/`, `__fixtures__/`, `__mocks__/` directories.
 *   - Files ending in `.test.ts`, `.spec.ts`, `.test.tsx`, `.spec.tsx`,
 *     `.bench.ts`, `.fixture.ts`, `.fixtures.ts`.
 *
 * Explicit allow-list:
 *   `scripts/__allowlists__/mock-data-coverage-allowlist.mjs` — every entry
 *   carries an ≥ 8-character justification (env-flag plumbing, sandbox HTTP
 *   header constants, empty-array sentinels).
 *
 * Usage
 *   node scripts/audit-mock-data-coverage.mjs --report .audit/mock-data-coverage.json --summary .audit/mock-data-coverage.md
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_DATA_ALLOWLIST } from './__allowlists__/mock-data-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Production violation patterns. Each must have word-boundary anchoring so
// we never spuriously match `unmockable` or `aMockDataset`.
const MOCK_PATTERNS = [
  // Lower-camel identifier `mockData` as a standalone word.
  { name: 'mockData-identifier', rx: /\bmockData\b/ },
  // Screaming-snake `MOCK_<rest>` (e.g. MOCK_USERS, MOCK_PAYMENTS).
  { name: 'MOCK_-constant', rx: /\bMOCK_[A-Z][A-Z0-9_]*/ },
  // Import / require of a `__mocks__/` directory.
  { name: '__mocks__-import', rx: /['"][^'"]*__mocks__\/[^'"]*['"]/ },
];

// Directory names that auto-allowlist a file (test / fixture territory).
const TEST_DIR_NAMES = new Set([
  '__tests__',
  '__fixtures__',
  '__mocks__',
  'test',
  'tests',
  '__bench__',
]);

// File-name suffixes that auto-allowlist a file.
const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.bench.ts',
  '.fixture.ts',
  '.fixtures.ts',
  '.mock.ts',
];

// Directory names skipped entirely during the walk.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'build',
  'coverage',
  '.audit',
]);

function isTestFile(rel) {
  const parts = rel.split(sep);
  for (const p of parts) {
    if (TEST_DIR_NAMES.has(p)) return true;
  }
  for (const s of TEST_FILE_SUFFIXES) {
    if (rel.endsWith(s)) return true;
  }
  return false;
}

function walkDir(dir, predicate, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
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

function isProductionTsLike(_full, name) {
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !name.endsWith('.d.ts')
  );
}

function discoverFiles() {
  const files = [];
  for (const top of ['packages', 'services', 'apps']) {
    walkDir(join(ROOT, top), isProductionTsLike, files);
  }
  return files;
}

function scanFile(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comment lines — `// MOCK_FOO` as documentation.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    for (const { name, rx } of MOCK_PATTERNS) {
      const m = line.match(rx);
      if (m) {
        hits.push({ pattern: name, line: i + 1, match: m[0] });
        break;
      }
    }
  }
  return hits;
}

function parseArgs(argv) {
  const out = { report: null, summary: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const files = discoverFiles();
  const violations = [];
  let totalScanned = 0;
  let totalTestSkipped = 0;
  let totalAllowlisted = 0;
  let totalClean = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    totalScanned++;
    if (isTestFile(rel)) {
      totalTestSkipped++;
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const hits = scanFile(src);
    if (hits.length === 0) {
      totalClean++;
      continue;
    }
    if (MOCK_DATA_ALLOWLIST.has(rel)) {
      totalAllowlisted++;
      continue;
    }
    violations.push({
      file: rel,
      severity: 'HIGH',
      hits: hits.slice(0, 10),
      hitCount: hits.length,
    });
  }

  const staleAllowlist = [];
  for (const p of MOCK_DATA_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'mock-data-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
      clean: totalClean,
      allowlisted: totalAllowlisted,
      violations: violations.length,
    },
    violations,
    staleAllowlist,
  };

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }

  const passed = violations.length === 0 && staleAllowlist.length === 0;
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-mock-data-coverage: ${totalScanned} scanned (${totalTestSkipped} test, ${totalClean} clean, ${totalAllowlisted} allowlisted), ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file} (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        console.error(`      L${h.line} [${h.pattern}] ${h.match}`);
      }
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Mock-data-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| files scanned | ${report.totals.scanned} |`);
  lines.push(`| test/fixture skipped | ${report.totals.testSkipped} |`);
  lines.push(`| clean | ${report.totals.clean} |`);
  lines.push(`| allowlisted | ${report.totals.allowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    for (const v of report.violations) {
      lines.push(`- [${v.severity}] \`${v.file}\` (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        lines.push(`  - L${h.line} \`${h.pattern}\`: \`${h.match}\``);
      }
    }
    lines.push('');
  }
  if (report.staleAllowlist.length > 0) {
    lines.push('## Stale allowlist entries');
    lines.push('');
    for (const p of report.staleAllowlist) lines.push(`- \`${p}\``);
  }
  return lines.join('\n');
}

main();
