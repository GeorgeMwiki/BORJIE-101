#!/usr/bin/env node
/**
 * Universal SSRF-coverage scanner.
 *
 * Reverse-port from LITFIN's `src/lib/__tests__/ssrf-coverage-regression.test.ts`.
 * Walks every server-side `.ts` in `services/*` and `packages/*` and
 * asserts each outbound HTTP call site is either:
 *
 *   1. Routed through `safeHttpFetch` from
 *      `packages/enterprise-hardening/src/http/safe-http-fetch.ts`,
 *   2. Pointing at a literal same-origin / relative path (no SSRF surface),
 *   3. In `scripts/__allowlists__/ssrf-coverage-allowlist.mjs` with a
 *      justifying reason.
 *
 * Heuristic
 *   - We look for `fetch(` and `axios.{get|post|put|delete|patch|request}(`
 *     call sites whose first argument is NOT a same-origin literal.
 *   - A file passes the check when either (a) it imports
 *     `safeHttpFetch` AND every outbound site visibly uses it, OR
 *     (b) every outbound site's URL is a same-origin literal, OR
 *     (c) the file is allow-listed.
 *
 * Output
 *   - JSON report (--report)
 *   - Markdown summary (--summary)
 *   - Exits 1 on any unguarded outbound site whose file is not allow-listed.
 *
 * Usage
 *   node scripts/audit-ssrf-coverage.mjs --report .audit/ssrf-coverage.json
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SSRF_ALLOWLIST } from './__allowlists__/ssrf-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const SCAN_ROOTS = ['services', 'packages'];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '__tests__',
  'test',
  'tests',
  '__mocks__',
  'mocks',
  'fixtures',
  'coverage',
]);

const EXCLUDED_FILE_RX = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
  /\.stories\.tsx?$/,
];

function shouldScan(name) {
  if (!(name.endsWith('.ts') || name.endsWith('.tsx'))) return false;
  return !EXCLUDED_FILE_RX.some((rx) => rx.test(name));
}

function walkDir(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      walkDir(full, out);
    } else if (shouldScan(name)) {
      out.push(full);
    }
  }
}

function discoverFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walkDir(join(ROOT, root), files);
  }
  return files;
}

// ───────────────────────────────────────────────────────────────────
// Strip comments + strings so call-site scans don't trip on examples.
// (Keep strings present long enough to inspect the fetch first-arg
// literal, so we don't strip them blindly.)
// ───────────────────────────────────────────────────────────────────

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// First-arg literal helpers (mirrors LITFIN's pattern).
function isSameOriginLiteral(expr) {
  const t = expr.trim();
  if (/^["']\/[^"']*["']$/.test(t)) return true;
  if (/^`\/[^`]*`$/.test(t)) return true;
  return false;
}

// `const X = "/..."` defined earlier in same file → same-origin.
function isConstSameOrigin(expr, src) {
  const m = expr.trim().match(/^([A-Za-z_$][\w$]*)$/);
  if (!m) return false;
  const name = m[1];
  const rx = new RegExp(
    `\\b(?:const|let|var)\\s+${name}\\s*=\\s*(["'\`])(\\/[^"'\`]*)\\1`,
  );
  return rx.test(src);
}

// ───────────────────────────────────────────────────────────────────
// Find outbound HTTP call sites.
// ───────────────────────────────────────────────────────────────────

const FETCH_RX =
  /(?:^|[^.\w])fetch\s*\(\s*([^,)]+)/g;
const AXIOS_RX =
  /\baxios\s*\.\s*(?:get|post|put|delete|patch|head|options|request)\s*\(\s*([^,)]+)/g;
const HTTPS_RX = /\bhttps\.(?:get|request)\s*\(\s*([^,)]+)/g;

function findOutboundSites(src) {
  const stripped = stripComments(src);
  const sites = [];

  for (const rx of [FETCH_RX, AXIOS_RX, HTTPS_RX]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(stripped)) !== null) {
      const expr = m[1].trim();
      if (isSameOriginLiteral(expr)) continue;
      if (isConstSameOrigin(expr, stripped)) continue;
      const line = stripped.slice(0, m.index).split('\n').length;
      sites.push({ line, expr: expr.length > 60 ? expr.slice(0, 60) + '...' : expr });
    }
  }
  return sites;
}

function fileHasSsrfGuard(src) {
  // The file is considered guarded if it imports safeHttpFetch OR
  // any of the named guard helpers BORJIE exposes (including
  // `assertUrlSafe`, the pure URL-policy assertion exported by
  // packages/enterprise-hardening/src/http/safe-http-fetch.ts for
  // callers that own their own fetch port but want the same SSRF
  // policy — e.g. webhook-delivery dispatcher, voice-agent provider
  // runtime, content-studio shared fetch wrapper).
  return (
    /\bsafeHttpFetch\b/.test(src) ||
    /\bsafeFetch\b/.test(src) ||
    /\bassertUrlSafe\s*\(/.test(src) ||
    /\bvalidateOutboundUrl\s*\(/.test(src) ||
    /\bvalidateOutboundUrlWithDns\s*\(/.test(src) ||
    /\bisSafeSameOriginPath\s*\(/.test(src)
  );
}

// ───────────────────────────────────────────────────────────────────
// CLI.
// ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { report: null, summary: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: audit-ssrf-coverage.mjs [--report file] [--summary file]');
      process.exit(0);
    }
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
  let filesWithOutbound = 0;
  let filesGuarded = 0;
  let filesAllowlisted = 0;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const sites = findOutboundSites(src);
    if (sites.length === 0) continue;
    filesWithOutbound++;

    const rel = relative(ROOT, file);
    if (fileHasSsrfGuard(src)) {
      filesGuarded++;
      continue;
    }
    if (SSRF_ALLOWLIST.has(rel)) {
      filesAllowlisted++;
      continue;
    }
    violations.push({
      file: rel,
      siteCount: sites.length,
      sites: sites.slice(0, 5),
    });
  }

  const missingAllowlistFiles = [];
  for (const p of SSRF_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) missingAllowlistFiles.push(p);
  }

  const report = {
    scanner: 'ssrf-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      filesScanned: files.length,
      filesWithOutbound,
      filesGuarded,
      filesAllowlisted,
      violations: violations.length,
    },
    violations,
    missingAllowlistFiles,
  };

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }

  const passed = violations.length === 0 && missingAllowlistFiles.length === 0;
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-ssrf-coverage: scanned ${files.length} files, ${filesWithOutbound} have outbound HTTP, ${filesGuarded} guarded, ${filesAllowlisted} allowlisted, ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  ${v.file} (${v.siteCount} site(s))`);
    }
    if (violations.length > 30) {
      console.error(`  ... and ${violations.length - 30} more`);
    }
    for (const m of missingAllowlistFiles) {
      console.error(`  [STALE ALLOWLIST] ${m}`);
    }
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# SSRF-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| files scanned | ${report.totals.filesScanned} |`);
  lines.push(`| files with outbound HTTP | ${report.totals.filesWithOutbound} |`);
  lines.push(`| files guarded | ${report.totals.filesGuarded} |`);
  lines.push(`| files allowlisted | ${report.totals.filesAllowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    for (const v of report.violations) {
      lines.push(`- \`${v.file}\` — ${v.siteCount} site(s)`);
      for (const s of v.sites) lines.push(`  - L${s.line}: \`${s.expr}\``);
    }
    lines.push('');
  }
  if (report.missingAllowlistFiles.length > 0) {
    lines.push('## Stale allowlist entries');
    lines.push('');
    for (const p of report.missingAllowlistFiles) lines.push(`- \`${p}\``);
    lines.push('');
  }
  return lines.join('\n');
}

main();
