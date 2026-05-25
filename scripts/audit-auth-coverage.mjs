#!/usr/bin/env node
/**
 * Universal auth-coverage scanner.
 *
 * Reverse-port from LITFIN's `src/app/api/__tests__/auth-coverage-regression.test.ts`.
 * LITFIN's auth-coverage scanner caught 3 cross-tenant breaches that
 * manual review missed during the bank-config sweep. This is the
 * BORJIE mirror: a pure file-walk scanner over every HTTP route in
 * the monorepo that fails the PR when a mutating handler is wired
 * without an auth-middleware signal.
 *
 * What we scan
 *   1. `services/* / src/routes/ **\/*.ts`         (Hono / Express style)
 *   2. `apps/* / src/app/api/ **\/route.ts`        (Next.js App Router)
 *
 * What counts as "this route has auth"
 *   - The file imports / mentions one of the canonical auth helpers
 *     (`authMiddleware`, `requireAuth`, `requireRole`, `withAuth`,
 *     `protect`, etc.).
 *   - OR the file imports a webhook-signature verifier (HMAC) — the
 *     signature IS the auth gate.
 *   - OR the file is in `scripts/__allowlists__/auth-coverage-allowlist.mjs`
 *     with a justifying reason.
 *
 * Mutating verbs trigger the check (POST/PUT/PATCH/DELETE). GETs are
 * audited too but flagged at a lower severity since most are read-only;
 * the report still surfaces unguarded GETs so reviewers can decide.
 *
 * Output
 *   - JSON report on stdout (or written to --report file).
 *   - Markdown summary at `.audit/auth-coverage.md` for CI artifact.
 *   - Exits 1 if any violation isn't allow-listed.
 *
 * Usage
 *   node scripts/audit-auth-coverage.mjs
 *   node scripts/audit-auth-coverage.mjs --report .audit/auth-coverage.json
 *   node scripts/audit-auth-coverage.mjs --summary .audit/auth-coverage.md
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
import { AUTH_ALLOWLIST } from './__allowlists__/auth-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ───────────────────────────────────────────────────────────────────
// Auth signal patterns. A route file matching ANY of these passes.
// ───────────────────────────────────────────────────────────────────

const AUTH_PATTERNS = [
  // BORJIE Hono middleware exports.
  /\bauthMiddleware\b/,
  /\boptionalAuthMiddleware\b/,
  /\bapiKeyAuthMiddleware\b/,
  /\bflexibleAuthMiddleware\b/,
  /\brequireRole\s*\(/,
  /\brequirePermission\s*\(/,
  /\brequireAnyPermission\s*\(/,
  /\brequirePropertyAccess\s*\(/,
  /\brequireOwnership\s*\(/,
  /\bauthorizeResource\s*\(/,
  /\bcapabilityGate\b/,
  /\bambientBrainMiddleware\b/,
  /\btenantContextMiddleware\b/,
  /\brequireFreshToken\s*\(/,
  // Generic auth helper names (defensive).
  /\brequireAuth\s*\(/,
  /\brequireUser\s*\(/,
  /\bwithAuth\s*\(/,
  /\bprotect\s*\(/,
  /\bgetServerUser\s*\(/,
  /\bgetServerSession\s*\(/,
  /\bverifySupabaseJwt\s*\(/,
  // BORJIE composition-root tenant resolvers — when a route is
  // composed via a `TenantResolver` / `resolveTenantId` port the auth
  // gate is applied at composition time, not in the handler file. The
  // pattern below recognises both Fastify (parcel-service style) and
  // Hono (api-gateway style) variants.
  /\btenantResolver\b/,
  /\bresolveTenantId\s*\(/,
  /\btenantOrFail\s*\(/,
  // Next.js cookie-based session helpers.
  /\bPLATFORM_SESSION_COOKIE\b/,
  /\bcookies\(\)\s*\.get\(/, // followed in same file by session lookup
  // BORJIE AI-copilot per-request principal resolution (JWT verification + tenant context).
  /\bbrainForRequest\s*\(/,
  /\bprincipalToBrainContexts\s*\(/,
  // Webhook signature verifiers (signature IS the auth gate).
  /\bverifyWebhookSignature\s*\(/,
  /\bverifyHmacSignature\s*\(/,
  /\bvalidateHmac\s*\(/,
  /\bvalidateMpesaCallback\s*\(/,
  /\bverifyStripeSignature\s*\(/,
  /\bconstructWebhookEvent\s*\(/,
  /\bverifyCallbackSignature\s*\(/,
  /\btimingSafeEqual\s*\(/, // raw HMAC compare
  // Cron / scheduled-secret gates.
  /process\.env\.CRON_SECRET/,
  /process\.env\.BORJIE_CRON_SECRET/,
  /\bverifyCronSecret\s*\(/,
  // API-key gates.
  /\bvalidateApiKey\s*\(/,
  /\bresolveApiKeyLegacyOrRegistry\s*\(/,
  /\bverifyApiKey\s*\(/,
  // Identity-service proxy pattern (forwards session cookie upstream).
  /\bproxyJson\s*\(/,
  /\bgetIdentityBase\s*\(/,
];

// ───────────────────────────────────────────────────────────────────
// Handler detection — register-call style (Hono / Express).
// ───────────────────────────────────────────────────────────────────

const HANDLER_RX =
  /\b([a-zA-Z_$][\w$]*)\.(get|post|put|delete|patch)\s*\(/g;

const MUTATING = new Set(['post', 'put', 'delete', 'patch']);

// ───────────────────────────────────────────────────────────────────
// Next.js App Router handlers — `export async function POST(...)`.
// ───────────────────────────────────────────────────────────────────

const APP_ROUTER_HANDLER_RX =
  /export\s+(?:const|(?:async\s+)?function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

// ───────────────────────────────────────────────────────────────────
// File walker.
// ───────────────────────────────────────────────────────────────────

function walkDir(dir, predicate, out) {
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
      if (
        name === '__tests__' ||
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.next' ||
        name === '.turbo'
      ) {
        continue;
      }
      walkDir(full, predicate, out);
    } else if (predicate(full, name)) {
      out.push(full);
    }
  }
}

function discoverRouteFiles() {
  const honoFiles = [];
  const appRouterFiles = [];

  // services/*/src/routes/**.ts
  const servicesDir = join(ROOT, 'services');
  if (existsSync(servicesDir)) {
    for (const svc of readdirSync(servicesDir)) {
      const routesDir = join(servicesDir, svc, 'src', 'routes');
      walkDir(
        routesDir,
        (full, name) =>
          name.endsWith('.ts') &&
          !name.endsWith('.test.ts') &&
          !name.endsWith('.spec.ts') &&
          !name.endsWith('.d.ts'),
        honoFiles,
      );
    }
  }

  // apps/*/src/app/api/**/route.ts
  const appsDir = join(ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const apiDir = join(appsDir, app, 'src', 'app', 'api');
      walkDir(apiDir, (_full, name) => name === 'route.ts', appRouterFiles);
    }
  }

  return { honoFiles, appRouterFiles };
}

