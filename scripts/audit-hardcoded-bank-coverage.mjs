#!/usr/bin/env node
/**
 * Universal hardcoded-bank/provider coverage scanner (Phase J7).
 *
 * Vision: provider routing must go through the connector registry at
 * `packages/connectors/src/registry.ts`. Concrete provider names belong
 * inside `packages/connectors/src/adapters/`. A literal `'mpesa'` baked
 * into a business path silently couples that path to one provider.
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags any line containing a quoted provider/authority literal:
 *   - Payment rails: 'mpesa', 'airtel', 'tigopesa', 'halotel', 't-kash',
 *     'pesalink', 'opay', 'flutterwave', 'paystack'
 *   - Tax authorities: 'kra', 'tra', 'firs', 'sars', 'ura'
 *   - KYC / ID providers: 'nida', 'nggis', 'huduma'
 *   - Pay-gov platforms: 'gepg', 'remita'
 *
 * Auto-allowlisted (NOT a violation):
 *   - Files under `__tests__/`, `__fixtures__/`, `__mocks__/`.
 *   - Files ending in `.test.ts`, `.spec.ts`, etc.
 *   - The connector adapter directory:
 *     `packages/connectors/src/adapters/`,
 *     `packages/connectors/src/registry.ts`.
 *   - Per-provider adapter modules under `services/payments/src/providers/`,
 *     `services/mcp-server-*`, and `services/api-gateway/src/services/payouts/providers/`.
 *   - The jurisdictional registry under `packages/domain-models/src/common/`.
 *   - Per-country plugin scaffolds under `packages/compliance-plugins/`.
 *   - Pure comment lines.
 *   - Lines inside Zod schema declarations.
 *
 * Explicit allow-list:
 *   `scripts/__allowlists__/hardcoded-bank-coverage-allowlist.mjs`
 *   — every entry carries an ≥ 8-character justification.
 *
 * Usage
 *   node scripts/audit-hardcoded-bank-coverage.mjs --report .audit/hardcoded-bank-coverage.json --summary .audit/hardcoded-bank-coverage.md
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
import { HARDCODED_BANK_ALLOWLIST } from './__allowlists__/hardcoded-bank-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Lower-case provider literals the platform must route through the
// connector registry. Names chosen as the canonical lower-case slug each
// adapter exports.
const PROVIDER_TOKENS = [
  // Payment rails
  'mpesa',
  'airtel-money',
  'tigopesa',
  'halotel',
  'pesalink',
  'opay',
  'flutterwave',
  'paystack',
  // Tax authorities
  'kra',
  'tra',
  'firs',
  'sars',
  'ura',
  // KYC / ID providers
  'nida',
  'nggis',
  'huduma',
  // Pay-gov gateways
  'gepg',
  'remita',
];

// Match the lower-case token as a quoted string literal, with word
// boundaries to avoid matching `mpesa_pin` (an underscore identifier).
const PROVIDER_RX = new RegExp(
  `(['"\`])(${PROVIDER_TOKENS.join('|')})\\1`,
);

// Zod-line auto-allow: any `z.enum([...])` / `z.literal('mpesa')` line is
// the schema enumeration, not a routing decision.
const ZOD_OR_ENUM_LINE_RX =
  /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\bz\.\s*tuple\b|as\s+const|\bkeywords\s*:\s*\[|\bre\s*:\s*\/)/;

// Type-union line: `type Foo = 'mpesa' | 'airtel' | ...`.
const TYPE_UNION_LINE_RX =
  /(?:type\s+\w+\s*=|\|\s*['"`](?:mpesa|airtel-money|kra|tra|nida|nggis|huduma|gepg|opay|firs|sars|ura|halotel|pesalink|tigopesa|flutterwave|paystack|remita)['"`])/;

const REGISTRY_PATHS = [
  'packages/connectors/src/registry.ts',
  'packages/domain-models/src/common/jurisdictional-rules.ts',
  'packages/domain-models/src/common/region-config.ts',
];

const REGISTRY_PATH_PREFIXES = [
  'packages/connectors/src/adapters/',
  'packages/compliance-plugins/src/countries/',
  'packages/compliance-plugins/scripts/',
  'packages/compliance-plugins/src/plugins/',
  // Each subdirectory under services/payments/src/providers/ is one rail's
  // wire-protocol adapter — the literal IS the adapter's identity.
  'services/payments/src/providers/',
  // Same for the api-gateway payout providers.
  'services/api-gateway/src/services/payouts/providers/',
  // MCP server adapters: one MCP server per provider (mcp-server-mpesa,
  // mcp-server-opay, mcp-server-kra, etc.).
  'services/mcp-server-',
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
    if (ZOD_OR_ENUM_LINE_RX.test(line)) continue;
    if (TYPE_UNION_LINE_RX.test(line)) continue;
    const m = line.match(PROVIDER_RX);
    if (m) {
      hits.push({ line: i + 1, provider: m[2], snippet: line.trim().slice(0, 120) });
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
    if (HARDCODED_BANK_ALLOWLIST.has(rel)) {
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
  for (const p of HARDCODED_BANK_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'hardcoded-bank-coverage',
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
      `audit-hardcoded-bank-coverage: ${totalScanned} scanned (${totalTestSkipped} test, ${totalRegistrySkipped} registry, ${totalClean} clean, ${totalAllowlisted} allowlisted), ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file} (${v.hitCount} hit${v.hitCount === 1 ? '' : 's'})`);
      for (const h of v.hits.slice(0, 3)) {
        console.error(`      L${h.line} '${h.provider}': ${h.snippet}`);
      }
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Hardcoded-bank-coverage audit');
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
        lines.push(`  - L${h.line} \`'${h.provider}'\`: \`${h.snippet}\``);
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
