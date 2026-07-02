#!/usr/bin/env node
/**
 * Audit: mining offtake / KYC-AML / marketplace-contract consent
 * surfaces for un-t()-wrapped English strings (EN-in-SW split-brain).
 *
 * WHY THIS EXISTS
 * ---------------
 * Borjie's `audit-hardcoded-locale-coverage.mjs` catches BCP-47 locale
 * literals (`'en-KE'`, `new Intl.DateTimeFormat('sw-TZ')`) — the "locale
 * follows the user" rule. It does NOT catch a raw English legal /
 * consent sentence sitting in a customer-facing surface without a `t()`
 * wrapper. Under the active-locale canon (CLAUDE.md: "toggle is
 * ABSOLUTE — when `en` selected zero Swahili appears anywhere and vice
 * versa"), a hardcoded English "I agree to the offtake terms" renders
 * OVER a Swahili surface — the exact zero-mix violation the canon
 * forbids, and worst on a legal/consent string that Tanzania's PDPA
 * reads against the data subject's language, not the operator's.
 *
 * This scanner ports the translator-proximity technique from the sibling
 * cortex (LITFIN's `audit-consent-sw-coverage.ts`) into Borjie's MINING
 * domain: offtake contracts, buyer KYC/AML consent, marketplace
 * counterparty acceptance. Pattern, not content — no credit/training
 * strings are copied; the target surfaces and glossary are mining-native.
 *
 * ALGORITHM
 * ---------
 *   1. Walk the consent-critical mining surfaces (offtake, KYC/AML,
 *      marketplace-contract) across buyer-mobile / owner-web.
 *   2. For each .ts/.tsx file, scan for literal EN-only consent / legal
 *      strings ("I agree", "I accept", "I consent", "I authorize",
 *      "Accept terms", "Agree and continue", "By continuing", "Terms and
 *      conditions") that are NOT the argument of a `t(...)` / `td(...)`
 *      call and NOT an i18n key path.
 *   3. Emit one row per finding (file, line, snippet, severity).
 *   4. Optionally write a dated markdown report under `Docs/audit/`.
 *   5. Exit non-zero when any HIGH finding is detected (borrower-facing
 *      consent literal) so CI can gate on it.
 *
 * Allowlist ratchet: `scripts/__allowlists__/consent-sw-coverage-allowlist.mjs`
 * A stale allowlist entry (path no longer matches) fails the run — same
 * ratchet shape as the other hardcoded-* scanners.
 *
 * Usage:
 *   node scripts/audit-consent-sw-coverage.mjs
 *   node scripts/audit-consent-sw-coverage.mjs --report Docs/audit/consent-sw-coverage.md
 *   node scripts/audit-consent-sw-coverage.mjs --json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_SW_ALLOWLIST } from './__allowlists__/consent-sw-coverage-allowlist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration — mining consent-critical surfaces
// ---------------------------------------------------------------------------

const SCAN_GLOBS = [
  'apps/buyer-mobile/src/kyc',
  'apps/buyer-mobile/src/components/OfftakeContractCard.tsx',
  'apps/buyer-mobile/src/components',
  'apps/owner-web/src/components/marketplace',
  'apps/owner-web/src/components/counterparties',
];

// Only files whose path matches one of these consent-critical hints are
// scanned within the component dirs (keeps false-positive surface small
// and the intent legible).
const CONSENT_PATH_HINTS = /(offtake|contract|consent|kyc|aml|counterpart|terms|agree|accept)/i;

/**
 * EN-only consent / legal literals. Each entry is a /regex/ over a
 * quoted string, a human label, and a severity. HIGH = borrower/buyer
 * consent literal (gate-blocking). MEDIUM = legal-label literal.
 */
