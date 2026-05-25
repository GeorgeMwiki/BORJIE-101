#!/usr/bin/env node
/**
 * Universal hardcoded-locale coverage scanner (Phase J7).
 *
 * Vision: "locale follows the user". Business logic must resolve the
 * display locale through `JurisdictionalRules.for(country).defaultLocale`
 * or the user's `language_preference`. An `Intl.DateTimeFormat('en-KE')`
 * baked into a chart helper silently breaks for every other jurisdiction.
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags any line containing a quoted BCP-47 locale tag literal
 * matching the shape `xx-XX` (e.g. `'en-KE'`, `'sw-TZ'`, `'en-US'`).
 *
 * Auto-allowlisted (NOT a violation):
 *   - Files under `__tests__/`, `__fixtures__/`, `__mocks__/`.
 *   - Files ending in `.test.ts`, `.spec.ts`, `.fixture.ts`, etc.
 *   - i18n bundle directories: `apps/* /src/i18n/`,
 *     `packages/i18n/`, `**\/locales/`, `**\/messages/`.
 *   - The jurisdictional registry under
 *     `packages/domain-models/src/common/{jurisdictional-rules,region-config}.ts`.
 *   - Per-country plugin scaffolds under `packages/compliance-plugins/`.
 *   - Pure comment lines.
 *   - Lines inside Zod schema declarations (`z.enum(['en-KE',...])`).
 *
 * Explicit allow-list:
 *   `scripts/__allowlists__/hardcoded-locale-coverage-allowlist.mjs`
 *   — every entry carries an ≥ 8-character justification.
 *
 * Usage
 *   node scripts/audit-hardcoded-locale-coverage.mjs --report .audit/hardcoded-locale-coverage.json --summary .audit/hardcoded-locale-coverage.md
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
import { HARDCODED_LOCALE_ALLOWLIST } from './__allowlists__/hardcoded-locale-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// BCP-47 locale tag shape: lower-case lang + dash + upper-case region.
// Anchored to quote-bound string literals; standalone identifiers like
// `enKE` are NOT matched.
const LOCALE_RX = /(['"`])([a-z]{2}-[A-Z]{2})\1/;

const ZOD_OR_ENUM_LINE_RX =
  /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\bz\.\s*tuple\b|as\s+const|\.\s*default\s*\(\s*['"`][a-z]{2}-[A-Z]{2}['"`])/;

const TYPE_UNION_LINE_RX =
  /type\s+\w+\s*=|\breadonly\s+\w+\s*:\s*['"`][a-z]{2}-[A-Z]{2}['"`]\s*\|/;

const REGISTRY_PATHS = [
  'packages/domain-models/src/common/jurisdictional-rules.ts',
  'packages/domain-models/src/common/region-config.ts',
];

const REGISTRY_PATH_PREFIXES = [
  'packages/compliance-plugins/src/countries/',
  'packages/compliance-plugins/scripts/',
];

// Directory-name fragments that signal i18n bundle territory.
const I18N_DIR_FRAGMENTS = [
  `${sep}i18n${sep}`,
  `${sep}locales${sep}`,
  `${sep}messages${sep}`,
  `${sep}translations${sep}`,
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

function isI18nBundlePath(rel) {
  const normalised = sep === '/' ? rel : rel.split('/').join(sep);
  for (const f of I18N_DIR_FRAGMENTS) {
    if (normalised.includes(f)) return true;
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
    if (ZOD_OR_ENUM_LINE_RX.test(line)) continue;
    if (TYPE_UNION_LINE_RX.test(line)) continue;
    const m = line.match(LOCALE_RX);
    if (m) {
      hits.push({ line: i + 1, tag: m[2], snippet: line.trim().slice(0, 120) });
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
  let totalI18nSkipped = 0;
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
    if (isI18nBundlePath(rel)) {
      totalI18nSkipped++;
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const hits = scanFile(src);
    if (hits.length === 0) {
      totalClean++;
      continue;
    }
    if (HARDCODED_LOCALE_ALLOWLIST.has(rel)) {
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
  for (const p of HARDCODED_LOCALE_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'hardcoded-locale-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
      registrySkipped: totalRegistrySkipped,
      i18nSkipped: totalI18nSkipped,
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
      `audit-hardcoded-locale-coverage: ${totalScanned} scanned (${totalTestSkipped} test, ${totalRegistrySkipped} registry, ${totalI18nSkipped} i18n, ${totalClean} clean, ${totalAllowlisted} allowlisted), ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file} (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        console.error(`      L${h.line} '${h.tag}': ${h.snippet}`);
      }
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Hardcoded-locale-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| files scanned | ${report.totals.scanned} |`);
  lines.push(`| test/fixture skipped | ${report.totals.testSkipped} |`);
  lines.push(`| registry skipped | ${report.totals.registrySkipped} |`);
  lines.push(`| i18n-bundle skipped | ${report.totals.i18nSkipped} |`);
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
        lines.push(`  - L${h.line} \`'${h.tag}'\`: \`${h.snippet}\``);
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
