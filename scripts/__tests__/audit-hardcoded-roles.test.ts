/**
 * audit-hardcoded-roles scanner — unit tests (Piece P).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-hardcoded-roles.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hc-roles-'));
  const dir = join(tmp, 'services', 'api-gateway', 'src');
  mkdirSync(dir, { recursive: true });
  // Violating: role-string match in route handler.
  writeFileSync(
    join(dir, 'bad.ts'),
    `
export function isAdmin(user: { role: string }) {
  return user.role === 'admin';
}
`,
  );
  // Not a violation: discriminator tag (kind, not role).
  writeFileSync(
    join(dir, 'kind.ts'),
    `
type Ctx = { kind: 'tenant' | 'platform' };
export function isTenantCtx(c: Ctx) {
  return c.kind === 'tenant';
}
`,
  );
  // Not a violation: Zod-style enum declaration.
  writeFileSync(
    join(dir, 'zod.ts'),
    `
import { z } from 'zod';
export const RoleSchema = z.enum(['admin', 'manager', 'owner']);
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-hardcoded-roles', () => {
  it('flags role === admin in business logic', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toContain('bad.ts');
  });

  it('ignores discriminator-tag comparisons (kind === tenant)', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    const flagged = report.violations.find((v: { file: string }) =>
      v.file.includes('kind.ts'),
    );
    expect(flagged).toBeUndefined();
  });

  it('ignores Zod enum declarations', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    const flagged = report.violations.find((v: { file: string }) =>
      v.file.includes('zod.ts'),
    );
    expect(flagged).toBeUndefined();
  });
});
