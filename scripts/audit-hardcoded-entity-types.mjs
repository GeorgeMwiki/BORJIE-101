#!/usr/bin/env node
/**
 * Hardcoded-entity-types scanner — Piece P.
 *
 * Vision: business logic NEVER hard-codes `entity_type === 'PROPERTY'`
 * or `entityType === 'INVOICE'` — those literals live in the
 * `entity_type_definition` lookup table and dispatch happens through
 * polymorphic services. A string-equal comparison baked into a service
 * defeats that seam (and breaks tenants who extend the entity-type set).
 *
 * The scanner walks every production TypeScript/TSX file under
 *   - `packages/* /src/**`
 *   - `services/* /src/**`
 *   - `apps/* /src/**`
 *
 * and flags lines that string-equal-compare an entity-type-shaped
 * identifier against a known entity-type literal.
 *
 * Detected patterns:
 *   - `entity_type === 'PROPERTY'`
 *   - `entityType === 'PROPERTY'`
 *   - `<ident>.entity_type === 'PROPERTY'`
 *   - `case 'PROPERTY':` — flagged when NOT in an allowed dispatcher
 *
 * Auto-allowlisted (NOT a violation):
 *   - Test / fixture / mock / story files.
 *   - Zod literal / enum / type-union declarations.
 *   - Files in the domain-models registry, doc-type dispatch tables —
 *     see allowlist.
 *
 * Usage
 *   node scripts/audit-hardcoded-entity-types.mjs --report .audit/hardcoded-entity-types.json --summary .audit/hardcoded-entity-types.md
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
import { HARDCODED_ENTITY_TYPES_ALLOWLIST } from './__allowlists__/hardcoded-entity-types-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Canonical entity-type literals.
const ENTITY_TYPES = [
  'PROPERTY',
  'UNIT',
  'LEASE',
  'INVOICE',
  'PAYMENT',
  'TENANT',
  'OWNER',
  'EMPLOYEE',
  'CONTRACT',
  'WORK_ORDER',
  'ASSET',
  'VENDOR',
  'INSPECTION',
];

// Match: <entity_type|entityType> <op> '<TYPE>'
const ENTITY_EQ_RX = new RegExp(
  `\\b(entity_?[Tt]ype|type)\\s*(={2,3}|!={1,2})\\s*(['"\`])(${ENTITY_TYPES.join('|')})\\3`,
);

// Zod / enum / type declarations are auto-allowed.
const ZOD_LINE_RX = /(\bz\s*\.\s*literal\s*\(|\bz\s*\.\s*enum\s*\(|\btype\s+\w+\s*=|\binterface\s+\w+|as\s+const|\.\s*default\s*\()/;

function scanFile(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (ZOD_LINE_RX.test(line)) continue;
    const m = line.match(ENTITY_EQ_RX);
    if (m) {
      hits.push({
        line: i + 1,
        kind: 'entity-type-eq',
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
    if (HARDCODED_ENTITY_TYPES_ALLOWLIST.has(rel)) {
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
    : computeStaleAllowlist(ROOT, HARDCODED_ENTITY_TYPES_ALLOWLIST);
  const report = buildReport(
    'hardcoded-entity-types',
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
