/**
 * audit-mobile-zero-mix scanner — unit tests.
 *
 * Proves the mobile arm of the zero-mix canon: a single rendered string
 * carrying BOTH Swahili and English (dual-language COPY constant) is a
 * finding; a legitimate single-language ' · ' data separator is not.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-mobile-zero-mix.mjs');

let tmp: string;

function runScanner(root: string): { code: number; report: any } {
  const r = spawnSync(process.execPath, [SCANNER, '--json', '--root', root], {
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, report: JSON.parse(r.stdout) };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mobile-zeromix-'));
  const dir = join(tmp, 'apps', 'workforce-mobile', 'app', 'worker');
  mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-mobile-zero-mix', () => {
  it('flags a dual-language-in-one-string COPY constant (RED)', () => {
    const dir = join(tmp, 'apps', 'workforce-mobile', 'app', 'worker');
    writeFileSync(
      join(dir, 'BAD.tsx'),
      `const COPY = {\n  loading: 'Inapakia sampuli... · Loading samples...',\n} as const\n`,
    );
    const { code, report } = runScanner(tmp);
    expect(report.summary.findings).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].file).toContain('BAD.tsx');
    expect(code).toBe(1);
  });

  it('does NOT flag a legitimate single-language data separator', () => {
    // Remove the bad file, keep only a benign ' · ' data join.
    rmSync(join(tmp, 'apps', 'workforce-mobile', 'app', 'worker', 'BAD.tsx'));
    const dir = join(tmp, 'apps', 'workforce-mobile', 'app', 'worker');
    writeFileSync(
      join(dir, 'OK.tsx'),
      "const label = `${site.name} · ${site.mineral}`\n",
    );
    const { code, report } = runScanner(tmp);
    expect(report.summary.findings).toBe(0);
    expect(code).toBe(0);
  });
});
