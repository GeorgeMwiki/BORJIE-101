/**
 * audit-policy-gate-coverage scanner — unit tests.
 *
 * Spawns the scanner against a synthetic
 * packages/central-intelligence/src/kernel tree so the real repo
 * layout doesn't influence the outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(
  __filename,
  '..',
  '..',
  'audit-policy-gate-coverage.mjs',
);

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pg-cov-'));
  const kernelDir = join(
    tmp,
    'packages',
    'central-intelligence',
    'src',
    'kernel',
  );
  mkdirSync(kernelDir, { recursive: true });
  // Gated execution.
  writeFileSync(
    join(kernelDir, 'gated.ts'),
    `
import { assertTierPolicy } from './policy-gate.js';
export async function run() {
  await assertTierPolicy({ tier: 'pro' });
  return executeTool({ id: 'x' });
}
`,
  );
  // Ungated execution — violation.
  writeFileSync(
    join(kernelDir, 'ungated.ts'),
    `
export async function run() {
  return executeTool({ id: 'y' });
}
`,
  );
  // Pure type-only file — should be ignored (no executor token).
  writeFileSync(
    join(kernelDir, 'types.ts'),
    `
export interface Foo { bar: string }
`,
  );
  // The implementation itself — exempt by path.
  writeFileSync(join(kernelDir, 'policy-gate.ts'), `export function assertTierPolicy() {}`);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runScanner() {
  return spawnSync('node', [SCANNER, '--json', '--root', tmp], {
    encoding: 'utf8',
  });
}

describe('audit-policy-gate-coverage scanner', () => {
  it('counts only files with kernel-execution tokens', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.execFiles).toBe(2);
  });

  it('flags ungated execution as a violation', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.gated).toBe(1);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toMatch(/ungated\.ts$/);
  });

  it('exempts the policy-gate implementation file by path', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    for (const v of report.violations) {
      expect(v.file).not.toMatch(/policy-gate\.ts$/);
    }
  });

  it('exits 1 when violations are present', () => {
    const r = runScanner();
    expect(r.status).toBe(1);
  });

  it('reports a stable schema with totals + violations + staleAllowlist', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report).toHaveProperty('scanner', 'policy-gate-coverage');
    expect(report).toHaveProperty('totals.execFiles');
    expect(report).toHaveProperty('totals.gated');
    expect(report).toHaveProperty('totals.violations');
    expect(report).toHaveProperty('staleAllowlist');
  });
});
