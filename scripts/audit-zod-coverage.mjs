#!/usr/bin/env node
/**
 * Universal Zod-validation coverage scanner.
 *
 * Reverse-port from LITFIN's `src/test/regression/zod-coverage-regression.test.ts`.
 *
 * Walks every route file under `services/*\/src/routes/**` and
 * `apps/*\/src/app/api/**\/route.ts`. For each MUTATING handler
 * (POST/PUT/PATCH/DELETE) the file must show one of:
 *
 *   1. A Zod schema call: `.safeParse(`, `.parse(`, `.safeParseAsync(`,
 *      `.parseAsync(` from a Zod schema.
 *   2. The Hono `zValidator(...)` middleware from @hono/zod-validator.
 *   3. A named validator helper (`validateBody`, `parseRequestBody`,
 *      `decodeBody`, `validatePayload`).
 *   4. A webhook-signature verifier (HMAC + body-shape check).
 *   5. The file is in `scripts/__allowlists__/zod-coverage-allowlist.mjs`.
 *
 * Adding a new mutating route that bypasses validation fails the audit.
 *
 * Usage
 *   node scripts/audit-zod-coverage.mjs --report .audit/zod-coverage.json
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
import { ZOD_ALLOWLIST } from './__allowlists__/zod-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const VALIDATION_PATTERNS = [
  /\.\s*safeParse\s*\(/,
  /\.\s*parse\s*\(/,
  /\.\s*safeParseAsync\s*\(/,
  /\.\s*parseAsync\s*\(/,
  /\bzValidator\s*\(/,
  /\bvalidateBody\s*\(/,
  /\bparseRequest\s*\(/,
  /\bparseRequestBody\s*\(/,
  /\bdecodeBody\s*\(/,
  /\bvalidatePayload\s*\(/,
  // Webhook signature verifiers (they also assert body shape).
  /\bverifyWebhookSignature\s*\(/,
  /\bverifyHmacSignature\s*\(/,
  /\bvalidateHmac\s*\(/,
  /\bvalidateMpesaCallback\s*\(/,
  /\bverifyStripeSignature\s*\(/,
  // Any `z.<x>(` usage in the file is a strong hint a schema is defined.
  /\bz\.[a-zA-Z_]+\(/,
];

const MUTATING_VERBS = new Set(['post', 'put', 'patch', 'delete']);

// Hono `.post(`, `.put(`, ...
const HONO_HANDLER_RX =
  /\b([a-zA-Z_$][\w$]*)\.(post|put|patch|delete)\s*\(/g;

// Next.js App Router: `export async function POST(...)` /
// `export const POST = ...` / `export { foo as POST }`.
const APP_ROUTER_RX =
  /export\s+(?:const|(?:async\s+)?function)\s+(POST|PUT|PATCH|DELETE)\b|export\s+\{\s*[^}]*\b(POST|PUT|PATCH|DELETE)\b/g;

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

function discoverFiles() {
  const honoFiles = [];
  const appRouterFiles = [];
  const servicesDir = join(ROOT, 'services');
  if (existsSync(servicesDir)) {
    for (const svc of readdirSync(servicesDir)) {
      const routesDir = join(servicesDir, svc, 'src', 'routes');
      walkDir(
        routesDir,
        (_full, name) =>
          name.endsWith('.ts') &&
          !name.endsWith('.test.ts') &&
          !name.endsWith('.spec.ts') &&
          !name.endsWith('.d.ts'),
        honoFiles,
      );
    }
  }
  const appsDir = join(ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const apiDir = join(appsDir, app, 'src', 'app', 'api');
      walkDir(apiDir, (_full, name) => name === 'route.ts', appRouterFiles);
    }
  }
  return { honoFiles, appRouterFiles };
}

function fileHasValidation(src) {
  return VALIDATION_PATTERNS.some((rx) => rx.test(src));
}

function hasMutatingHandler(src, isAppRouter) {
  if (isAppRouter) {
    APP_ROUTER_RX.lastIndex = 0;
    return APP_ROUTER_RX.test(src);
  }
  HONO_HANDLER_RX.lastIndex = 0;
  let m;
  while ((m = HONO_HANDLER_RX.exec(src)) !== null) {
    if (MUTATING_VERBS.has(m[2].toLowerCase())) return true;
  }
  return false;
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
  const { honoFiles, appRouterFiles } = discoverFiles();
  const violations = [];
  let totalMutating = 0;
  let totalValidated = 0;
  let totalAllowlisted = 0;

  for (const list of [
    { files: honoFiles, isAppRouter: false },
    { files: appRouterFiles, isAppRouter: true },
  ]) {
    for (const file of list.files) {
      const src = readFileSync(file, 'utf8');
      if (!hasMutatingHandler(src, list.isAppRouter)) continue;
      totalMutating++;
      const rel = relative(ROOT, file);
      if (fileHasValidation(src)) {
        totalValidated++;
        continue;
      }
      if (ZOD_ALLOWLIST.has(rel)) {
        totalAllowlisted++;
        continue;
      }
      violations.push({ file: rel, severity: 'HIGH' });
    }
  }

  const staleAllowlist = [];
  for (const p of ZOD_ALLOWLIST.keys()) {
    if (!existsSync(join(ROOT, p))) staleAllowlist.push(p);
  }

  const report = {
    scanner: 'zod-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      mutatingFiles: totalMutating,
      validated: totalValidated,
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
      `audit-zod-coverage: ${totalMutating} mutating files, ${totalValidated} validated, ${totalAllowlisted} allowlisted, ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.file}`);
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s}`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Zod-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| mutating route files | ${report.totals.mutatingFiles} |`);
  lines.push(`| validated | ${report.totals.validated} |`);
  lines.push(`| allowlisted | ${report.totals.allowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    for (const v of report.violations) lines.push(`- [${v.severity}] \`${v.file}\``);
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
