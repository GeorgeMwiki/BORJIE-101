#!/usr/bin/env node
/**
 * Policy-gate coverage scanner (Wave-13 LITFIN-port primitive F2).
 *
 * Walks `packages/central-intelligence/src/kernel/**` and flags every
 * tool / power-tool / action execution call-site that does NOT route
 * through `assertTierPolicy(...)` / `runPolicyGate(...)`. Catches the
 * "I forgot to gate this new sovereign action" regression at PR time.
 *
 * A file passes if either:
 *
 *   1. It does not contain any kernel-execution token (`execute(`,
 *      `dispatch(`, `invoke(`, `runAction(`) at all.
 *   2. EVERY kernel-execution token in the file is paired with at
 *      least one policy-gate token in the same file — `assertTierPolicy(`,
 *      `runPolicyGate(`, `policyGate.evaluate(`, or an import from
 *      `policy-gate.ts` / `tier-policy-resolver.ts`.
 *   3. The file is listed in
 *      `scripts/__allowlists__/policy-gate-allowlist.mjs` with a
 *      justifying reason.
 *
 * Files containing the policy-gate IMPLEMENTATION itself (paths matching
 * `policy-gate.ts`, `tier-policy-resolver.ts`, or `**\/policy-gate/**`)
 * are exempt by construction — they ARE the gate.
 *
 * Usage:
 *   node scripts/audit-policy-gate-coverage.mjs --report .audit/policy-gate-coverage.json
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
import { POLICY_GATE_ALLOWLIST } from './__allowlists__/policy-gate-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const EXECUTION_PATTERNS = [
  /\bexecuteTool\s*\(/,
  /\bdispatchTool\s*\(/,
  /\binvokePowerTool\s*\(/,
  /\bpowerTool\s*\.\s*execute\s*\(/,
  /\brunAction\s*\(/,
  /\bsovereignWrite\s*\(/,
];

const POLICY_PATTERNS = [
  /\bassertTierPolicy\s*\(/,
  /\brunPolicyGate\s*\(/,
  /\bpolicyGate\s*\.\s*evaluate\s*\(/,
  /\bpolicyGate\s*\.\s*assert\s*\(/,
  /\bfrom\s+['"][^'"]*policy-gate['"]/,
  /\bfrom\s+['"][^'"]*tier-policy-resolver['"]/,
];

const EXEMPT_PATH_RX = [
  /policy-gate\.ts$/,
  /tier-policy-resolver\.ts$/,
  /\/policy-gate\//,
  /\/__tests__\//,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
];

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

function discoverKernelFiles(rootOverride) {
  const root = rootOverride ?? ROOT;
  const out = [];
  const kernelDir = join(
    root,
    'packages',
    'central-intelligence',
    'src',
    'kernel',
  );
  walkDir(
    kernelDir,
    (_f, n) =>
      n.endsWith('.ts') &&
      !n.endsWith('.d.ts') &&
      !n.endsWith('.test.ts') &&
      !n.endsWith('.spec.ts'),
    out,
  );
  return out;
}

function isExempt(rel) {
  return EXEMPT_PATH_RX.some((rx) => rx.test(rel));
}

function hasExecution(src) {
  return EXECUTION_PATTERNS.some((rx) => rx.test(src));
}

function hasPolicy(src) {
  return POLICY_PATTERNS.some((rx) => rx.test(src));
}

function parseArgs(argv) {
  const out = { report: null, summary: null, json: false, root: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Policy-gate coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| kernel files with executions | ${report.totals.execFiles} |`);
  lines.push(`| gated | ${report.totals.gated} |`);
  lines.push(`| allowlisted | ${report.totals.allowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    for (const v of report.violations) lines.push(`- [${v.severity}] \`${v.file}\``);
  }
  if (report.staleAllowlist.length > 0) {
    lines.push('');
    lines.push('## Stale allowlist entries');
    for (const p of report.staleAllowlist) lines.push(`- \`${p}\``);
  }
  return lines.join('\n');
}

export function runScan(opts = {}) {
  const root = opts.root ?? ROOT;
  const files = discoverKernelFiles(root);
  const violations = [];
  let totalExec = 0;
  let totalGated = 0;
  let totalAllowlisted = 0;
  for (const file of files) {
    const rel = relative(root, file);
    if (isExempt(rel)) continue;
    const src = readFileSync(file, 'utf8');
    if (!hasExecution(src)) continue;
    totalExec++;
    if (hasPolicy(src)) {
      totalGated++;
      continue;
    }
    if (POLICY_GATE_ALLOWLIST.has(rel)) {
      totalAllowlisted++;
      continue;
    }
    violations.push({ file: rel, severity: 'HIGH' });
  }
  const staleAllowlist = [];
  for (const p of POLICY_GATE_ALLOWLIST.keys()) {
    if (!existsSync(join(root, p))) staleAllowlist.push(p);
  }
  return {
    scanner: 'policy-gate-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      execFiles: totalExec,
      gated: totalGated,
      allowlisted: totalAllowlisted,
      violations: violations.length,
    },
    violations,
    staleAllowlist,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const report = runScan({ root: args.root });
  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }
  const passed =
    report.violations.length === 0 && report.staleAllowlist.length === 0;
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    process.stderr.write(
      `audit-policy-gate-coverage: ${report.totals.execFiles} exec files, ${report.totals.gated} gated, ${report.totals.allowlisted} allowlisted, ${report.totals.violations} violation(s) — ${passed ? 'PASS' : 'FAIL'}\n`,
    );
    for (const v of report.violations.slice(0, 30)) {
      process.stderr.write(`  [${v.severity}] ${v.file}\n`);
    }
    if (report.violations.length > 30) {
      process.stderr.write(`  ... and ${report.violations.length - 30} more\n`);
    }
    for (const s of report.staleAllowlist) {
      process.stderr.write(`  [STALE ALLOWLIST] ${s}\n`);
    }
  }
  process.exit(passed ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
