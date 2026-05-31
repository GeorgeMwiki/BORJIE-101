/**
 * Locale-purity guard — the app-wide tripwire against EN/SW mixing.
 *
 * Fails the build when:
 *   1. a source file NOT on the baseline allowlist hardcodes Swahili
 *      (new mixing sneaking in), or
 *   2. a file ON the allowlist no longer hardcodes Swahili (stale debt
 *      entry — the ledger must shrink monotonically toward []).
 *
 * Migrating a surface to `t()` therefore forces its allowlist line to be
 * deleted in the same change, and the day the list reaches `[]` the
 * cockpit is provably free of hardcoded Swahili.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSwahiliLeaks } from '../locale-purity';
import { SWAHILI_LEAK_ALLOWLIST } from '../locale-purity-allowlist';

// Vitest runs with cwd = the owner-web package root, so the source tree
// is always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('locale purity — owner-web hardcoded Swahili guard', () => {
  const leaks = findSwahiliLeaks(SRC_ROOT);
  const allow = new Set(SWAHILI_LEAK_ALLOWLIST);

  it('introduces no NEW hardcoded-Swahili file (not on the baseline)', () => {
    const fresh = leaks.filter((f) => !allow.has(f));
    expect(
      fresh,
      `New EN/SW mixing detected. Migrate these to t():\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const leakSet = new Set(leaks);
    const stale = SWAHILI_LEAK_ALLOWLIST.filter((f) => !leakSet.has(f));
    expect(
      stale,
      `These files no longer leak Swahili — delete them from ` +
        `locale-purity-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (documents current debt)', () => {
    // Tripwire on the count so a reviewer sees the ledger size move.
    expect(SWAHILI_LEAK_ALLOWLIST.length).toBeLessThanOrEqual(109);
  });
});
