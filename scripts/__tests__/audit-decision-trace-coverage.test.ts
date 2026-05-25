/**
 * audit-decision-trace-coverage scanner — unit tests.
 *
 * Spawns the scanner against a synthetic services/api-gateway/src/routes
 * tree so the real repo layout doesn't influence the outcome.
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
  'audit-decision-trace-coverage.mjs',
);

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dt-cov-'));
  const routesDir = join(tmp, 'services', 'api-gateway', 'src', 'routes');
  mkdirSync(routesDir, { recursive: true });
  // Traced route — calls startDecisionTrace.
  writeFileSync(
    join(routesDir, 'traced.ts'),
    `
import { Hono } from 'hono';
import { startDecisionTrace } from '@borjie/central-intelligence';
const app = new Hono();
app.post('/x', async (c) => { const w = startDecisionTrace({ thoughtId: 't1' }); return c.json({ ok: true }); });
`,
  );
  // Untraced mutating route.
  writeFileSync(
    join(routesDir, 'untraced.ts'),
    `
import { Hono } from 'hono';
const app = new Hono();
app.post('/y', async (c) => c.json({ ok: true }));
app.delete('/z', async (c) => c.json({ ok: true }));
`,
  );
  // Read-only route — should be ignored entirely.
  writeFileSync(
    join(routesDir, 'readonly.ts'),
    `
import { Hono } from 'hono';
const app = new Hono();
app.get('/q', async (c) => c.json({ ok: true }));
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runScanner() {
  return spawnSync('node', [SCANNER, '--json', '--root', tmp], {
    encoding: 'utf8',
  });
}

describe('audit-decision-trace-coverage scanner', () => {
  it('counts only mutating route files', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.mutatingFiles).toBe(2);
  });

  it('flags untraced mutating routes as violations', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report.totals.traced).toBe(1);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toMatch(/untraced\.ts$/);
  });

  it('exits 1 when violations are present', () => {
    const r = runScanner();
    expect(r.status).toBe(1);
  });

  it('emits a JSON report with expected schema fields', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    expect(report).toHaveProperty('scanner', 'decision-trace-coverage');
    expect(report).toHaveProperty('totals');
    expect(report).toHaveProperty('violations');
    expect(report).toHaveProperty('scannedAt');
  });

  it('marks every violation as HIGH severity', () => {
    const r = runScanner();
    const report = JSON.parse(r.stdout);
    for (const v of report.violations) expect(v.severity).toBe('HIGH');
  });
});