// ───────────────────────────────────────────────────────────────────
// Per-file scan.
// ───────────────────────────────────────────────────────────────────

function hasAnyAuthSignal(src) {
  for (const pat of AUTH_PATTERNS) {
    if (pat.test(src)) return true;
  }
  return false;
}

function extractHonoHandlers(src) {
  const handlers = [];
  let m;
  HANDLER_RX.lastIndex = 0;
  while ((m = HANDLER_RX.exec(src)) !== null) {
    const verb = m[2].toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;
    handlers.push({ verb, line });
  }
  return handlers;
}

function extractAppRouterHandlers(src) {
  const handlers = [];
  let m;
  APP_ROUTER_HANDLER_RX.lastIndex = 0;
  while ((m = APP_ROUTER_HANDLER_RX.exec(src)) !== null) {
    const verb = m[1].toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;
    handlers.push({ verb, line });
  }
  return handlers;
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
      console.log('Usage: audit-auth-coverage.mjs [--report file] [--summary file]');
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
  const { honoFiles, appRouterFiles } = discoverRouteFiles();
  const allFiles = [...honoFiles, ...appRouterFiles];

  const violations = [];
  const audited = [];

  for (const file of allFiles) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    const isAppRouter = file.includes('/src/app/api/');
    const handlers = isAppRouter
      ? extractAppRouterHandlers(src)
      : extractHonoHandlers(src);
    if (handlers.length === 0) continue;

    const fileAuthed = hasAnyAuthSignal(src);
    const allowReason = AUTH_ALLOWLIST.get(rel) ?? null;

    const mutating = handlers.filter((h) => MUTATING.has(h.verb));
    const reads = handlers.filter((h) => !MUTATING.has(h.verb));

    audited.push({
      file: rel,
      style: isAppRouter ? 'next-app-router' : 'hono',
      mutating: mutating.length,
      reads: reads.length,
      authed: fileAuthed,
      allowlisted: Boolean(allowReason),
    });

    if (fileAuthed || allowReason) continue;

    // No auth signal AND not on allowlist → violation.
    // Severity: HIGH for any mutating handler; MEDIUM for read-only.
    const severity = mutating.length > 0 ? 'HIGH' : 'MEDIUM';
    violations.push({
      file: rel,
      severity,
      mutating: mutating.map((h) => `.${h.verb}@L${h.line}`),
      reads: reads.map((h) => `.${h.verb}@L${h.line}`),
    });
  }

  // Verify every allowlist entry refers to a real file.
  const missingAllowlistFiles = [];
  for (const p of AUTH_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) missingAllowlistFiles.push(p);
  }

  const report = {
    scanner: 'auth-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      filesScanned: allFiles.length,
      filesWithHandlers: audited.length,
      filesAuthed: audited.filter((a) => a.authed).length,
      filesAllowlisted: audited.filter((a) => a.allowlisted).length,
      violations: violations.length,
      highSeverity: violations.filter((v) => v.severity === 'HIGH').length,
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
    const md = renderMarkdown(report);
    writeFileSync(args.summary, md);
  }

  const passed = violations.length === 0 && missingAllowlistFiles.length === 0;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-auth-coverage: ${audited.length} route files scanned, ${report.totals.filesAuthed} authed, ${report.totals.filesAllowlisted} allowlisted, ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    if (!passed) {
      for (const v of violations.slice(0, 30)) {
        console.error(`  [${v.severity}] ${v.file} (mutating: ${v.mutating.join(',') || '-'}, reads: ${v.reads.join(',') || '-'})`);
      }
      if (violations.length > 30) {
        console.error(`  ... and ${violations.length - 30} more`);
      }
      for (const m of missingAllowlistFiles) {
        console.error(`  [STALE ALLOWLIST] ${m}`);
      }
    }
  }

  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Auth-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| files scanned | ${report.totals.filesScanned} |`);
  lines.push(`| files with handlers | ${report.totals.filesWithHandlers} |`);
  lines.push(`| authed | ${report.totals.filesAuthed} |`);
  lines.push(`| allowlisted | ${report.totals.filesAllowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push(`| HIGH severity | ${report.totals.highSeverity} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    lines.push('| severity | file | mutating | read-only |');
    lines.push('|---|---|---|---|');
    for (const v of report.violations) {
      lines.push(`| ${v.severity} | \`${v.file}\` | ${v.mutating.join(' ') || '-'} | ${v.reads.join(' ') || '-'} |`);
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
