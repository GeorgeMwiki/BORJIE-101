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

import { findHardcodedEnComponents, findHardcodedEnOffenders } from '../hardcoded-en';

let root = '';

const FIXTURES: Record<string, string> = {
  // OFFENDERS — render English prose, zero pickByLocale/useLocale.
  'jsx-text.tsx':
    "export function A() { return <h1>Talk to the industry</h1>; }\n",
  'attr-prose.tsx':
    "export function B() { return <input placeholder=\"Tell me what was wrong\" />; }\n",
  'aria-prose.tsx':
    "export function C() { return <button aria-label=\"Reload audit trail\" />; }\n",

  // OFFENDER — round-13 widening: resolves the locale for DATE formatting
  // (useLocale + a bcp47For helper) yet has NO pickByLocale, so its prose is
  // hardcoded English under sw. The bare `useLocale` token used to grant a
  // false exemption; the widened gate now bites this shape.
  'uses-locale-but-hardcodes-en.tsx':
    "import { useLocale } from '@/lib/locale';\n" +
    "function bcp47For(l: string) { return l === 'sw' ? 'sw-TZ' : 'en-GB'; }\n" +
    "export function Z({ at }: { at: string }) {\n" +
    "  const locale = useLocale();\n" +
    "  return (\n" +
    "    <div>\n" +
    "      <p>Sign in as super-admin to verify the chain.</p>\n" +
    "      <time>{new Date(at).toLocaleString(bcp47For(locale))}</time>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n",

  // OFFENDER — round-14 widening: the file localizes MOST of its surface with
  // pickByLocale, but ONE rendered prose run escaped the i18n layer (a bare JSX
  // text node). The round-13 gate cleared the whole file the instant it saw
  // pickByLocale anywhere, so this single hardcoded sentence was invisible. The
  // widened gate decides per rendered string and now bites it.
  'per-string-leak.tsx':
    "import { pickByLocale, useLocale } from '@/lib/locale';\n" +
    "export function Y() {\n" +
    "  const locale = useLocale();\n" +
    "  return (\n" +
    "    <div>\n" +
    "      <h1>{pickByLocale(locale, { en: 'Reports', sw: 'Ripoti' })}</h1>\n" +
    "      <p>Which orchestrator tools answered the last turn.</p>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n",

  // CLEAN — locale-aware (selects a per-locale STRING branch), so expected.
  'locale-aware.tsx':
    "import { pickByLocale, useLocale } from '@/lib/locale';\n" +
    "export function D() {\n" +
    "  const locale = useLocale();\n" +
    "  return <h1>{pickByLocale(locale, { en: 'Reports', sw: 'Ripoti' })}</h1>;\n" +
    "}\n",
  // CLEAN — a string-literal attribute localized via an EXPRESSION value
  // (placeholder={pickByLocale(...)}) is skipped: the user-facing-attr scanner
  // only matches ="..."/'...'/={`...`} literal forms, not ={expr}. Proves the
  // per-string widening does not regress a correctly localized attribute.
  'localized-attr.tsx':
    "import { pickByLocale, useLocale } from '@/lib/locale';\n" +
    "export function I() {\n" +
    "  const locale = useLocale();\n" +
    "  return <input placeholder={pickByLocale(locale, { en: 'Tell me what was wrong', sw: 'Niambie nini kilikosea' })} />;\n" +
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
      'per-string-leak.tsx',
      'uses-locale-but-hardcodes-en.tsx',
    ]);
  });

  it('flags the uses-locale-but-hardcodes-English shape (round-13 widening)', () => {
    // A file that resolves the locale only for date formatting, with no
    // pickByLocale, used to be invisible — the bare `useLocale` token granted
    // a false exemption. The widened gate now catches it and tags the shape.
    const offenders = findHardcodedEnOffenders(root);
    const hit = offenders.find(
      (o) => o.file === 'uses-locale-but-hardcodes-en.tsx',
    );
    expect(hit).toBeDefined();
    expect(hit?.shape).toBe('uses-locale-but-hardcodes-english');
  });

  it('tags a wholly locale-unaware offender as the no-locale shape', () => {
    const offenders = findHardcodedEnOffenders(root);
    const hit = offenders.find((o) => o.file === 'jsx-text.tsx');
    expect(hit?.shape).toBe('no-locale');
  });

  it('flags a per-string leak inside an otherwise-localized file (round-14)', () => {
    // The file localizes its <h1> via pickByLocale but leaks one bare <p> text
    // node. The round-13 whole-file exemption hid it; the per-string gate bites.
    const offenders = findHardcodedEnOffenders(root);
    const hit = offenders.find((o) => o.file === 'per-string-leak.tsx');
    expect(hit).toBeDefined();
    expect(hit?.shape).toBe('per-string-leak');
  });

  it('does not flag a locale-aware component', () => {
    expect(findHardcodedEnComponents(root)).not.toContain('locale-aware.tsx');
  });

  it('does not flag an attribute localized via an expression value', () => {
    // placeholder={pickByLocale(...)} is an expression attribute the scanner
    // structurally skips — only ="..."/'...' literal attrs are user-facing prose.
    expect(findHardcodedEnComponents(root)).not.toContain('localized-attr.tsx');
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
