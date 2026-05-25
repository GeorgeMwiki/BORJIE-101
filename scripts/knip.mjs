#!/usr/bin/env node
/**
 * Knip + dependency-cruiser orchestrator — LITFIN parity audit gap #7
 * (Docs/LITFIN_PARITY_DEEP_AUDIT_2026-05-24.md).
 *
 * What it does:
 *   1. Runs `knip --reporter json` against the repo (config: knip.json).
 *   2. Runs `npx depcruise --output-type json src` against packages/, services/,
 *      apps/ (config: .dependency-cruiser.cjs).
 *   3. Counts findings per category (unused files / deps / exports / cyclic
 *      deps / orphans / layer violations).
 *   4. Diffs against the committed baseline at `.knip-baseline.json`.
 *   5. Exits 0 if no NEW findings, exits 1 only if findings exceed baseline.
 *      Pass `--write-baseline` to refresh the baseline (intended for the
 *      first push to main and any deliberate cleanup that lowers the count).
 *
 * CLI:
 *   node scripts/knip.mjs                  # report-only diff vs baseline
 *   node scripts/knip.mjs --write-baseline # refresh baseline + exit 0
 *   node scripts/knip.mjs --strict         # fail on ANY finding regardless of baseline
 *   node scripts/knip.mjs --no-depcruise   # skip dep-cruiser (faster, knip-only)
 *
 * Why this design:
 *   - Initial roll-out: 95 packages have never been knipped → likely 100+
 *     findings. Baseline lets us land the gate without a giant cleanup PR.
 *   - As we clean up over time, the baseline shrinks and CI tightens.
 *
 * Modeled after `scripts/audit-not-yet-wired.mjs` (Phase F.7).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, '.knip-baseline.json');
const REPORT_DIR = join(ROOT, '.audit');
const REPORT_PATH = join(REPORT_DIR, 'knip-dep-cruiser-report.md');

const args = new Set(process.argv.slice(2));
const WRITE_BASELINE = args.has('--write-baseline');
const STRICT = args.has('--strict');
const SKIP_DEPCRUISE = args.has('--no-depcruise');

const FINDING_CATEGORIES = Object.freeze([
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'binaries',
  'unresolved',
  'exports',
  'types',
  'nsExports',
  'nsTypes',
  'enumMembers',
  'classMembers',
  'duplicates',
]);

const DEPCRUISE_CATEGORIES = Object.freeze([
  'no-circular',
  'no-orphans',
  'layer-respect-apps',
  'layer-respect-services',
  'packages-must-not-import-services',
  'packages-must-not-import-apps',
  'services-must-not-import-apps',
  'no-deprecated-core',
  'not-to-test',
]);

// ─────────────────────────────────────────────────────────────────────
// 1. Run knip
// ─────────────────────────────────────────────────────────────────────

function runKnip() {
  console.log('[knip] running knip…');
  const result = spawnSync('npx', ['--yes', 'knip@5', '--reporter', 'json', '--no-progress'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.error) {
    console.error('[knip] spawn error:', result.error.message);
    return null;
  }
  // Knip exits 1 when it finds issues — that's expected, parse stdout regardless.
  const raw = result.stdout?.trim();
  if (!raw) {
    console.error('[knip] empty stdout. stderr:\n', result.stderr);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('[knip] failed to parse JSON:', e.message);
    console.error('[knip] first 500 chars of stdout:', raw.slice(0, 500));
    return null;
  }
}

function summariseKnip(report) {
  const counts = Object.fromEntries(FINDING_CATEGORIES.map((c) => [c, 0]));
  if (!report || typeof report !== 'object') return counts;

  // knip@5 emits { files: [...], issues: [ { ...categories with arrays } ] }.
  if (Array.isArray(report.files)) counts.files = report.files.length;
  const issues = Array.isArray(report.issues) ? report.issues : [];
  for (const file of issues) {
    for (const cat of FINDING_CATEGORIES) {
      if (cat === 'files') continue;
      const v = file?.[cat];
      if (Array.isArray(v)) counts[cat] += v.length;
      else if (v && typeof v === 'object') counts[cat] += Object.keys(v).length;
    }
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Run dependency-cruiser
// ─────────────────────────────────────────────────────────────────────

function runDepCruise() {
  if (SKIP_DEPCRUISE) {
    console.log('[depcruise] skipped (--no-depcruise)');
    return null;
  }
  console.log('[depcruise] running dependency-cruiser…');
  const result = spawnSync(
    'npx',
    [
      '--yes',
      'dependency-cruiser@16',
      '--output-type',
      'json',
      '--config',
      '.dependency-cruiser.cjs',
      'packages',
      'services',
      'apps',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  );
  if (result.error) {
    console.error('[depcruise] spawn error:', result.error.message);
    return null;
  }
  const raw = result.stdout?.trim();
  if (!raw) {
    console.error('[depcruise] empty stdout. stderr:\n', result.stderr?.slice(0, 500));
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('[depcruise] failed to parse JSON:', e.message);
    return null;
  }
}

function summariseDepCruise(report) {
  const counts = Object.fromEntries(DEPCRUISE_CATEGORIES.map((c) => [c, 0]));
  if (!report || !Array.isArray(report.summary?.violations)) return counts;
  for (const v of report.summary.violations) {
    const rule = v?.rule?.name;
    if (rule && rule in counts) counts[rule] += 1;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────
// 3. Baseline diff
// ─────────────────────────────────────────────────────────────────────

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { knip: {}, depcruise: {} };
  }
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      knip: parsed.knip ?? {},
      depcruise: parsed.depcruise ?? {},
    };
  } catch (e) {
    console.warn('[baseline] could not parse — treating as empty:', e.message);
    return { knip: {}, depcruise: {} };
  }
}

function diffCounts(currentCounts, baselineCounts) {
  const delta = {};
  let netNew = 0;
  const allKeys = new Set([
    ...Object.keys(currentCounts),
    ...Object.keys(baselineCounts),
  ]);
  for (const key of allKeys) {
    const cur = Number(currentCounts[key] ?? 0);
    const base = Number(baselineCounts[key] ?? 0);
    const d = cur - base;
    delta[key] = d;
    if (d > 0) netNew += d;
  }
  return { delta, netNew };
}

// ─────────────────────────────────────────────────────────────────────
// 4. Markdown report
// ─────────────────────────────────────────────────────────────────────

function renderRow(label, current, baseline, delta) {
  const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
  return `| ${label} | ${current} | ${baseline} | ${arrow} |`;
}

function writeReport({ knipCounts, knipDelta, depCounts, depDelta, totalNew }) {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const lines = [
    '# knip + dependency-cruiser report',
    '',
    `_Generated: ${ts}_`,
    '',
    'LITFIN parity audit gap #7 — dead-code / module-boundary CI gate.',
    '',
    '## Knip findings',
    '',
    '| Category | Current | Baseline | Δ |',
    '|---|---|---|---|',
  ];
  for (const cat of FINDING_CATEGORIES) {
    lines.push(renderRow(cat, knipCounts[cat] ?? 0, knipDelta.baseline?.[cat] ?? 0, knipDelta.delta?.[cat] ?? 0));
  }
  lines.push('');
  lines.push('## Dependency-cruiser findings');
  lines.push('');
  lines.push('| Rule | Current | Baseline | Δ |');
  lines.push('|---|---|---|---|');
  for (const cat of DEPCRUISE_CATEGORIES) {
    lines.push(renderRow(cat, depCounts[cat] ?? 0, depDelta.baseline?.[cat] ?? 0, depDelta.delta?.[cat] ?? 0));
  }
  lines.push('');
  lines.push(`**Total NEW findings vs baseline:** ${totalNew}`);
  lines.push('');
  if (totalNew > 0) {
    lines.push('To accept current state as the new baseline:');
    lines.push('');
    lines.push('```sh');
    lines.push('node scripts/knip.mjs --write-baseline');
    lines.push('```');
  } else {
    lines.push('No regressions detected vs the committed baseline.');
  }
  writeFileSync(REPORT_PATH, lines.join('\n'));
  console.log(`[report] wrote ${REPORT_PATH}`);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Main
// ─────────────────────────────────────────────────────────────────────

function main() {
  const knipReport = runKnip();
  const depReport = runDepCruise();

  const knipCounts = summariseKnip(knipReport);
  const depCounts = summariseDepCruise(depReport);

  const baseline = readBaseline();
  const knipDiff = diffCounts(knipCounts, baseline.knip);
  const depDiff = diffCounts(depCounts, baseline.depcruise);

  const totalNew = knipDiff.netNew + depDiff.netNew;

  writeReport({
    knipCounts,
    knipDelta: { delta: knipDiff.delta, baseline: baseline.knip },
    depCounts,
    depDelta: { delta: depDiff.delta, baseline: baseline.depcruise },
    totalNew,
  });

  // Summary to stdout (CI logs)
  console.log('');
  console.log('━━━ knip ━━━');
  for (const c of FINDING_CATEGORIES) {
    const cur = knipCounts[c] ?? 0;
    if (cur === 0) continue;
    const d = knipDiff.delta[c] ?? 0;
    const sign = d > 0 ? `(+${d})` : d < 0 ? `(${d})` : '';
    console.log(`  ${c.padEnd(28)} ${String(cur).padStart(5)} ${sign}`);
  }
  console.log('━━━ depcruise ━━━');
  for (const c of DEPCRUISE_CATEGORIES) {
    const cur = depCounts[c] ?? 0;
    if (cur === 0) continue;
    const d = depDiff.delta[c] ?? 0;
    const sign = d > 0 ? `(+${d})` : d < 0 ? `(${d})` : '';
    console.log(`  ${c.padEnd(36)} ${String(cur).padStart(5)} ${sign}`);
  }
  console.log('━━━━━━━━━━━━━━━');
  console.log(`Total NEW findings vs baseline: ${totalNew}`);

  if (WRITE_BASELINE) {
    const payload = { knip: knipCounts, depcruise: depCounts, generatedAt: new Date().toISOString() };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`[baseline] wrote ${BASELINE_PATH}`);
    process.exit(0);
  }

  if (STRICT) {
    const totalAny = Object.values(knipCounts).reduce((a, b) => a + b, 0) + Object.values(depCounts).reduce((a, b) => a + b, 0);
    if (totalAny > 0) {
      console.error(`[strict] ${totalAny} findings — failing`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: fail only when net-new > 0
  if (totalNew > 0) {
    console.error(`[knip] ${totalNew} NEW findings vs baseline — failing CI. Run \`node scripts/knip.mjs --write-baseline\` to accept.`);
    process.exit(1);
  }
  console.log('[knip] no regressions — pass.');
  process.exit(0);
}

main();
