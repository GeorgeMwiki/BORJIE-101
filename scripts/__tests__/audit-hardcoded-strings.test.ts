/**
 * audit-hardcoded-strings scanner — unit tests (Piece P).
 *
 * Spawns the scanner against a synthetic apps/ tree so the real repo
 * layout doesn't influence the outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(__filename, '..', '..', 'audit-hardcoded-strings.mjs');

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hc-strings-'));
  const srcDir = join(tmp, 'apps', 'customer-app', 'src', 'pages');
  mkdirSync(srcDir, { recursive: true });
  // Violating file — hardcoded English attribute.
  writeFileSync(
    join(srcDir, 'bad.tsx'),
    `
import React from 'react';
export function Bad(): JSX.Element {
  return <input placeholder="Enter your name here" aria-label="Search field" />;
}
`,
  );
  // Clean file — uses i18n.
  writeFileSync(
    join(srcDir, 'good.tsx'),
    `
import React from 'react';
import { useTranslations } from 'next-intl';
export function Good(): JSX.Element {
  const t = useTranslations('foo');
  return <input placeholder={t('namePlaceholder')} aria-label={t('searchLabel')} />;
}
`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('audit-hardcoded-strings', () => {
  it('exits non-zero when a user-facing English string is hardcoded', () => {
    const r = spawnSync(process.execPath, [SCANNER, '--root', tmp], {
      encoding: 'utf8',
    });
    // The synthetic tree contains a violation — strict mode (default)
    // returns non-zero.
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bad.tsx');
  });

  it('returns valid JSON when --json is set', () => {
    const r = spawnSync(
      process.execPath,
      [SCANNER, '--json', '--no-strict', '--root', tmp],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.scanner).toBe('hardcoded-strings');
    expect(report.violations.length).toBeGreaterThanOrEqual(1);
    expect(report.violations[0].file).toContain('bad.tsx');
  });
});
