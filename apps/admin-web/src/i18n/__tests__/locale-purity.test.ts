/**
 * Locale-purity guard — the admin-console tripwire against EN/SW
 * code-switching inside a single rendered string.
 *
 * admin-web keeps its bilingual copy INLINE (`pickByLocale(locale, { en, sw
 * })`), so Swahili literals are expected — owner-web's "any Swahili literal
 * == leak" scanner does not apply here. The class that escaped review for
 * rounds was intra-string MIXING (e.g. the `Platform - Uangalifu` eyebrow, a
 * `Data`-vs-`Takwimu` code-switched subtitle). This guard scans `src` for a
 * single string literal carrying BOTH languages.
 *
 * Fails the build when:
 *   1. a source file NOT on the baseline allowlist mixes EN+SW in one
 *      literal (new code-switching sneaking in), or
 *   2. a file ON the allowlist no longer mixes (stale debt entry — the
 *      ledger must shrink monotonically toward []).
 *
 * The baseline is [] (round 8 cleaned admin sw-mix), so any newly
 * introduced code-switched string trips the guard immediately.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LANGUAGE_MIX_ALLOWLIST } from '../locale-purity-allowlist';
import { findLanguageMixes } from '../locale-purity';

// Vitest runs with cwd = the admin-web package root, so the source tree is
// always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('locale purity — admin-web EN/SW code-switching guard', () => {
  const mixes = findLanguageMixes(SRC_ROOT);
  const allow = new Set(LANGUAGE_MIX_ALLOWLIST);

  it('introduces no NEW EN/SW-mixed file (not on the baseline)', () => {
    const fresh = mixes.filter((f) => !allow.has(f));
    expect(
      fresh,
      `New EN/SW mixing detected (one rendered string carries both ` +
        `languages). Split each into single-locale ` +
        `pickByLocale(locale, { en, sw }) branches:\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const mixSet = new Set(mixes);
    const stale = LANGUAGE_MIX_ALLOWLIST.filter((f) => !mixSet.has(f));
    expect(
      stale,
      `These files no longer mix EN/SW — delete them from ` +
        `locale-purity-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (documents current debt)', () => {
    // Tripwire on the count so a reviewer sees the ledger size move. Round 8
    // drove admin sw-mix to zero; the baseline starts and stays empty.
    expect(LANGUAGE_MIX_ALLOWLIST.length).toBeLessThanOrEqual(0);
  });
});
