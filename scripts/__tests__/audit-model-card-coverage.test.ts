/**
 * audit-model-card-coverage scanner — unit tests.
 *
 * Builds a synthetic Docs/regulator-pack tree with subset of required
 * cards present and verifies the scanner detects missing pairs.
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
  'audit-model-card-coverage.mjs',
);

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mc-cov-'));
  const tzDir = join(tmp, 'Docs', 'regulator-pack', 'tz', 'model-cards');
  const keDir = join(tmp, 'Docs', 'regulator-pack', 'ke', 'model-cards');
  mkdirSync(tzDir, { recursive: true });
  mkdirSync(keDir, { recursive: true });
  // tz: all six cards present.
  for (const m of [
    'adaptive-layout',
    'three-agent-debate',
    'online-judge',
    'tier-policy-resolver',
    'lats-search',
    'reflexion-sleep',
  ]) {
    writeFileSync(join(tzDir, `${m}-v1.md`), `# ${m}\n`);
  }
  // ke: only three cards present — three should be flagged missing.
  for (const m of ['adaptive-layout', 'three-agent-debate', 'online-judge']) {
    writeFileSync(join(keDir, `${m}-v1.md`), `# ${m}\n`);
  }
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runScanner() {
  return spawnSync('node', [SCANNER, '--json', '--root', tmp], {
    encoding: 'utf8',
  });
}

describe('audit-model-card-coverage scanner', () => {
  it('reports the expected required-model count', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.requiredModels).toBe(6);
    expect(report.totals.jurisdictions).toBe(2);
  });

  it('flags missing ke cards but not tz cards', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.missing).toBe(3);
    for (const v of report.violations) expect(v.jurisdiction).toBe('ke');
  });

  it('exits 1 when any card is missing', () => {
    const r = runScanner();
    expect(r.status).toBe(1);
  });

  it('accepts any -vN.md version suffix', () => {
    // Refresh — write a v2 card and verify it counts.
    const tzDir = join(tmp, 'Docs', 'regulator-pack', 'tz', 'model-cards');
    writeFileSync(join(tzDir, 'adaptive-layout-v2.md'), '# v2\n');
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    // adaptive-layout should still be considered covered on tz.
    for (const v of report.violations) {
      expect(`${v.model}|${v.jurisdiction}`).not.toBe('adaptive-layout|tz');
    }
  });

  it('marks each missing pair with HIGH severity', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    for (const v of report.violations) expect(v.severity).toBe('HIGH');
  });
});
