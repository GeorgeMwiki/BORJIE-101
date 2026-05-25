/**
 * audit-hardcoded-routes scanner — unit tests (Piece P).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-hardcoded-routes.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hc-routes-'));
  const dir = join(tmp, 'apps', 'customer-app', 'src', 'pages');
  mkdirSync(dir, { recursive: true });
  // Violating: router.push('/onboarding').
  writeFileSync(
    join(dir, 'bad.tsx'),
    `
import { useRouter } from 'next/navigation';
export function Bad() {
  const router = useRouter();
  router.push('/onboarding');
  return null;
}
`,
  );
  // Clean: uses ROUTES registry.
  writeFileSync(
    join(dir, 'good.tsx'),
    `
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/routes';
export function Good() {
  const router = useRouter();
  router.push(ROUTES.onboarding.root);
  return null;
}
`,
  );
  // /api/ paths are skipped (data-fetching, not navigation).
  writeFileSync(
    join(dir, 'api-fetch.ts'),
    `
export async function fetchUsers() {
  return fetch('/api/v1/users');
}
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-hardcoded-routes', () => {
  it('flags router.push with a literal frontend path', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toContain('bad.tsx');
  });

  it('ignores routes referenced through the ROUTES registry', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    const flagged = report.violations.find((v: { file: string }) =>
      v.file.includes('good.tsx'),
    );
    expect(flagged).toBeUndefined();
  });
});
