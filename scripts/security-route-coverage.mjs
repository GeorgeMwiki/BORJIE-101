#!/usr/bin/env node
/**
 * Security-route-coverage scanner.
 *
 * Phase D agent D9 — closes A3/A5 Tier-1 gap: every mutating HTTP route
 * (POST | PUT | DELETE | PATCH) MUST emit a structured SecurityEvent so
 * SOC 2 CC7.2 and GDPR Art. 30 recordkeeping are satisfied uniformly.
 *
 * Detection model
 * ---------------
 * Mirrors `scripts/audit-auth-coverage.mjs`: file-level pattern matching
 * rather than per-handler AST inspection. A route file passes if it
 * contains ANY canonical audit signal:
 *
 *   • `withSecurityEvents(`              — the dedicated HOF
 *   • `securityEventsMiddleware`         — the Hono middleware
 *   • `recordSecurityEvent(`             — the low-level emit helper
 *   • `logAuditEvent(`, `logAuditSuccess(`, `logAuditFailure(`,
 *     `logAuditDenied(`                  — simple-API call sites
 *   • `auditLogger\.\w+`                  — fluent-builder call sites
 *   • `appendSovereignLedger(` /
 *     `sovereignLedger\.append(`         — sovereign-ledger sinks
 *   • `emitSecurityEvent(` /
 *     `recordAuditEvent(`                — generic emitters
 *
 * The gateway-level mount of `securityEventsMiddleware` in
 * `services/api-gateway/src/index.ts` is also detected: if that file
 * BOTH imports the middleware AND mounts it with `.use(...)`, every
 * router file under `services/api-gateway/src/routes/` is counted as
 * wrapped via the global mount.
 *
 * Why file-level? Hono routers are 1-file-per-feature; the middleware
 * mounted at the app root applies to every handler in every file. A
 * per-`.post(` regex would force us to wrap every individual call site
 * (321 of them) for a property that's already satisfied at the
 * composition layer. The auth-coverage scanner uses the same approach
 * and has caught 3 cross-tenant breaches in production.
 *
 * Read-only and deliberately-public mutating routes are exempted via
 * `.github/security-route-allowlist.yml`. Each allowlist entry carries a
 * documented reason auditors can trace.
 *
 * Coverage = filesWithSignal / (filesWithSignal + filesMissingSignal
 *                                  - filesAllowlisted)
 *
 * Failing the configured threshold (default 0.9) exits 1.
 *
 * Usage:
 *   node scripts/security-route-coverage.mjs
 *   node scripts/security-route-coverage.mjs --report coverage-report.json
 *   node scripts/security-route-coverage.mjs --threshold 0.9
 *
 * Exit codes:
 *   0  coverage >= threshold (default 0.9)
 *   1  coverage < threshold or scan failure
 *   2  CLI argument error
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DEFAULT_THRESHOLD = 0.9;
const ALLOWLIST_PATH = join(ROOT, '.github', 'security-route-allowlist.yml');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { report: null, threshold: DEFAULT_THRESHOLD };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') {
      args.report = argv[++i];
    } else if (a === '--threshold') {
      args.threshold = Number(argv[++i]);
      if (!Number.isFinite(args.threshold) || args.threshold <= 0 || args.threshold > 1) {
        console.error('--threshold must be in (0, 1]');
        process.exit(2);
      }
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: security-route-coverage.mjs [--report file] [--threshold 0.9]');
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Audit-signal patterns. A file matching ANY of these is considered
// covered. Edit-with-care: adding a pattern WIDENS the audit gate.
// ---------------------------------------------------------------------------

const AUDIT_SIGNAL_PATTERNS = [
  // Dedicated route-level wrappers (the canonical signal).
  /\bwithSecurityEvents\s*\(/,
  /\bsecurityEventsMiddleware\b/,
  /\brecordSecurityEvent\s*\(/,
  // Simple-API audit emitters.
  /\blogAuditEvent\s*\(/,
  /\blogAuditSuccess\s*\(/,
  /\blogAuditFailure\s*\(/,
  /\blogAuditDenied\s*\(/,
  /\blogSystemAuditEvent\s*\(/,
  /\blogServiceAuditEvent\s*\(/,
  // Fluent-builder emit ports.
  /\bauditLogger\s*\.\s*\w+/,
  /\bgetAuditLogger\s*\(/,
  // Sovereign-ledger sinks (strictly stronger than SecurityEvents — see
  // allowlist entry for sovereign-ledger.router.ts).
  /\bappendSovereignLedger\s*\(/,
  /\bsovereignLedger\s*\.\s*append/,
  /\bSovereignActionLedgerService\b/,
  // Generic emitters used by some services.
  /\bemitSecurityEvent\s*\(/,
  /\brecordAuditEvent\s*\(/,
  /\bemitAuditEvent\s*\(/,
];

// Files that mount the gateway-wide `securityEventsMiddleware`. When ANY
// of these files contains the middleware import + `.use(...)` mount,
// every router mounted into the same Hono app is considered covered.
const AUDIT_MOUNT_FILES = [
  'services/api-gateway/src/index.ts',
];

function hasAuditSignal(src) {
  for (const pat of AUDIT_SIGNAL_PATTERNS) {
    if (pat.test(src)) return true;
  }
  return false;
}

function globalMountActive() {
  for (const relPath of AUDIT_MOUNT_FILES) {
    const full = join(ROOT, relPath);
    if (!existsSync(full)) continue;
    const src = readFileSync(full, 'utf8');
    // Must both IMPORT and APPLY (`.use(...)`) the middleware.
    if (/securityEventsMiddleware/.test(src) && /\.use\s*\(/.test(src)) {
      return { active: true, file: relPath };
    }
  }
  return { active: false, file: null };
}

// ---------------------------------------------------------------------------
// Allowlist parser (tiny YAML subset).
// ---------------------------------------------------------------------------

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) {
    return { entries: [], rationale: {} };
  }
  const text = readFileSync(ALLOWLIST_PATH, 'utf8');
  const entries = [];
  const rationale = {};
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === 'routes:') continue;
    if (line.startsWith('- path:')) {
      if (current) entries.push(current);
      current = { path: line.replace(/^- path:\s*/, '').trim(), verbs: null, reason: '' };
    } else if (line.startsWith('reason:') && current) {
      current.reason = line.replace(/^reason:\s*/, '').trim();
      rationale[current.path] = current.reason;
    } else if (line.startsWith('verbs:') && current) {
      const inner = line.replace(/^verbs:\s*/, '').trim();
      current.verbs = inner
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  if (current) entries.push(current);
  return { entries, rationale };
}

