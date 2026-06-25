/**
 * Detector self-test — proves the raw-error-render scanner actually catches the
 * Class-A leak it exists to find (a surface rendering a gateway error's raw
 * `.message`), and does NOT flag the localized form or unrelated `.message`
 * reads. Guards against the ratchet silently rotting into a no-op if someone
 * weakens the heuristic (the mutation-proof for the gate).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findRawErrorRenders, fileRendersRawError } from '../raw-error-render';

let root = '';

const FIXTURES: Record<string, string> = {
  // OFFENDERS.
  'jsx-raw.tsx':
    "export function A({ query }: any) { return <p>{query.error.message}</p>; }\n",
  'ternary-raw.tsx':
    "export function B({ err }: any) { return <span>{err instanceof Error ? err.message : 'x'}</span>; }\n",

  // CLEAN — localized through the catalog (the FIX).
  'jsx-localized.tsx':
    "import { localizeApiError } from '@borjie/error-catalog';\n" +
    "export function C({ query, locale }: any) {\n" +
    "  return <p>{localizeApiError(query.error, locale)}</p>;\n" +
    "}\n",
  'ternary-localized.tsx':
    "import { localizeApiError } from '@borjie/error-catalog';\n" +
    "export function D({ err, locale }: any) {\n" +
    "  return <span>{localizeApiError(err, locale)}</span>;\n" +
    "}\n",
  // CLEAN — a `.message` read feeding a logger, not a render.
  'logger-message.tsx':
    "export function E({ err }: any) { logger.warn(err.message); return <p>ok</p>; }\n",
  // CLEAN — an unrelated `.message` field that is not the react-query
  // `<x>.error.message` render shape.
  'unrelated-message.tsx':
    "export function F({ row }: any) { return <p>{row.summary}</p>; }\n",
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'admin-raw-error-'));
  for (const [name, contents] of Object.entries(FIXTURES)) {
    writeFileSync(join(root, name), contents, 'utf8');
  }
  // i18n/ tooling must be exempt even inside the fixture tree.
  mkdirSync(join(root, 'i18n'), { recursive: true });
  writeFileSync(
    join(root, 'i18n', 'exempt.tsx'),
    "export const X = ({ query }: any) => <p>{query.error.message}</p>;\n",
    'utf8',
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('raw-error-render detector — Class-A coverage', () => {
  it('flags exactly the raw-render offenders and nothing else', () => {
    expect(findRawErrorRenders(root)).toEqual(['jsx-raw.tsx', 'ternary-raw.tsx']);
  });

  it('does not flag the localized JSX form', () => {
    expect(findRawErrorRenders(root)).not.toContain('jsx-localized.tsx');
  });

  it('does not flag the localized ternary form', () => {
    expect(findRawErrorRenders(root)).not.toContain('ternary-localized.tsx');
  });

  it('does not flag a logger `.message` read', () => {
    expect(findRawErrorRenders(root)).not.toContain('logger-message.tsx');
  });

  it('does not flag an unrelated field render', () => {
    expect(findRawErrorRenders(root)).not.toContain('unrelated-message.tsx');
  });

  it('exempts the i18n/ tooling tree', () => {
    expect(findRawErrorRenders(root)).not.toContain('i18n/exempt.tsx');
  });

  it('the unit predicate bites on both shapes and is quiet on the fix', () => {
    expect(fileRendersRawError('<p>{query.error.message}</p>')).toBe(true);
    expect(
      fileRendersRawError("{err instanceof Error ? err.message : 'x'}"),
    ).toBe(true);
    expect(
      fileRendersRawError('<p>{localizeApiError(query.error, locale)}</p>'),
    ).toBe(false);
  });
});
