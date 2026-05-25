/**
 * audit-hardcoded-entity-types scanner — unit tests (Piece P).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-hardcoded-entity-types.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hc-entity-'));
  const dir = join(tmp, 'services', 'api-gateway', 'src');
  mkdirSync(dir, { recursive: true });
  // Violating: entityType === literal.
  writeFileSync(
    join(dir, 'bad.ts'),
    `
export function isProperty(row: { entityType: string }) {
  return row.entityType === 'PROPERTY';
}
`,
  );
  // Zod schema declaration — not a violation.
  writeFileSync(
    join(dir, 'zod.ts'),
    `
import { z } from 'zod';
export const EntityTypeSchema = z.enum(['PROPERTY', 'UNIT', 'LEASE']);
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-hardcoded-entity-types', () => {
  it('flags entityType === PROPERTY in business logic', () => {
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
