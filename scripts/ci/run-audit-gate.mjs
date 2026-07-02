#!/usr/bin/env node
/**
 * Aggregate CI enforcement gate.
 *
 * `package.json` exposes `check:audit-gate` -> this script. It is the ONE
 * command CI runs to enforce the three security/quality auditors as a
 * REQUIRED, blocking gate. Each auditor is a real, independently-runnable
 * scanner that exits non-zero on a violation; this runner invokes all of
 * them, forwards their output, and fails the build if ANY fails.
 *
 * Gates (all must pass):
 *   1. consent-sw coverage    — no un-t()-wrapped English consent literals
 *                               in mining consent surfaces (zero-mix / sw
 *                               parity). `scripts/audit-consent-sw-coverage.mjs`
 *   2. mutation barriers      — the money/audit/kill-switch mutation
 *                               sentinel goes RED on any barrier mutation.
 *                               `vitest run` over the scoped barrier project.
 *   3. service-role scope     — no service-role query touches a
 *                               tenant-scoped table without an explicit
 *                               tenant filter (RLS-darkness guard).
 *                               `scripts/ci/audit-service-role-tenant-scope.mjs`
 *
 * Exit code: 0 iff every gate passes; 1 otherwise (blocking on CI).
 *
 * Fail-safe: a gate that throws / cannot run is treated as FAILED, never
 * skipped — a gate that cannot prove PASS must not report PASS.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

/**
 * @typedef {{ name: string; command: string; args: string[] }} Gate
 */

/** @type {Gate[]} */
const gates = [
  {
    name: 'consent-sw coverage',
    command: process.execPath,
    args: ['scripts/audit-consent-sw-coverage.mjs'],
  },
  {
    name: 'mutation barriers',
    command: 'npx',
    args: [
      'vitest',
      'run',
      '--config',
      'scripts/ci/mutation-barriers/vitest.config.ts',
    ],
  },
  {
    name: 'service-role tenant-scope',
    command: process.execPath,
    args: ['scripts/ci/audit-service-role-tenant-scope.mjs'],
  },
];

/**
 * Run one gate, forwarding its stdio, and return whether it passed.
 * @param {Gate} gate
 * @returns {boolean}
 */
function runGate(gate) {
  process.stdout.write(`\n=== audit-gate: ${gate.name} ===\n`);
  const result = spawnSync(gate.command, gate.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    process.stderr.write(
      `audit-gate: ${gate.name} could not run — ${result.error.message} (treated as FAIL)\n`,
    );
    return false;
  }
  // A signal-terminated child (null status) is a failure, never a pass.
  return result.status === 0;
}

function main() {
  const failed = [];
  for (const gate of gates) {
    if (!runGate(gate)) {
      failed.push(gate.name);
    }
  }

  process.stdout.write('\n=== audit-gate summary ===\n');
  for (const gate of gates) {
    const ok = !failed.includes(gate.name);
    process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${gate.name}\n`);
  }

  if (failed.length > 0) {
    process.stderr.write(
      `\naudit-gate: ${failed.length} gate(s) failed: ${failed.join(', ')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('\naudit-gate: all gates passed.\n');
  process.exit(0);
}

main();
