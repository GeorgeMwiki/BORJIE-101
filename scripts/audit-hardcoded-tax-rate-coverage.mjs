#!/usr/bin/env node
/**
 * Universal hardcoded-tax-rate coverage scanner (Phase J7).
 *
 * Vision: tax rates are per-jurisdiction parameters that MUST live in
 * the compliance-plugin or jurisdictional-rules registry. A literal
 * `0.16` baked into a business path silently couples that path to one
 * country's VAT (Kenya is 16%, Tanzania is 18%, Nigeria is 7.5%).
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags any LINE that contains BOTH:
 *   - A tax-related identifier / comment fragment (VAT, WHT, taxRate,
 *     withhold, rentalIncomeTax, vatRate, taxDue, vatDue, etc.).
 *   - A numeric literal of decimal-tax shape: `0.[0-9]{2,4}`.
 *
 * This is the AST-shaped check: by requiring the tax-context identifier
 * AND the decimal-rate-shape on the same line, we avoid false-positives
 * on credit-scoring weights, grading deltas, ML weights, and the many
 * other places where `0.05` legitimately appears.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Files under `__tests__/`, `__fixtures__/`, `__mocks__/`.
 *   - Files ending in `.test.ts`, `.spec.ts`, etc.
 *   - The compliance-plugin directory tree:
 *     `packages/compliance-plugins/`.
 *   - The jurisdictional registry under
 *     `packages/domain-models/src/common/`.
 *   - Pure comment lines.
 *
 * Explicit allow-list:
 *   `scripts/__allowlists__/hardcoded-tax-rate-coverage-allowlist.mjs`
 *   — every entry carries an ≥ 8-character justification.
 *
 * Usage
 *   node scripts/audit-hardcoded-tax-rate-coverage.mjs --report .audit/hardcoded-tax-rate-coverage.json --summary .audit/hardcoded-tax-rate-coverage.md
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
import { HARDCODED_TAX_RATE_ALLOWLIST } from './__allowlists__/hardcoded-tax-rate-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Tax-context tokens that, if present on the same line as a decimal
// literal, signal a tax-rate computation. The non-word boundary on the
// right side accepts `WHT_RATE`, `VAT_RATE`, `tax_rate`, etc.
const TAX_CONTEXT_RX =
  /(?:^|[^A-Za-z0-9])(VAT|vat|WHT|wht|taxRate|TaxRate|TAX_RATE|taxDue|taxable|withhold|Withhold|withholding|Withholding|rentalIncomeTax|vatRate|vat_rate|VAT_RATE|incomeTax|gst|GST|salesTax)(?:$|[^A-Za-z0-9])/;

// Decimal-tax shape: `0.16`, `0.075`, `0.30`, also `0.1` / `0.2` /
// `0.3` when on a tax-context line (cheap-screen catches `WHT = 0.1` as
// a 10% rate). The TAX_CONTEXT_RX prefix-gate prevents this from
// false-positiving on `opacity: 0.5` or `probability: 0.3` outside tax.
// `0.0[1-9]\d?` covers fractions < 10% (`0.075`), `0.[1-3]\d?` covers
// 10-39% (the realistic VAT/withholding range).
const TAX_RATE_LITERAL_RX = /(?<![\d.])0\.(?:0[1-9]\d?|[1-3]\d?)(?![\d])/;

const REGISTRY_PATHS = [
  'packages/domain-models/src/common/jurisdictional-rules.ts',
  'packages/domain-models/src/common/region-config.ts',
];

const REGISTRY_PATH_PREFIXES = [
  'packages/compliance-plugins/',
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
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (!TAX_CONTEXT_RX.test(line)) continue;
    const m = line.match(TAX_RATE_LITERAL_RX);
    if (m) {
      hits.push({ line: i + 1, rate: m[0], snippet: line.trim().slice(0, 120) });
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
    if (HARDCODED_TAX_RATE_ALLOWLIST.has(rel)) {
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
  for (const p of HARDCODED_TAX_RATE_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'hardcoded-tax-rate-coverage',
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
      `audit-hardcoded-tax-rate-coverage: ${totalScanned} scanned (${totalTestSkipped} test, ${totalRegistrySkipped} registry, ${totalClean} clean, ${totalAllowlisted} allowlisted), ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file} (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        console.error(`      L${h.line} ${h.rate}: ${h.snippet}`);
      }
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Hardcoded-tax-rate-coverage audit');
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
        lines.push(`  - L${h.line} \`${h.rate}\`: \`${h.snippet}\``);
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
