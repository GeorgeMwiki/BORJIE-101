/**
 * Raw-error-message render GUARD — admin-web Class-A barrier.
 *
 * Fails the build when:
 *   1. a source file NOT on the baseline allowlist renders a RAW gateway error
 *      message (`query.error.message` / `err.message`) instead of localizing it
 *      through `localizeApiError(err, locale)` (a new raw-error surface), or
 *   2. a file ON the allowlist is no longer an offender (stale debt entry — the
 *      ledger must shrink monotonically toward []).
 *
 * The baseline is [] (round 11 routed every internal-console error-state render
 * + onError toast through `localizeApiError`), so any newly introduced raw
 * render trips the guard immediately.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RAW_ERROR_RENDER_ALLOWLIST } from '../raw-error-render-allowlist';
import { findRawErrorRenders } from '../raw-error-render';

// Vitest runs with cwd = the admin-web package root, so the source tree is
// always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

describe('raw-error render guard — admin-web Class-A leak', () => {
  const offenders = findRawErrorRenders(SRC_ROOT);
  const allow = new Set(RAW_ERROR_RENDER_ALLOWLIST);

  it('introduces no NEW raw-error render (not on the baseline)', () => {
    const fresh = offenders.filter((f) => !allow.has(f));
    expect(
      fresh,
      `New raw-error render(s) detected — a surface shows a gateway error's ` +
        `raw English message instead of localizing it, so it mixes under the ` +
        `sw toggle. Render the failure through ` +
        `localizeApiError(err, locale) from @borjie/error-catalog:\n${fresh.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps no STALE allowlist entry (the debt ledger only shrinks)', () => {
    const offenderSet = new Set(offenders);
    const stale = RAW_ERROR_RENDER_ALLOWLIST.filter((f) => !offenderSet.has(f));
    expect(
      stale,
      `These files no longer render a raw error — delete them from ` +
        `raw-error-render-allowlist.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('has a baseline that only shrinks (documents current debt)', () => {
    // Round 11 drove admin raw-error renders to zero; the baseline stays empty.
    expect(RAW_ERROR_RENDER_ALLOWLIST.length).toBeLessThanOrEqual(0);
  });
});
