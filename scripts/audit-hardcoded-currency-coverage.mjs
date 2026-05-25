#!/usr/bin/env node
/**
 * Universal hardcoded-currency coverage scanner (Phase J7).
 *
 * Vision: "currency follows the user". Business logic must resolve currency
 * through the `currency_preferences` chain (user → tenant → platform default)
 * and FX conversion via `normaliseTo(target, sums)`. A literal `'KES'`
 * baked into a route handler defeats that chain.
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags any line containing a quoted ISO-4217 currency code literal
 * (`'KES'`, `'TZS'`, `'USD'`, `'EUR'`, `'NGN'`, `'UGX'`, `'GHS'`, `'ZAR'`,
 * `'RWF'`, `'XAF'`, `'XOF'`, also "...").
 *
 * Auto-allowlisted (NOT a violation):
 *   - Files under `__tests__/`, `__fixtures__/`, `__mocks__/`.
 *   - Files ending in `.test.ts`, `.spec.ts`, `.fixture.ts`, etc.
 *   - The jurisdictional registry: `packages/domain-models/src/common/jurisdictional-rules.ts`,
 *     `packages/domain-models/src/common/region-config.ts`,
 *     `packages/domain-models/src/common/currencies.ts`.
 *   - Pure comment lines.
 *   - Lines that are inside a Zod schema declaration: `z.literal('KES')`,
 *     `z.enum([...,'KES',...])`, `currency: z.literal('KES')`.
 *
 * Explicit allow-list:
 *   `scripts/__allowlists__/hardcoded-currency-coverage-allowlist.mjs`
 *   — every entry carries an ≥ 8-character justification.
 *
 * Mirror of PR #95 H13 currency-unhardcoding fix.
 *
 * Usage
 *   node scripts/audit-hardcoded-currency-coverage.mjs --report .audit/hardcoded-currency-coverage.json --summary .audit/hardcoded-currency-coverage.md
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
import { HARDCODED_CURRENCY_ALLOWLIST } from './__allowlists__/hardcoded-currency-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ISO-4217 codes the platform actively supports + a few global majors that
// commonly appear as targets in FX flows.
const CURRENCY_CODES = [
  'KES',
  'TZS',
  'USD',
  'EUR',
  'NGN',
  'UGX',
  'GHS',
  'ZAR',
  'RWF',
  'XAF',
  'XOF',
  'GBP',
];

// Match a quoted code as a standalone string literal — single, double, or
// backtick-delimited — with negative look-behinds that excise codes that
// are part of a larger identifier (e.g. `KES_RATE_FALLBACK`).
const CURRENCY_RX = new RegExp(
  `(['"\`])(${CURRENCY_CODES.join('|')})\\1`,
);

// Zod / enum-style declarations are auto-allowed at the LINE level — these
// are valid currency-code enumerations, not hardcoded business defaults.
// `.default('USD')` chained on a `z.string()` / `z.enum()` is also allowed:
// per PR #95 H13, currency defaults belong at the schema boundary.
const ZOD_OR_ENUM_LINE_RX =
  /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\bz\.\s*tuple\b|as\s+const|\.\s*default\s*\(\s*['"`][A-Z]{3}['"`]|CurrencyCodeSchema\s*\.\s*default\s*\()/;

// Type-only union: e.g. `'KES' | 'TZS' | 'UGX'`. The line ALSO contains a
// `:` or `=` (type alias / parameter) and no executable assignment.
const TYPE_UNION_LINE_RX =
  /(?:type\s+\w+\s*=|\breadonly\s+\w+\s*:|\bcurrency\s*:\s*['"`][A-Z]{3}['"`]\s*\|)/;

// Paths that are the SOURCE OF TRUTH for currency-code mapping. These are
// auto-allowed (registry pattern).
const REGISTRY_PATHS = [
  'packages/domain-models/src/common/jurisdictional-rules.ts',
  'packages/domain-models/src/common/region-config.ts',
  'packages/domain-models/src/common/currencies.ts',
];

// Path PREFIXES that are auto-allowed because the directory IS the per-
// country registry / plugin scaffolds (compliance-plugins houses one
// directory per ISO country code; each file legitimately declares the
// currency for ITS country only).
const REGISTRY_PATH_PREFIXES = [
  'packages/compliance-plugins/src/countries/',
  'packages/compliance-plugins/scripts/',
];

const TEST_DIR_NAMES = new Set([
  '__tests__',
  '__fixtures__',
  '__mocks__',
  'test',
  'tests',
  '__bench__',
]);

const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.bench.ts',
  '.fixture.ts',
  '.fixtures.ts',
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'build',
  'coverage',
  '.audit',
]);

function isTestPath(rel) {
  const parts = rel.split(sep);
  for (const p of parts) if (TEST_DIR_NAMES.has(p)) return true;
  for (const s of TEST_FILE_SUFFIXES) if (rel.endsWith(s)) return true;
  return false;
}

function isRegistryPath(rel) {
  if (REGISTRY_PATHS.includes(rel)) return true;
  for (const prefix of REGISTRY_PATH_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
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
  return (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts');
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
    const trimmed = line.trim();
    // Skip comment lines.
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) continue;
    // Skip Zod-schema / enum declarations.
    if (ZOD_OR_ENUM_LINE_RX.test(line)) continue;
    // Skip type-union declarations.
    if (TYPE_UNION_LINE_RX.test(line)) continue;
    // Skip explicit currency-mapping object literals where keys are country
    // codes (e.g. `KE: { currencyCode: 'KES' }`). These mappings only appear
    // in registry files — for any other file we *want* to flag them.
    const m = line.match(CURRENCY_RX);
    if (m) {
      hits.push({ line: i + 1, code: m[2], snippet: line.trim().slice(0, 120) });
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
  let totalRegistrySkipped = 0;
  let totalAllowlisted = 0;
  let totalClean = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    totalScanned++;
    if (isTestPath(rel)) {
      totalTestSkipped++;
      continue;
    }
    if (isRegistryPath(rel)) {
      totalRegistrySkipped++;
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const hits = scanFile(src);
    if (hits.length === 0) {
      totalClean++;
      continue;
    }
    if (HARDCODED_CURRENCY_ALLOWLIST.has(rel)) {
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
  for (const p of HARDCODED_CURRENCY_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'hardcoded-currency-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
      registrySkipped: totalRegistrySkipped,
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
      `audit-hardcoded-currency-coverage: ${totalScanned} scanned (${totalTestSkipped} test, ${totalRegistrySkipped} registry, ${totalClean} clean, ${totalAllowlisted} allowlisted), ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file} (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        console.error(`      L${h.line} '${h.code}': ${h.snippet}`);
      }
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Hardcoded-currency-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| files scanned | ${report.totals.scanned} |`);
  lines.push(`| test/fixture skipped | ${report.totals.testSkipped} |`);
  lines.push(`| registry skipped | ${report.totals.registrySkipped} |`);
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
        lines.push(`  - L${h.line} \`'${h.code}'\`: \`${h.snippet}\``);
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
