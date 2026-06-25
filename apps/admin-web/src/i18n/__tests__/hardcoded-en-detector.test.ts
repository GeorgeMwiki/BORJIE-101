/**
 * Detector self-test — proves the hardcoded-EN scanner actually catches the
 * surface-level EN/SW mix it exists to find (a component rendering English
 * prose with no locale awareness), and does NOT flag the legitimate shapes
 * (locale-aware files, technical tokens, brand names, interpolation, the
 * structural-attribute-only file). Guards against the ratchet silently rotting
 * into a no-op if someone weakens the heuristic.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findHardcodedEnComponents } from '../hardcoded-en';

let root = '';

const FIXTURES: Record<string, string> = {
  // OFFENDERS — render English prose, zero pickByLocale/useLocale.
  'jsx-text.tsx':
    "export function A() { return <h1>Talk to the industry</h1>; }\n",
  'attr-prose.tsx':
    "export function B() { return <input placeholder=\"Tell me what was wrong\" />; }\n",
  'aria-prose.tsx':
    "export function C() { return <button aria-label=\"Reload audit trail\" />; }\n",

  // CLEAN — locale-aware (selects a per-locale branch), so expected.
  'locale-aware.tsx':
    "import { pickByLocale, useLocale } from '@/lib/locale';\n" +
    "export function D() {\n" +
    "  const locale = useLocale();\n" +
    "  return <h1>{pickByLocale(locale, { en: 'Reports', sw: 'Ripoti' })}</h1>;\n" +
    "}\n",
  // CLEAN — brand name only (locale-neutral), under the 2-word floor once
  // the brand token is stripped.
  'brand-only.tsx':
    "export function E() { return <h1>Mr. Mwikila</h1>; }\n",
  // CLEAN — technical / single-word token, below the 2-English-word floor.
  'tech-token.tsx':
    "export function F() { return <code>NDJSON</code>; }\n",
  // CLEAN — interpolation only (data, not prose).
  'interp-only.tsx':
    "export function G({ name }: { name: string }) { return <div>{name}</div>; }\n",
  // CLEAN — only structural attributes carry text (never rendered).
  'structural-attr.tsx':
    "export function H() { return <div className=\"the active panel\" data-testid=\"x\" />; }\n",
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'admin-hardcoded-en-'));
  for (const [name, contents] of Object.entries(FIXTURES)) {
    writeFileSync(join(root, name), contents, 'utf8');
  }
  // A nested i18n/ dir must be exempt even inside the fixture tree.
  mkdirSync(join(root, 'i18n'), { recursive: true });
  writeFileSync(
    join(root, 'i18n', 'exempt.tsx'),
    "export const X = () => <h1>Talk to the industry</h1>;\n",
    'utf8',
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('hardcoded-EN detector — surface-mix coverage', () => {
  it('flags every hardcoded-EN component and nothing else', () => {
    const offenders = findHardcodedEnComponents(root);
    expect(offenders).toEqual([
      'aria-prose.tsx',
      'attr-prose.tsx',
      'jsx-text.tsx',
    ]);
  });

  it('does not flag a locale-aware component', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('locale-aware.tsx');
  });

  it('does not flag a brand-name-only render', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('brand-only.tsx');
  });

  it('does not flag a single technical token', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('tech-token.tsx');
  });

  it('does not flag interpolation-only text', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('interp-only.tsx');
  });

  it('does not flag structural-attribute-only text', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('structural-attr.tsx');
  });

  it('exempts the i18n/ tooling tree', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('i18n/exempt.tsx');
  });
});
