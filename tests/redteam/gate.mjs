#!/usr/bin/env node
/**
 * Red-team pass-rate gate (LP-13).
 *
 * Parses a promptfoo eval output JSON and exits non-zero when the
 * pass-rate is below the threshold. Used by `.github/workflows/borjie-redteam.yml`.
 *
 * Usage: node tests/redteam/gate.mjs <output.json> <threshold>
 *   e.g. node tests/redteam/gate.mjs tests/redteam/.out/redteam.json 0.98
 *
 * promptfoo's JSON has varied across versions; this reads the stable
 * `results.stats.{successes,failures}` shape and falls back to summing
 * per-result `success` booleans. Also surfaces per-category counts when
 * each test carries `metadata.category`.
 */

import { readFileSync } from 'node:fs';

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const [, , outPath, thresholdArg] = process.argv;
if (!outPath || !thresholdArg) {
  fail('usage: node gate.mjs <output.json> <threshold>');
}

const threshold = Number(thresholdArg);
if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
  fail(`invalid threshold "${thresholdArg}" (expected 0 < t <= 1)`);
}

let doc;
try {
  doc = JSON.parse(readFileSync(outPath, 'utf8'));
} catch (err) {
  fail(`could not read/parse ${outPath}: ${err.message}`);
}

const results = doc?.results ?? doc;
const stats = results?.stats;

let successes = 0;
let failures = 0;

if (stats && Number.isFinite(stats.successes) && Number.isFinite(stats.failures)) {
  successes = stats.successes;
  failures = stats.failures;
} else if (Array.isArray(results?.results)) {
  for (const r of results.results) {
    if (r?.success === true) successes += 1;
    else failures += 1;
  }
} else {
  fail('unrecognised promptfoo output shape: no stats and no results[]');
}

const total = successes + failures;
if (total === 0) {
  fail('red-team produced zero graded probes');
}

const passRate = successes / total;

// Per-category breakdown (best-effort).
const byCategory = {};
if (Array.isArray(results?.results)) {
  for (const r of results.results) {
    const cat =
      r?.testCase?.metadata?.category ??
      r?.vars?.category ??
      'uncategorised';
    byCategory[cat] ??= { pass: 0, fail: 0 };
    if (r?.success === true) byCategory[cat].pass += 1;
    else byCategory[cat].fail += 1;
  }
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

const summaryLines = [
  '### Borjie Red-Team — pass-rate gate',
  '',
  `Threshold: ${pct(threshold)}`,
  `Result: ${successes}/${total} probes passed (${pct(passRate)})`,
  '',
];

if (Object.keys(byCategory).length > 0) {
  summaryLines.push('| Category | Pass | Fail |', '|---|---:|---:|');
  for (const [cat, c] of Object.entries(byCategory).sort()) {
    summaryLines.push(`| ${cat} | ${c.pass} | ${c.fail} |`);
  }
  summaryLines.push('');
}

const verdict = passRate >= threshold ? 'PASS' : 'FAIL';
summaryLines.push(`Verdict: ${verdict}`);

const summary = summaryLines.join('\n');
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch {
    // Non-fatal: the gate verdict below is what matters.
  }
}

if (passRate < threshold) {
  fail(
    `red-team pass-rate ${pct(passRate)} is below the required ${pct(threshold)} (${failures} probe(s) failed)`,
  );
}

console.log(`Red-team gate passed: ${pct(passRate)} >= ${pct(threshold)}.`);
