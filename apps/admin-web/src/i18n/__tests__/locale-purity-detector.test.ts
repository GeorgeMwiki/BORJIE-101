/**
 * Detector self-test — proves the locale-purity scanner actually catches the
 * EN/SW code-switching shapes that escaped review (so the ratchet can never
 * silently rot into a no-op if someone weakens the heuristic regexes).
 *
 * Runs `findLanguageMixes` over a throwaway fixture tree containing the real
 * escaped-bug strings plus the legitimate strings that MUST NOT trip it
 * (pure single-locale copy, Swahili loanwords like `data`, interpolated
 * `${status}` templates, ALL-CAPS command tokens like `CONFIRM`).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findLanguageMixes } from '../locale-purity';

let root = '';

const FIXTURES: Record<string, string> = {
  // The exact escaped-bug shapes — each MUST be flagged.
  'mixed-eyebrow.tsx':
    'export const eyebrow = "Platform - Uangalifu";\n',
  'mixed-subtitle.tsx':
    'export const s = `System health — Afya ya mfumo`;\n',
  'mixed-label.tsx':
    "export const l = 'Tenant — Mteja overview';\n",
  // Legitimate single-locale + loanword + interpolation + command token —
  // each MUST be clean.
  'pure-swahili.tsx':
    "export const a = 'Afya ya jukwaa';\n" +
    "export const b = 'Faragha ya data';\n",
  'pure-english.tsx': "export const a = 'Platform health';\n",
  'interpolated.tsx':
    'export const e = `Huduma ya juu ilirudisha ${status}. Jaribu tena.`;\n',
  'command-token.tsx': "export const c = 'Andika CONFIRM kuendelea';\n",
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'admin-locale-purity-'));
  for (const [name, contents] of Object.entries(FIXTURES)) {
    writeFileSync(join(root, name), contents, 'utf8');
  }
  // A nested i18n/ dir must be exempt even inside the fixture tree.
  mkdirSync(join(root, 'i18n'), { recursive: true });
  writeFileSync(
    join(root, 'i18n', 'exempt.ts'),
    "export const x = 'Platform - Uangalifu';\n",
    'utf8',
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('locale-purity detector — escaped-bug coverage', () => {
  it('flags every EN/SW code-switched literal and nothing else', () => {
    const mixes = findLanguageMixes(root);
    expect(mixes).toEqual([
      'mixed-eyebrow.tsx',
      'mixed-label.tsx',
      'mixed-subtitle.tsx',
    ]);
  });

  it('does not flag pure single-locale copy', () => {
    const mixes = new Set(findLanguageMixes(root));
    expect(mixes.has('pure-swahili.tsx')).toBe(false);
    expect(mixes.has('pure-english.tsx')).toBe(false);
  });

  it('does not flag Swahili templates that interpolate ${...}', () => {
    expect(findLanguageMixes(root)).not.toContain('interpolated.tsx');
  });

  it('does not flag ALL-CAPS literal command tokens (CONFIRM)', () => {
    expect(findLanguageMixes(root)).not.toContain('command-token.tsx');
  });

  it('exempts the i18n/ tooling tree', () => {
    expect(findLanguageMixes(root)).not.toContain('i18n/exempt.ts');
  });
});
