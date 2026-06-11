#!/usr/bin/env node
/**
 * rls-coverage-gate — the CI-blocking ratchet around
 * `scripts/audit-rls-coverage.mjs`.
 *
 * Why this wrapper exists
 * -----------------------
 * The raw scanner enforces the project hard rule "FORCE-RLS on every
 * tenant-scoped table". It currently reports a body of PRE-EXISTING
 * tracked gaps (tenant tables that landed before the RLS sweep and
 * whose catch-up migrations are still pending). Wiring the raw scanner
 * straight into a required check would paint the whole repo red on day
 * one and could not be merged.
 *
 * This gate snapshots those accepted gaps into
 * `scripts/__allowlists__/rls-coverage-baseline.json` and then fails the
 * build ONLY when a violation appears whose table is NOT in the
 * baseline — i.e. exactly the footgun we want to catch: a NEW
 * tenant-scoped table merged without `ENABLE ROW LEVEL SECURITY` + a
 * tenant policy. The baseline is a one-way ratchet: as RLS migrations
 * land you remove tables from it, and they can never silently regress.
 *
 * Exit codes
 *   0 — no NEW gaps (build is green). Pre-existing baseline gaps are
 *       reported as a non-blocking reminder.
 *   1 — at least one NEW tenant-scoped table is missing RLS coverage,
 *       OR the underlying scanner could not be run.
 *
 * Usage
 *   node scripts/audit/rls-coverage-gate.mjs            # CI gate
 *   node scripts/audit/rls-coverage-gate.mjs --update-baseline
 *       # regenerate the baseline from the current scanner output
 *       # (run this only after intentionally accepting new tracked gaps)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SCANNER = join(ROOT, 'scripts', 'audit-rls-coverage.mjs');
const BASELINE = join(
  ROOT,
  'scripts',
  '__allowlists__',
  'rls-coverage-baseline.json',
);

function runScanner() {
  const reportDir = mkdtempSync(join(tmpdir(), 'rls-gate-'));
  const reportPath = join(reportDir, 'rls-coverage.json');
  const res = spawnSync(
    process.execPath,
    [SCANNER, '--report', reportPath],
    { cwd: ROOT, encoding: 'utf8' },
  );
  // The scanner exits 1 whenever it finds ANY violation; that is its
  // designed behaviour and NOT a gate failure on its own. We only treat
  // a missing/garbage report as a hard error.
  if (!existsSync(reportPath)) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(
      `rls-coverage scanner produced no report.\n${detail}`,
    );
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

function loadBaseline() {
  if (!existsSync(BASELINE)) {
    return { knownViolations: [], knownStaleAllowlist: [] };
  }
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

function uniqSort(values) {
  return [...new Set(values)].sort();
}

function writeBaseline(report) {
  const baseline = {
    note:
      'Baseline of KNOWN RLS-coverage gaps accepted as of generation time. ' +
      'The rls-coverage-gate fails ONLY on violations whose table is NOT ' +
      'listed here (i.e. a NEW tenant-scoped table that landed without ' +
      'FORCE RLS). To ratchet forward: land the RLS migration, then remove ' +
      'the table from this list so it can never regress. Regenerate with: ' +
      'node scripts/audit/rls-coverage-gate.mjs --update-baseline',
    generatedAt: new Date().toISOString(),
    knownViolations: uniqSort(report.violations.map((v) => v.table)),
    knownStaleAllowlist: uniqSort(report.staleAllowlist),
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.error(
    `rls-coverage-gate: baseline rewritten — ${baseline.knownViolations.length} known violation(s), ${baseline.knownStaleAllowlist.length} stale allowlist entr(y/ies).`,
  );
}

function main() {
  const update = process.argv.includes('--update-baseline');

  let report;
  try {
    report = runScanner();
  } catch (error) {
    console.error(`rls-coverage-gate: ${error.message}`);
    process.exit(1);
  }

  if (update) {
    writeBaseline(report);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const knownViolations = new Set(baseline.knownViolations || []);

  const newViolations = report.violations.filter(
    (v) => !knownViolations.has(v.table),
  );

  // Non-blocking visibility into the accepted debt.
  const baselineHits = report.violations.filter((v) =>
    knownViolations.has(v.table),
  ).length;
  console.error(
    `rls-coverage-gate: ${report.totals.tenantTables} tenant tables · ` +
      `${report.violations.length} total violation(s) ` +
      `(${baselineHits} pre-existing/baselined, ${newViolations.length} NEW).`,
  );

  if (newViolations.length === 0) {
    console.error(
      'rls-coverage-gate: PASS — no new tenant-scoped table is missing FORCE RLS.',
    );
    process.exit(0);
  }

  console.error(
    `\nrls-coverage-gate: FAIL — ${newViolations.length} NEW tenant-scoped ` +
      'table(s) missing RLS coverage (not in baseline):',
  );
  for (const v of newViolations) {
    console.error(`  [${v.severity}] ${v.table} (${v.schemaFile}): ${v.reason}`);
  }
  console.error(
    '\nFix: add the `ENABLE ROW LEVEL SECURITY` + tenant-isolation policy ' +
      'migration under packages/database/src/migrations/, or — only if the ' +
      'table is genuinely exempt — add it to ' +
      'scripts/__allowlists__/rls-coverage-allowlist.mjs with a documented ' +
      'reason. Do NOT widen the baseline to silence a real gap.',
  );
  process.exit(1);
}

main();
