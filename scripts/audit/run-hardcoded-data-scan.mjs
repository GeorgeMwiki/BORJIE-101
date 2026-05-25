#!/usr/bin/env node
/**
 * run-hardcoded-data-scan — drives the hardcoded-data scanner across
 * the monorepo and writes a JSON findings report to
 * `audit-reports/hardcoded-data-findings.json`.
 *
 * Exit codes:
 *   0  scan completed (regardless of findings — warnings only)
 *   1  fatal harness error (could not read the scanner source, etc.)
 *
 * The scanner lives in `packages/security-audit/src/scanners/`. We do
 * NOT import from `dist/` so the script works pre-build by reading the
 * source files via dynamic `import()` of the `.ts` entry-points through
 * Node's `--experimental-loader=tsx`. To avoid a tsx dependency at run
 * time, this script re-implements the scanner in pure JS form — kept
 * structurally aligned with the TS version so the two stay in sync.
 *
 * Usage:
 *   node scripts/audit/run-hardcoded-data-scan.mjs
 *   node scripts/audit/run-hardcoded-data-scan.mjs --report=audit-reports/foo.json
 *   node scripts/audit/run-hardcoded-data-scan.mjs --fail-on=critical
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..', '..');

const DEFAULTS = {
  report: 'audit-reports/hardcoded-data-findings.json',
  failOn: null, // null | 'critical' | 'high' | 'medium' | 'low'
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--report=')) args.report = a.split('=', 2)[1];
    else if (a.startsWith('--fail-on=')) args.failOn = a.split('=', 2)[1];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: run-hardcoded-data-scan.mjs [--report=path] [--fail-on=critical|high|medium|low]');
      process.exit(0);
    }
  }
  return args;
}

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage',
  '.audit', '.research', '.planning', '.git', '.claude', '.cursor',
  '.sidecar-venv', '.semgrep', 'docker', 'monitoring', 'k8s',
  'infrastructure', 'evals',
]);

const ID_ALLOWED_TOKENS = [
  'seeds', 'seed', '__tests__', '__fixtures__', 'tests', 'test',
  'fixtures', 'mocks', '.test.', '.spec.', 'e2e', '/test-utils/',
];

const VENDOR_HOST_ALLOWLIST = [
  'anthropic.com', 'openai.com', 'googleapis.com', 'verra.org',
  'mapillary.com', 'amazonaws.com', 'sentry.io', 'posthog.com',
  'supabase.co', 'supabase.com', 'github.com', 'githubusercontent.com',
  'cloudflare.com', 'stripe.com', 'paystack.com', 'twilio.com',
  'm-pesa.com', 'safaricom.co.ke', 'firs.gov.ng', 'nimc.gov.ng',
  'opay-inc.com', 'gepg.tz', 'tra.go.tz', 'nida.go.tz',
  'localhost', '127.0.0.1', '0.0.0.0',
  'example.com', 'example.org',
  'api-gateway', 'postgres', 'redis', 'minio',
];

const EXT_WHITELIST = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const PATTERNS = [
  { kind: 'aws-access-key', severity: 'critical', re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'aws-secret-key', severity: 'critical',
    re: /(?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"`]([A-Za-z0-9/+]{40})['"`]/gi },
  { kind: 'stripe-secret-key', severity: 'critical', re: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/g },
  { kind: 'anthropic-api-key', severity: 'critical', re: /\bsk-ant-api03-[A-Za-z0-9_-]{40,}\b/g },
  { kind: 'openai-api-key', severity: 'critical', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'supabase-service-role', severity: 'critical',
    re: /\bservice_role['"`]?\s*[:=]\s*['"`]?eyJ[A-Za-z0-9_-]{20,}/g },
  { kind: 'jwt-token', severity: 'critical',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'github-token', severity: 'critical', re: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { kind: 'gcp-api-key', severity: 'critical', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'generic-api-key', severity: 'critical',
    re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"`]([A-Za-z0-9_-]{32,})['"`]/gi },

  { kind: 'tenant-id', severity: 'high',
    re: /['"`](trc-tenant|demo-tenant|tnt_[a-f0-9_-]{6,}|tenant_[a-f0-9-]{16,})['"`]/g },
  { kind: 'org-id', severity: 'high',
    re: /['"`](org_[a-f0-9_-]{8,}|organization_[a-f0-9-]{16,})['"`]/g },
  { kind: 'user-id', severity: 'high',
    re: /['"`](usr_[a-f0-9_-]{8,}|user_[a-f0-9-]{16,})['"`]/g },

  { kind: 'not-implemented-stub', severity: 'high',
    re: /(?:throw\s+new\s+Error\s*\(\s*['"`](?:not\s+implemented|TODO|FIXME)[^'"`]*['"`]\s*\))|(?:TODO:\s*not\s+implemented)/gi },
  { kind: 'null-as-any-stub', severity: 'high', re: /\breturn\s+null\s+as\s+any\b/g },

  { kind: 'external-url', severity: 'medium',
    re: /['"`](https?:\/\/[A-Za-z0-9.\-:_]+[A-Za-z0-9/?#&=._-]*)['"`]/g },

  { kind: 'phone-number', severity: 'medium',
    re: /['"`](\+?\d{1,3}[ -]?\(?\d{1,4}\)?[ -]?\d{3,5}[ -]?\d{3,5})['"`]/g },
  { kind: 'email-address', severity: 'medium',
    re: /['"`]([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})['"`]/g },

  { kind: 'price-magic-number', severity: 'low',
    re: /(?:Price|Amount|Threshold|Cap|Limit)\s*[:=]\s*([0-9]{4,})\b/g },
];

function isAllowedTestEmail(v) {
  return v.endsWith('@example.com') || v.endsWith('@example.org') ||
    v.endsWith('@test.local') || v.endsWith('@borjie.local') ||
    v === 'noreply@borjie.com' || v === 'security@borjie.com';
}

function isAllowedTestPhone(v) {
  return /\b555[ -]?01\d{2}\b/.test(v) || v.startsWith('+1555');
}

function looksLikeEnvBinding(line) {
  return /process\.env\./.test(line) || /Deno\.env/.test(line) ||
    /import\.meta\.env/.test(line) || /from\s+['"]env['"]/.test(line);
}

function isVendorHostAllowed(url) {
  return VENDOR_HOST_ALLOWLIST.some((h) => url.includes(h));
}

function isUnderAllowedDir(rel) {
  return ID_ALLOWED_TOKENS.some((t) => rel.includes(t));
}

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e)) continue;
    if (e.startsWith('.') && e !== '.github') continue;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (s.isFile() && EXT_WHITELIST.some((x) => e.endsWith(x))) out.push(p);
  }
}

function scanFile(abs, rel) {
  let body;
  try { body = readFileSync(abs, 'utf8'); } catch { return []; }
  const lines = body.split(/\r?\n/);
  const findings = [];
  const inAllowed = isUnderAllowedDir(rel);
  // Track block-comment state across lines so JSDoc / multi-line
  // comments don't trip the medium-severity matchers.
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    if (!line) continue;
    // Update block-comment state for this line.
    let codePart = line;
    if (inBlockComment) {
      const closeIdx = codePart.indexOf('*/');
      if (closeIdx === -1) continue;
      codePart = codePart.slice(closeIdx + 2);
      inBlockComment = false;
    }
    // Handle inline opening + closing on same line
    while (true) {
      const openIdx = codePart.indexOf('/*');
      if (openIdx === -1) break;
      const closeIdx = codePart.indexOf('*/', openIdx + 2);
      if (closeIdx === -1) {
        codePart = codePart.slice(0, openIdx);
        inBlockComment = true;
        break;
      }
      codePart = codePart.slice(0, openIdx) + codePart.slice(closeIdx + 2);
    }
    if (!codePart.trim()) continue;
    if (/^\s*\/\/\s*(audit|allowlist|allow|allowed|test fixture)/i.test(line)) continue;
    codePart = codePart.replace(/\/\/.*$/, '');
    if (!codePart.trim()) continue;
    // SVG viewBox / d= path attrs frequently look like phone numbers.
    if (/viewBox\s*=|d\s*=\s*['"`]M/.test(codePart)) continue;
    for (const spec of PATTERNS) {
      spec.re.lastIndex = 0;
      let m;
      while ((m = spec.re.exec(codePart)) !== null) {
        const matched = m[1] || m[0];
        if ((spec.kind === 'tenant-id' || spec.kind === 'org-id' ||
             spec.kind === 'user-id') && inAllowed) continue;
        // Secrets pattern in a test-path file are typically fixtures /
        // round-trip seeds for cryptographic plumbing. The dedicated
        // gitleaks ruleset already gates real-looking tokens; the
        // hardcoded-data scanner skips them in test paths to keep the
        // critical bucket signal-to-noise high.
        if (inAllowed && [
          'generic-api-key', 'anthropic-api-key', 'openai-api-key',
          'stripe-secret-key', 'aws-access-key', 'aws-secret-key',
          'jwt-token', 'github-token', 'gcp-api-key',
          'supabase-service-role',
        ].includes(spec.kind)) continue;
        if (spec.kind === 'generic-api-key' && looksLikeEnvBinding(codePart)) continue;
        // Skip dev-only placeholders that have explicit `DO_NOT_USE_IN_PROD`
        // markers — these are the canonical signal that the code path is
        // gated behind a NODE_ENV=production guard.
        if (spec.kind === 'generic-api-key' &&
            /(__DEV_STUB|DO_NOT_USE_IN_PROD|PLACEHOLDER|EXAMPLE|FAKE|MOCK)/i.test(matched)) continue;
        if (spec.kind === 'external-url') {
          if (isVendorHostAllowed(matched)) continue;
          if (matched.startsWith('http://localhost') ||
              matched.startsWith('http://127.0.0.1') ||
              matched.startsWith('http://0.0.0.0')) continue;
        }
        if (spec.kind === 'email-address' && isAllowedTestEmail(matched)) continue;
        if (spec.kind === 'phone-number' && isAllowedTestPhone(matched)) continue;
        // Phone / email literals inside test paths are fixtures —
        // they're allow-listed at the scanner level so the medium
        // bucket only flags production-code leaks.
        if (inAllowed && (spec.kind === 'phone-number' || spec.kind === 'email-address')) continue;
        // Phone-number literals inside form placeholder / pattern attrs
        // are not PII leaks — they're input examples.
        if (spec.kind === 'phone-number' &&
            /(placeholder|pattern|example|format|help|label)/i.test(codePart)) continue;
        if ((spec.kind === 'not-implemented-stub' || spec.kind === 'null-as-any-stub') &&
            (rel.includes('security-audit') || rel.includes('scanners'))) continue;
        findings.push({
          file: rel,
          line: i + 1,
          kind: spec.kind,
          snippet: line.trim().slice(0, 240),
          severity: spec.severity,
          matched: matched.slice(0, 120),
        });
      }
    }
  }
  return findings;
}

