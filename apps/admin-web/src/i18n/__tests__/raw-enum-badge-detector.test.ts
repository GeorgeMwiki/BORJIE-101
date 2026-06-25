/**
 * Detector self-test — proves the raw-enum-badge scanner actually catches the
 * Class-B leak it exists to find (a StubBadge/Badge rendering a bare
 * bounded-enum token), and does NOT flag the localized form, a free-data label,
 * or a composed label. Guards against the ratchet silently rotting into a no-op
 * if someone weakens the heuristic (the mutation-proof for the gate).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findRawEnumBadges, fileRendersRawEnumBadge } from '../raw-enum-badge';

let root = '';

const FIXTURES: Record<string, string> = {
  // OFFENDERS — bare bounded-enum token as the badge/pill label.
  'stubbadge-status.tsx':
    "export function A({ entry }: any) { return <StubBadge tone={tone(entry.status)}>{entry.status}</StubBadge>; }\n",
  'badge-outcome.tsx':
    "export function B({ row }: any) { return <Badge variant={v(row.outcome)}>{row.outcome}</Badge>; }\n",
  'stubbadge-severity-multiline.tsx':
    "export function C({ ticket }: any) {\n" +
    "  return (\n" +
    "    <StubBadge tone={sev(ticket.severity)}>\n" +
    "      {ticket.severity}\n" +
    "    </StubBadge>\n" +
    "  );\n" +
    "}\n",

  // CLEAN — localized through the enum-labels helper (the FIX).
  'localized-status.tsx':
    "export function D({ entry, locale }: any) {\n" +
    "  return <StubBadge tone={tone(entry.status)}>{localizeEnumLabel(M, entry.status, locale)}</StubBadge>;\n" +
    "}\n",
  // CLEAN — a FREE-DATA label (provider name / trigger / proper noun), not a
  // bounded enum, so locale-neutral and intentionally not flagged.
  'free-data-provider.tsx':
    "export function E({ row }: any) { return <StubBadge tone=\"neutral\">{row.provider}</StubBadge>; }\n",
  'free-data-trigger.tsx':
    "export function F({ agent }: any) { return <StubBadge tone=\"neutral\">{agent.trigger}</StubBadge>; }\n",
  // CLEAN — a COMPOSED label (count + localized word), not a bare member.
  'composed-label.tsx':
    "export function G({ items, locale }: any) {\n" +
    "  return <StubBadge tone=\"info\">{items.length} {pickByLocale(locale, S.x)}</StubBadge>;\n" +
    "}\n",
  // CLEAN — a localized literal label, no enum token.
  'literal-label.tsx':
    "export function H({ locale }: any) { return <StubBadge tone=\"warn\">{pickByLocale(locale, S.x)}</StubBadge>; }\n",
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'admin-raw-enum-'));
  for (const [name, contents] of Object.entries(FIXTURES)) {
    writeFileSync(join(root, name), contents, 'utf8');
  }
  mkdirSync(join(root, 'i18n'), { recursive: true });
  writeFileSync(
    join(root, 'i18n', 'exempt.tsx'),
    "export const X = ({ e }: any) => <StubBadge tone={t(e.status)}>{e.status}</StubBadge>;\n",
    'utf8',
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('raw-enum-badge detector — Class-B coverage', () => {
  it('flags exactly the raw-enum offenders and nothing else', () => {
    expect(findRawEnumBadges(root)).toEqual([
      'badge-outcome.tsx',
      'stubbadge-severity-multiline.tsx',
      'stubbadge-status.tsx',
    ]);
  });

  it('does not flag the localized badge label', () => {
    expect(findRawEnumBadges(root)).not.toContain('localized-status.tsx');
  });

  it('does not flag a free-data (provider) label', () => {
    expect(findRawEnumBadges(root)).not.toContain('free-data-provider.tsx');
  });

  it('does not flag a free-data (trigger) label', () => {
    expect(findRawEnumBadges(root)).not.toContain('free-data-trigger.tsx');
  });

  it('does not flag a composed (count + word) label', () => {
    expect(findRawEnumBadges(root)).not.toContain('composed-label.tsx');
  });

  it('does not flag a localized literal label', () => {
    expect(findRawEnumBadges(root)).not.toContain('literal-label.tsx');
  });

  it('exempts the i18n/ tooling tree', () => {
    expect(findRawEnumBadges(root)).not.toContain('i18n/exempt.tsx');
  });

  it('the unit predicate bites a bare enum token and is quiet on the fix', () => {
    expect(
      fileRendersRawEnumBadge('<StubBadge tone={t(x.status)}>{x.status}</StubBadge>'),
    ).toBe(true);
    expect(
      fileRendersRawEnumBadge(
        '<StubBadge tone={t(x.status)}>{localizeEnumLabel(M, x.status, locale)}</StubBadge>',
      ),
    ).toBe(false);
    // free-data field is locale-neutral, not a bounded enum
    expect(
      fileRendersRawEnumBadge('<StubBadge tone="neutral">{x.provider}</StubBadge>'),
    ).toBe(false);
  });
});
