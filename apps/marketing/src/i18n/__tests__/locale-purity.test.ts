/**
 * Locale-purity guard for @borjie/marketing (finding KI-22).
 *
 * The marketing site ships two flat JSON dictionaries — `en.json` and
 * `sw.json` — resolved by a single `t()` helper. Unlike owner-web (whose
 * guard scans the SOURCE tree for hardcoded Swahili), the marketing
 * strings all live in JSON, so this guard operates directly on the two
 * bundles and enforces the zero-mix canon at the value level:
 *
 *   (a) KEY PARITY, both directions — every leaf path present in en.json
 *       is present in sw.json and vice-versa. A missing key is a canon
 *       violation (a missing sw value that would render the en string IS
 *       mixing), so it fails the build rather than falling back.
 *
 *   (b) VALUE PURITY — no Swahili leaf value byte-equals its English peer
 *       UNLESS its path is on the explicit proper-noun allowlist
 *       (`SHARED_VALUE_ALLOWLIST`: brand names, emails, URLs, hashes,
 *       numbers, icon ids, enum tones, place/mineral names, and
 *       product/technical tokens with no natural Swahili rendering).
 *       A NEW English-in-sw value (sw === en on an unlisted path) fails.
 *       A STALE allowlist entry (listed path no longer shares its value)
 *       ALSO fails — the ledger only shrinks toward proper nouns.
 *
 * Adding an English fragment to sw.json, or breaking parity, turns this
 * suite red. That is the intended CI backstop.
 */

import { describe, expect, it } from 'vitest';

import en from '@/i18n/en.json';
import sw from '@/i18n/sw.json';
import { SHARED_VALUE_ALLOWLIST } from '@/i18n/locale-purity-allowlist';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Flatten a nested dictionary to a map of dotted leaf-path → string value.
 * Array indices are rendered `[n]`; non-string leaves are ignored (only
 * user-facing strings are subject to the language canon).
 */
function flattenStrings(
  node: Json | undefined,
  prefix: string,
  acc: Map<string, string>,
): Map<string, string> {
  if (node === undefined) {
    return acc;
  }
  if (typeof node === 'string') {
    acc.set(prefix, node);
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      flattenStrings(child, `${prefix}[${index}]`, acc),
    );
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenStrings(node[key], next, acc);
    }
  }
  return acc;
}

const enLeaves = flattenStrings(en as Json, '', new Map());
const swLeaves = flattenStrings(sw as Json, '', new Map());
const allow = new Set(SHARED_VALUE_ALLOWLIST);

describe('locale purity — marketing en/sw dictionaries', () => {
  it('has full key parity: every en leaf exists in sw', () => {
    const missingInSw = [...enLeaves.keys()]
      .filter((key) => !swLeaves.has(key))
      .sort();
    expect(
      missingInSw,
      `Keys present in en.json but missing from sw.json (parity break — ` +
        `a missing sw value would render English, which is mixing):\n${missingInSw.join(
          '\n',
        )}`,
    ).toEqual([]);
  });

  it('has full key parity: every sw leaf exists in en', () => {
    const missingInEn = [...swLeaves.keys()]
      .filter((key) => !enLeaves.has(key))
      .sort();
    expect(
      missingInEn,
      `Keys present in sw.json but missing from en.json (parity break):\n${missingInEn.join(
        '\n',
      )}`,
    ).toEqual([]);
  });

  it('has no English-in-Swahili value outside the proper-noun allowlist', () => {
    const shared = [...enLeaves.entries()]
      .filter(([key, enValue]) => {
        const swValue = swLeaves.get(key);
        return (
          swValue !== undefined &&
          swValue === enValue &&
          enValue.trim() !== '' &&
          !allow.has(key)
        );
      })
      .map(([key, value]) => `${key} :: ${JSON.stringify(value)}`)
      .sort();
    expect(
      shared,
      `These sw.json values byte-equal their en.json peer but are NOT on ` +
        `the proper-noun allowlist. Translate them to Swahili, or (only ` +
        `for a genuine proper noun) add the path to ` +
        `locale-purity-allowlist.ts:\n${shared.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the ledger only shrinks)', () => {
    const stale = SHARED_VALUE_ALLOWLIST.filter((key) => {
      const enValue = enLeaves.get(key);
      const swValue = swLeaves.get(key);
      // Stale = the path no longer shares its value (either translated,
      // renamed, or removed) — so it must be deleted from the allowlist.
      return enValue === undefined || swValue === undefined || enValue !== swValue;
    }).sort();
    expect(
      stale,
      `These allowlist paths no longer share an en/sw value — delete them ` +
        `from locale-purity-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