const PATTERNS = [
  { re: /(['"`])\s*I\s+agree\b[^'"`]*\1/gi, label: 'I agree', severity: 'high' },
  { re: /(['"`])\s*I\s+accept\b[^'"`]*\1/gi, label: 'I accept', severity: 'high' },
  { re: /(['"`])\s*I\s+consent\b[^'"`]*\1/gi, label: 'I consent', severity: 'high' },
  { re: /(['"`])\s*I\s+authorize\b[^'"`]*\1/gi, label: 'I authorize', severity: 'high' },
  { re: /(['"`])\s*Accept\s+(the\s+)?terms\b[^'"`]*\1/gi, label: 'Accept terms', severity: 'high' },
  { re: /(['"`])\s*Agree\s+and\s+continue\b[^'"`]*\1/gi, label: 'Agree and continue', severity: 'high' },
  { re: /(['"`])\s*By\s+continuing\b[^'"`]*\1/gi, label: 'By continuing', severity: 'high' },
  { re: /(['"`])\s*Terms\s+and\s+conditions\b[^'"`]*\1/gi, label: 'Terms and conditions', severity: 'medium' },
];

// Raw JSX text nodes carrying the same consent copy (e.g.
// `<Text>I agree to the offtake terms</Text>`). Un-t()-wrapped JSX text
// is the most common RN/React leak vector, so it is scanned too.
const JSX_TEXT_PATTERNS = [
  { re: />\s*(I\s+agree\b[^<{]*)</gi, label: 'I agree (JSX text)', severity: 'high' },
  { re: />\s*(I\s+accept\b[^<{]*)</gi, label: 'I accept (JSX text)', severity: 'high' },
  { re: />\s*(I\s+consent\b[^<{]*)</gi, label: 'I consent (JSX text)', severity: 'high' },
  { re: />\s*(I\s+authorize\b[^<{]*)</gi, label: 'I authorize (JSX text)', severity: 'high' },
  { re: />\s*(By\s+continuing\b[^<{]*)</gi, label: 'By continuing (JSX text)', severity: 'high' },
  { re: />\s*(Accept\s+(the\s+)?terms\b[^<{]*)</gi, label: 'Accept terms (JSX text)', severity: 'high' },
  { re: />\s*(Agree\s+and\s+continue\b[^<{]*)</gi, label: 'Agree and continue (JSX text)', severity: 'high' },
];

// A literal is IGNORED when it is the argument of a translation call or
// is itself an i18n key path (dotted, no spaces).
const T_CALL = /\b(t|td|tt|translate)\s*\(\s*(['"`])/;
const I18N_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i;

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function collectFiles(target) {
  const abs = resolve(ROOT, target);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return /\.(ts|tsx)$/.test(abs) ? [abs] : [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const child = join(abs, name);
    const cst = statSync(child);
    if (cst.isDirectory()) {
      out.push(...collectFiles(relative(ROOT, child)));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(child);
    }
  }
  return out;
}

function isTranslated(line, matchIndex) {
  // The matched literal is translated when a `t(` opens immediately
  // before it on the same line.
  const before = line.slice(0, matchIndex);
  return T_CALL.test(before.slice(-24));
}

function stripQuotes(s) {
  return s.replace(/^['"`]|['"`]$/g, '').trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  const args = new Set(process.argv.slice(2));
  const reportFlagIdx = process.argv.indexOf('--report');
  const reportPath = reportFlagIdx !== -1 ? process.argv[reportFlagIdx + 1] : null;
  const asJson = args.has('--json');

  const files = new Set();
  for (const g of SCAN_GLOBS) {
    for (const f of collectFiles(g)) files.add(f);
  }

  const findings = [];
  let scanned = 0;

  for (const abs of files) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    // Component dirs: only scan consent-hinted files.
    if (/\/components\//.test(rel) && !CONSENT_PATH_HINTS.test(rel)) continue;
    if (CONSENT_SW_ALLOWLIST.has(rel)) continue;
    scanned += 1;

    const src = readFileSync(abs, 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const { re, label, severity } of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const literal = stripQuotes(m[0]);
          if (I18N_KEY.test(literal)) continue; // it's a key, not copy
          if (isTranslated(line, m.index)) continue; // wrapped in t()
          findings.push({
            file: rel,
            line: i + 1,
            label,
            severity,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
      // Raw JSX text nodes (not wrapped in t()). `{t('...')}` renders as
      // `{...}` inside the element, so it never matches `>text<`.
      for (const { re, label, severity } of JSX_TEXT_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          findings.push({
            file: rel,
            line: i + 1,
            label,
            severity,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  // Stale-allowlist detection (ratchet).
  const staleAllowlist = [];
  for (const p of CONSENT_SW_ALLOWLIST) {
    const abs = resolve(ROOT, p);
    if (!existsSync(abs)) staleAllowlist.push(p);
  }

  const high = findings.filter((f) => f.severity === 'high');
  const passed = high.length === 0 && staleAllowlist.length === 0;

  const report = {
    scannedAt: new Date().toISOString(),
    summary: {
      filesScanned: scanned,
      findings: findings.length,
      high: high.length,
      medium: findings.length - high.length,
      staleAllowlist: staleAllowlist.length,
    },
    findings,
    staleAllowlist,
  };

  if (reportPath) {
    const absReport = resolve(ROOT, reportPath);
    mkdirSync(dirname(absReport), { recursive: true });
    writeFileSync(absReport, renderMarkdown(report));
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-consent-sw-coverage: ${scanned} consent surfaces scanned, ${findings.length} finding(s) (${high.length} HIGH) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const f of findings.slice(0, 40)) {
      console.error(`  [${f.severity.toUpperCase()}] ${f.file}:${f.line} '${f.label}': ${f.snippet}`);
    }
    if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }

  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Consent-SW coverage audit (mining offtake / KYC-AML / marketplace)');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push(
    `- Consent surfaces scanned: **${report.summary.filesScanned}**`,
  );
  lines.push(`- Findings: **${report.summary.findings}** (HIGH: ${report.summary.high}, MEDIUM: ${report.summary.medium})`);
  lines.push(`- Stale allowlist entries: **${report.summary.staleAllowlist}**`);
  lines.push('');
  if (report.findings.length === 0 && report.staleAllowlist.length === 0) {
    lines.push('No un-t()-wrapped English consent literals in mining consent surfaces. PASS.');
  } else {
    lines.push('| Severity | File | Line | Literal | Snippet |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const f of report.findings) {
      lines.push(`| ${f.severity} | \`${f.file}\` | ${f.line} | ${f.label} | \`${f.snippet.replace(/\|/g, '\\|')}\` |`);
    }
    for (const s of report.staleAllowlist) {
      lines.push(`| stale-allowlist | \`${s}\` | — | path no longer exists | — |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

run();
