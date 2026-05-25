#!/usr/bin/env node
/**
 * Hardcoded-roles scanner — Piece P.
 *
 * Vision: role-name strings are data, not code. The `authz-policy`
 * package and the kernel `awareness-scopes` layer are the canonical
 * role-to-permission resolvers. A line like `user.role === 'admin'`
 * baked into a route handler bypasses that seam.
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags lines that string-equal-compare against a known role name:
 *   `=== 'admin'`, `=== 'manager'`, `=== 'employee'`, `=== 'owner'`,
 *   `=== 'tenant'`, `=== 'vendor'`, `=== 'agent'`, `=== 'staff'`
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - Power-tier checks against `'T1'..'T5'`.
 *   - Zod schema declarations / type unions / enum keys.
 *   - The kernel identity layer (`awareness-scopes.ts`, etc.) — see
 *     allowlist.
 *
 * Usage
 *   node scripts/audit-hardcoded-roles.mjs --report .audit/hardcoded-roles.json --summary .audit/hardcoded-roles.md
 */

import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverProductionFiles,
  isTestPath,
  parseArgs,
  buildReport,
  emitReport,
  computeStaleAllowlist,
  rel as relPath,
} from './lib/audit-helpers.mjs';
import { HARDCODED_ROLES_ALLOWLIST } from './__allowlists__/hardcoded-roles-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Role-name string literals that, when used in an equality comparison
// (`=== 'admin'`), constitute a role string-match.
// NOTE: 'tenant' is deliberately EXCLUDED from the equality regex —
// the codebase uses `ctx.kind === 'tenant'` as a discriminated-union
// tag and that is NOT a role-policy comparison.
const ROLE_NAMES = [
  'admin',
  'administrator',
  'manager',
  'employee',
  'owner',
  'agent',
  'staff',
  'vendor',
];

// We require the LHS of the comparison to look like a role-bearing
// identifier — `role`, `userRole`, `currentRole`, `user.role`, etc. —
// before flagging the comparison as a role string-match. This rules
// out unrelated `kind === 'owner'` / `domain === 'finance'` checks.
const ROLE_EQ_RX = new RegExp(
  `\\b(role|user\\.role|currentRole|userRole|user_role|profile\\.role|principal\\.role|actor\\.role|me\\.role)\\s*(={2,3}|!={1,2})\\s*(['"\`])(${ROLE_NAMES.join('|')})\\3`,
);

// Power-tier whitelist — `'T1'..'T5'` are the canonical 5-tier model.
// Lines that ALSO contain a tier literal are not flagged.
const POWER_TIER_LINE_RX = /['"`]T[1-5]['"`]/;

// Lines that are Zod enum / literal / type-union declarations are auto-
// allowed (they're the role-name registry).
const ZOD_ROLE_LINE_RX = /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\btype\s+\w+\s*=|\binterface\s+\w+|as\s+const|\.\s*default\s*\()/;

// Switch-case-on-role is the dispatch pattern — auto-allow when the
// surrounding line is a `case 'role':`.
const SWITCH_CASE_RX = /^\s*case\s+['"`](?:admin|manager|owner|employee|agent|staff|vendor|administrator)['"`]\s*:/;

function scanFile(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Skip comments.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // Skip schema declarations.
    if (ZOD_ROLE_LINE_RX.test(line)) continue;
    // Skip switch dispatch (`case 'admin':`).
    if (SWITCH_CASE_RX.test(line)) continue;
    // Skip lines that combine role + tier check.
    if (POWER_TIER_LINE_RX.test(line)) continue;
    const m = line.match(ROLE_EQ_RX);
    if (m) {
      hits.push({
        line: i + 1,
        kind: 'role-eq',
        code: `${m[1]} ${m[2]} '${m[4]}'`,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
  return hits;
}

function main() {
  const args = parseArgs(process.argv);
  const ROOT = args.root ? resolve(args.root) : DEFAULT_ROOT;
  const files = discoverProductionFiles(ROOT);
  const violations = [];

  let totalScanned = 0;
  let totalTestSkipped = 0;
  let totalAllowlisted = 0;
  let totalClean = 0;

  for (const file of files) {
    const rel = relPath(ROOT, file);
    totalScanned++;
    if (isTestPath(rel)) {
      totalTestSkipped++;
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
    if (HARDCODED_ROLES_ALLOWLIST.has(rel)) {
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

  // Stale-allowlist check uses the DEFAULT_ROOT (real repo) so tests
  // running against a synthetic temp tree don't falsely report every
  // allowlist entry as stale.
  const staleAllowlist = args.root
    ? []
    : computeStaleAllowlist(ROOT, HARDCODED_ROLES_ALLOWLIST);
  const report = buildReport(
    'hardcoded-roles',
    {
      scanned: totalScanned,
      testSkipped: totalTestSkipped,
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