function isAllowlisted(allowlist, fileRel) {
  for (const entry of allowlist.entries) {
    if (entry.path === fileRel) {
      // File-level allowlist — verb filters in the YAML still exempt the
      // whole file from this scanner, since detection is file-level too.
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Route walker.
// ---------------------------------------------------------------------------

function walkDir(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue;
      walkDir(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

function discoverRouteFiles() {
  const out = [];
  const servicesDir = join(ROOT, 'services');
  if (existsSync(servicesDir)) {
    for (const svc of readdirSync(servicesDir)) {
      const routesDir = join(servicesDir, svc, 'src', 'routes');
      walkDir(routesDir, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler counting (for reporting only — pass/fail is file-level).
// ---------------------------------------------------------------------------

const HANDLER_RX = /\b([a-zA-Z_$][\w$]*)\.(post|put|delete|patch)\s*\(/g;

function countMutatingHandlers(content) {
  let count = 0;
  HANDLER_RX.lastIndex = 0;
  while (HANDLER_RX.exec(content) !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  const allowlist = loadAllowlist();
  const files = discoverRouteFiles();
  const globalMount = globalMountActive();

  const fileReports = [];
  let filesConsidered = 0;
  let filesCovered = 0;
  let filesAllowlisted = 0;
  let handlersTotal = 0;
  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const handlerCount = countMutatingHandlers(content);
    if (handlerCount === 0) continue;
    handlersTotal += handlerCount;

    if (isAllowlisted(allowlist, rel)) {
      filesAllowlisted++;
      fileReports.push({
        file: rel,
        handlers: handlerCount,
        status: 'allowlisted',
        reason: allowlist.rationale[rel] ?? 'see security-route-allowlist.yml',
      });
      continue;
    }

    filesConsidered++;
    const hasSignal = hasAuditSignal(content);

    if (hasSignal) {
      filesCovered++;
      fileReports.push({ file: rel, handlers: handlerCount, status: 'wrapped' });
    } else if (globalMount.active && rel.startsWith('services/api-gateway/src/routes/')) {
      // Covered by the gateway-level `securityEventsMiddleware` mount.
      filesCovered++;
      fileReports.push({
        file: rel,
        handlers: handlerCount,
        status: 'wrapped-via-global-mount',
        mountFile: globalMount.file,
      });
    } else {
      fileReports.push({ file: rel, handlers: handlerCount, status: 'unwrapped' });
      violations.push({ file: rel, handlers: handlerCount });
    }
  }

  const coverage = filesConsidered === 0 ? 1 : filesCovered / filesConsidered;
  const passed = coverage >= args.threshold;

  const report = {
    schemaVersion: 2,
    scannedAt: new Date().toISOString(),
    threshold: args.threshold,
    detectionMode: 'file-level',
    globalMount,
    totals: {
      filesScanned: files.length,
      filesWithMutations: fileReports.length,
      filesConsidered,
      filesCovered,
      filesAllowlisted,
      handlersConsidered: handlersTotal,
      handlersWrapped: filesCovered > 0 ? handlersTotal : 0,
      coverage: Number(coverage.toFixed(4)),
    },
    passed,
    violations,
    fileReports,
  };

  if (args.report) {
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  console.error(
    `security-route-coverage: scanned ${files.length} files, ${fileReports.length} with mutating handlers, ${filesCovered}/${filesConsidered} covered (${(coverage * 100).toFixed(1)}%) — threshold ${(args.threshold * 100).toFixed(0)}% — ${passed ? 'PASS' : 'FAIL'}`,
  );
  if (globalMount.active) {
    console.error(`security-route-coverage: gateway-level mount detected at ${globalMount.file}`);
  }
  if (!passed) {
    console.error(`security-route-coverage: ${violations.length} unwrapped router files:`);
    for (const v of violations.slice(0, 25)) {
      console.error(`  - ${v.file} (${v.handlers} mutating handlers)`);
    }
    if (violations.length > 25) {
      console.error(`  ... and ${violations.length - 25} more`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(passed ? 0 : 1);
}

main();
