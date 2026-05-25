/**
 * audit-hardcoded-module-list scanner — unit tests (Piece P).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-hardcoded-module-list.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hc-modules-'));
  const dir = join(tmp, 'services', 'api-gateway', 'src');
  mkdirSync(dir, { recursive: true });
  // Violating: inline tenant-module list.
  writeFileSync(
    join(dir, 'bad.ts'),
    `
export const ENABLED_MODULES = ['estate', 'hr', 'fleet'];
`,
  );
  // Zod enum declaration is auto-skipped.
  writeFileSync(
    join(dir, 'zod.ts'),
    `
import { z } from 'zod';
export const ModuleSchema = z.enum(['estate', 'hr', 'fleet']);
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-hardcoded-module-list', () => {
  it('flags inline module-enablement arrays', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(r.stdout);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toContain('bad.ts');
  });
});
