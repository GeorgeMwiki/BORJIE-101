#!/usr/bin/env node
/**
 * Hardcoded-module-list scanner — Piece P.
 *
 * Vision: tenant-enabled modules are data. The set of modules a tenant
 * runs (estate, hr, fleet, inventory, maintenance, marketplace, ...)
 * is resolved through the `module_templates` lookup or a per-tenant
 * settings table. An inline array `['estate', 'hr', 'fleet']` in code
 * defeats per-tenant configurability and module-marketplace plug-in.
 *
 * Detected pattern:
 *   A SINGLE-LINE array literal that contains AT LEAST TWO module-
 *   name string literals from the canonical module list, where the
 *   array is NOT inside a Zod schema declaration.
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - Files in module-template registry — see allowlist.
 *   - Zod / type-union declarations.
 *
 * Usage
 *   node scripts/audit-hardcoded-module-list.mjs --report .audit/hardcoded-module-list.json --summary .audit/hardcoded-module-list.md
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { HARDCODED_MODULE_LIST_ALLOWLIST } from './__allowlists__/hardcoded-module-list-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Canonical module names (lowercase, snake_case). Update when a new
// first-class module is added to the platform.
const MODULE_NAMES = [
  'estate',
  'hr',
  'fleet',
  'inventory',
  'maintenance',
  'marketplace',
  'concierge',
  'documents',
  'security',
  'energy',
  'community',
  'payments',
  'accounting',
  'compliance',
];

// Quoted module-name literal regex.
const MODULE_LITERAL_RX = new RegExp(
  `(['"\`])(${MODULE_NAMES.join('|')})\\1`,
  'g',
);

// Array literal containing 2+ comma-separated module-name string
// literals on a single line. Note: deliberately we ONLY look at one
// line — multi-line array literals are far less ambiguous.
const ARRAY_LINE_RX = /\[\s*(?:['"`][^'"`]+['"`]\s*,\s*){1,}['"`][^'"`]+['"`]\s*\]/;

// Lines we never flag.
const SKIP_LINE_RX = /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\btype\s+\w+\s*=|as\s+const|\/\/|\*|\/\*)/;

function scanFile(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_LINE_RX.test(line)) continue;
    if (!ARRAY_LINE_RX.test(line)) continue;
    // Count module-name literals in this line.
    const matches = line.matchAll(MODULE_LITERAL_RX);
    const found = new Set();
    for (const m of matches) found.add(m[2]);
    if (found.size >= 2) {
      hits.push({
        line: i + 1,
        kind: 'module-array',
        code: `[${[...found].slice(0, 6).join(',')}]`,
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
    if (HARDCODED_MODULE_LIST_ALLOWLIST.has(rel)) {
      totalAllowlisted++;
      continue;
    }
    violations.push({
      file: rel,
      severity: 'MEDIUM',
      hits: hits.slice(0, 10),
      hitCount: hits.length,
    });
  }

  const staleAllowlist = args.root
    ? []
    : computeStaleAllowlist(ROOT, HARDCODED_MODULE_LIST_ALLOWLIST);
  const report = buildReport(
    'hardcoded-module-list',
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
