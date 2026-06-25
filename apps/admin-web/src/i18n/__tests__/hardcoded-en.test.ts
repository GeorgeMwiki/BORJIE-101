/**
 * Hardcoded-EN-component guard — the admin-console tripwire against the
 * SURFACE-level EN/SW mix the intra-string `locale-purity` guard is BLIND to.
 *
 * The intra-string guard catches a single rendered STRING carrying both
 * languages. It says nothing about a component whose every string is pure,
 * correct English but which has NO locale awareness — under the `sw` toggle
 * that component renders English under Swahili chrome (a mix at the surface,
 * on every load). This guard scans `src` for any component / page `.tsx` that
 * renders user-facing English prose yet has ZERO `pickByLocale` / `useLocale`.
 *
 * Fails the build when:
 *   1. a source file NOT on the baseline allowlist renders hardcoded English
 *      with no locale awareness (a new hardcoded-EN surface), or
 *   2. a file ON the allowlist is no longer an offender (stale debt entry —
 *      the ledger must shrink monotonically toward []).
 *
 * The baseline is [] (round 10 routed all 19 hardcoded-EN admin surfaces
 * through `pickByLocale`), so any newly introduced hardcoded-EN component
 * trips the guard immediately.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HARDCODED_EN_ALLOWLIST } from '../hardcoded-en-allowlist';
import { findHardcodedEnComponents } from '../hardcoded-en';

// Vitest runs with cwd = the admin-web package root, so the source tree is
// always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('hardcoded-EN guard — admin-web surface-level EN/SW mix', () => {
  const offenders = findHardcodedEnComponents(SRC_ROOT);
  const allow = new Set(HARDCODED_EN_ALLOWLIST);

  it('introduces no NEW hardcoded-EN component (not on the baseline)', () => {
    const fresh = offenders.filter((f) => !allow.has(f));
    expect(
      fresh,
      `New hardcoded-EN surface(s) detected — a component renders English ` +
        `prose with no pickByLocale/useLocale, so it mixes under the sw ` +
        `toggle. Route every rendered string through ` +
        `pickByLocale(locale, { en, sw }) and seed the locale from the ` +
        `server:\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const offenderSet = new Set(offenders);
    const stale = HARDCODED_EN_ALLOWLIST.filter((f) => !offenderSet.has(f));
    expect(
      stale,
      `These files are no longer hardcoded-EN — delete them from ` +
        `hardcoded-en-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (documents current debt)', () => {
    // Tripwire on the count so a reviewer sees the ledger size move. Round 10
    // drove admin hardcoded-EN to zero; the baseline starts and stays empty.
    expect(HARDCODED_EN_ALLOWLIST.length).toBeLessThanOrEqual(0);
  });
});