function main() {
  const args = parseArgs(process.argv);
  const reportPath = resolve(ROOT, args.report);
  const files = [];
  walk(ROOT, files);
  const findings = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    findings.push(...scanFile(abs, rel));
  }

  // Summary
  const sumBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byKind = {};
  for (const f of findings) {
    sumBySeverity[f.severity] = (sumBySeverity[f.severity] || 0) + 1;
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  }

  const report = {
    scannedAt: new Date().toISOString(),
    root: relative(ROOT, ROOT) || '.',
    filesScanned: files.length,
    totals: { total: findings.length, ...sumBySeverity, byKind },
    findings,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Human-readable summary
  console.log(`hardcoded-data scan: ${files.length} files, ${findings.length} findings`);
  for (const sev of ['critical', 'high', 'medium', 'low']) {
    console.log(`  ${sev.padEnd(8)} ${sumBySeverity[sev]}`);
  }
  console.log(`report: ${args.report}`);

  if (args.failOn) {
    const order = ['low', 'medium', 'high', 'critical'];
    const threshold = order.indexOf(args.failOn);
    let exitCode = 0;
    for (let i = threshold; i < order.length; i++) {
      if ((sumBySeverity[order[i]] || 0) > 0) {
        exitCode = 1;
        break;
      }
    }
    process.exit(exitCode);
  }
  process.exit(0);
}

main();
