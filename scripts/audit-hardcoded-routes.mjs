#!/usr/bin/env node
/**
 * Hardcoded-routes scanner — Piece P.
 *
 * Vision: every frontend route path comes from a `ROUTES` registry so
 * URL layout can change in one place. `router.push('/onboarding')`,
 * `<Link href="/profile">`, `redirect('/auth/login')` baked into a
 * page defeats that goal.
 *
 * Scope: frontend Next.js + Vite apps only (`apps/* /src/**`).
 *
 * Detected patterns:
 *   - `router.push('/path')`
 *   - `router.replace('/path')`
 *   - `redirect('/path')`
 *   - `useRouter().push('/path')`
 *   - `navigate('/path')`  (react-router)
 *   - `<Link href="/path">`  (next/link)
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - The route registry itself (see allowlist).
 *   - External URLs (https://) and anchors (#fragment).
 *   - Lines that reference `ROUTES.` constants — they already use the
 *     registry.
 *
 * Usage
 *   node scripts/audit-hardcoded-routes.mjs --report .audit/hardcoded-routes.json --summary .audit/hardcoded-routes.md
 */

import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  walkDir,
  isProductionTsLike,
  isTestPath,
  parseArgs,
  buildReport,
  emitReport,
  computeStaleAllowlist,
  rel as relPath,
} from './lib/audit-helpers.mjs';
import { HARDCODED_ROUTES_ALLOWLIST } from './__allowlists__/hardcoded-routes-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Imperative navigation calls. The captured string must start with `/`
// (a frontend path) and not look like an external URL.
const NAV_RX_LIST = [
  // router.push / replace / prefetch
  /\brouter\.(?:push|replace|prefetch)\s*\(\s*(['"`])(\/[^'"`?\s]+)/,
  // redirect('/path') — next/navigation
  /\bredirect\s*\(\s*(['"`])(\/[^'"`?\s]+)/,
  // navigate('/path') — react-router
  /\bnavigate\s*\(\s*(['"`])(\/[^'"`?\s]+)/,
  // <Link href="/path">
  /<Link\s+[^>]*href\s*=\s*(['"])(\/[^'"?\s]+)/,
];

// Skip these path-shapes: external URLs (http*), API paths under
// /api/* (consumed by data-fetching code, not navigation), pure
// anchors, and the root `/`.
const SKIP_PATHS = [
  /^\/api\//, // api endpoints — handled by api-client registry
  /^\/_next\//, // next.js internals
  /^\/$/, // root
];

function shouldSkipPath(p) {
  for (const rx of SKIP_PATHS) if (rx.test(p)) return true;
  return false;
}

// If the line is referencing a `ROUTES.` constant, the file already
// uses the registry — auto-allow at line level.
const ROUTES_REGISTRY_RX = /\bROUTES\b\s*[\.\[]/;

// In-scope directories: apps only (route registry is a frontend
// concept; Hono backend routes ARE their own registry).
const SCAN_DIRS = ['apps'];

function shouldSkipByPath(rel) {
  if (!rel.includes(`${sep}src${sep}`)) return true;
  return false;
}

function discoverFiles(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    walkDir(join(root, top), isProductionTsLike, files);
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
    if (ROUTES_REGISTRY_RX.test(line)) continue;
    for (const rx of NAV_RX_LIST) {
      const m = line.match(rx);
      if (m && !shouldSkipPath(m[2])) {
        hits.push({
          line: i + 1,
          kind: 'nav-call',
          code: m[2].slice(0, 80),
          snippet: line.trim().slice(0, 140),
        });
        break;
      }
    }
  }
  return hits;
}

function main() {
  const args = parseArgs(process.argv);
  const ROOT = args.root ? resolve(args.root) : DEFAULT_ROOT;
  const files = discoverFiles(ROOT);
  const violations = [];

  let totalScanned = 0;
  let totalTestSkipped = 0;
  let totalPathSkipped = 0;
  let totalAllowlisted = 0;
  let totalClean = 0;

  for (const file of files) {
    const rel = relPath(ROOT, file);
    totalScanned++;
    if (isTestPath(rel)) {
      totalTestSkipped++;
      continue;
    }
    if (shouldSkipByPath(rel)) {
      totalPathSkipped++;
      continue;
    }
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = scanFile(src);
    if (hits.length === 0) {
      totalClean++;
      continue;
    }
    if (HARDCODED_ROUTES_ALLOWLIST.has(rel)) {
      totalAllowlisted++;
      continue;
    }
    violations.push({
      file: rel,
      severity: 'LOW',
      hits: hits.slice(0, 10),
      hitCount: hits.length,
    });
  }

  const staleAllowlist = args.root
    ? []
    : computeStaleAllowlist(ROOT, HARDCODED_ROUTES_ALLOWLIST);
  const report = buildReport(
    'hardcoded-routes',
    {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
      pathSkipped: totalPathSkipped,
      clean: totalClean,
      allowlisted: totalAllowlisted,
      violations: violations.length,
    },
    violations,
    staleAllowlist,
  );
  const passed = emitReport(args, report);
  process.exit(passed || !args.strict ? 0 : 1);
}

main();
