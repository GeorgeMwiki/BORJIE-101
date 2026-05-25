/**
 * security-route-coverage scanner — unit tests.
 *
 * Exercises the deterministic .post/.put/.delete/.patch handler counting
 * + `withSecurityEvents` wrap detection. We spawn the scanner against a
 * temporary fixture tree so the real repo layout never influences the
 * outcome of these tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'security-route-coverage.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sec-rt-cov-'));
  // Create a synthetic services/foo/src/routes layout under tmp.
  const routesDir = join(tmp, 'services', 'foo', 'src', 'routes');
  mkdirSync(routesDir, { recursive: true });
  // Two wrapped handlers + one unwrapped.
  writeFileSync(
    join(routesDir, 'a.router.ts'),
    `
import { Hono } from 'hono';
import { withSecurityEvents } from '../../../middleware/with-security-events';
const app = new Hono();
app.post('/x', withSecurityEvents(async (c) => c.json({ ok: true })));
app.put('/y', withSecurityEvents(async (c) => c.json({ ok: true })));
app.delete('/z', async (c) => c.json({ ok: true }));
`,
  );
  // GET handler should not be counted at all.
  writeFileSync(
    join(routesDir, 'b.router.ts'),
    `
import { Hono } from 'hono';
const app = new Hono();
app.get('/q', async (c) => c.json({ ok: true }));
`,
  );
  // Allowlist file.
  mkdirSync(join(tmp, '.github'), { recursive: true });
  writeFileSync(
    join(tmp, '.github', 'security-route-allowlist.yml'),
    `routes:\n  - path: services/foo/src/routes/never.ts\n    reason: stub\n`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runScanner(threshold: number) {
  return spawnSync('node', [SCANNER, '--threshold', String(threshold)], {
    cwd: tmp,
    encoding: 'utf8',
  });
}

describe('security-route-coverage scanner', () => {
  it('counts mutating handlers and detects wrapped vs unwrapped', () => {
    const r = runScanner(0.9);
    expect(r.stdout).toBeTruthy();
    const report = JSON.parse(r.stdout);
    expect(report.totals.handlersConsidered).toBe(3); // post, put, delete
    expect(report.totals.handlersWrapped).toBe(2);
    expect(report.totals.coverage).toBeCloseTo(2 / 3, 4);
  });

  it('exits 1 when coverage below threshold', () => {
    const r = runScanner(0.9);
    expect(r.status).toBe(1);
  });

  it('exits 0 when threshold is met', () => {
    const r = runScanner(0.5);
    expect(r.status).toBe(0);
  });

  it('produces a JSON report with the expected schema fields', () => {
    const r = runScanner(0.5);
    const report = JSON.parse(r.stdout);
    expect(report).toHaveProperty('schemaVersion', 1);
    expect(report).toHaveProperty('threshold');
    expect(report).toHaveProperty('totals');
    expect(report).toHaveProperty('violations');
    expect(report).toHaveProperty('fileReports');
  });
});
