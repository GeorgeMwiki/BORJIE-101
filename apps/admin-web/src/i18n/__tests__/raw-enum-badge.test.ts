/**
 * Raw-enum-badge-label GUARD — admin-web Class-B barrier.
 *
 * Fails the build when:
 *   1. a source file NOT on the baseline allowlist renders a RAW bounded-enum
 *      token as a badge/pill label (`<StubBadge tone={tone(x)}>{x}` /
 *      `<Badge>{row.outcome}</Badge>`) instead of localizing the label through
 *      `localizeEnumLabel(MAP, value, locale)` (a new raw-enum badge), or
 *   2. a file ON the allowlist is no longer an offender (stale debt entry — the
 *      ledger must shrink monotonically toward []).
 *
 * The baseline is [] (round 11 routed every bounded-enum badge label through
 * `localizeEnumLabel`), so any newly introduced raw-enum badge trips the guard
 * immediately.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAW_ENUM_BADGE_ALLOWLIST } from '../raw-enum-badge-allowlist';
import { findRawEnumBadges } from '../raw-enum-badge';

// Vitest runs with cwd = the admin-web package root, so the source tree is
// always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('raw-enum-badge guard — admin-web Class-B leak', () => {
  const offenders = findRawEnumBadges(SRC_ROOT);
  const allow = new Set(RAW_ENUM_BADGE_ALLOWLIST);

  it('introduces no NEW raw-enum badge label (not on the baseline)', () => {
    const fresh = offenders.filter((f) => !allow.has(f));
    expect(
      fresh,
      `New raw-enum badge label(s) detected — a StubBadge/Badge renders a ` +
        `bare bounded-enum token (status/state/severity/outcome/kind/posture/` +
        `level) as its label, so it mixes under the sw toggle. Add the token's ` +
        `{ en, sw } pair to enum-labels.ts and render the label through ` +
        `localizeEnumLabel(MAP, value, locale):\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const offenderSet = new Set(offenders);
    const stale = RAW_ENUM_BADGE_ALLOWLIST.filter((f) => !offenderSet.has(f));
    expect(
      stale,
      `These files no longer render a raw-enum badge label — delete them from ` +
        `raw-enum-badge-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (documents current debt)', () => {
    // Round 11 drove admin raw-enum badge labels to zero; baseline stays empty.
    expect(RAW_ENUM_BADGE_ALLOWLIST.length).toBeLessThanOrEqual(0);
  });
});
