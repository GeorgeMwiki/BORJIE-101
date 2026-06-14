/**
 * KI-008 LOCKSTEP GUARD — server PROJECTABLE_TAB_KINDS ⊆ mobile screen-map.
 *
 * The owner-spawn → workforce projection bridge has TWO ends that must stay
 * in lockstep:
 *   • SERVER: `PROJECTABLE_TAB_KINDS` (routes/workforce/tab-projection.ts) —
 *     the kinds the gateway will project to the worker device.
 *   • MOBILE: `PROJECTED_KIND_TO_SCREEN`
 *     (apps/workforce-mobile/src/lib/workforce-tab-projection.ts) — the kinds
 *     the worker app can actually RENDER (each maps to an expo-router screen).
 *
 * If the server promises a kind the mobile map lacks, the worker app SILENTLY
 * drops it (into `skippedKinds`) — the owner is told a capability materialized
 * that the worker never sees. That is a broken completion promise, not
 * honest-degrade. This test fails red the moment the two drift, so a new
 * projectable kind cannot ship server-side without its mobile screen landing
 * in the SAME change.
 *
 * It reads the mobile module from SOURCE (the two packages have separate test
 * harnesses / module graphs, so a cross-package import is not available here);
 * the key set of `PROJECTED_KIND_TO_SCREEN` is parsed structurally.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { PROJECTABLE_TAB_KINDS } from '../tab-projection';

const HERE = dirname(fileURLToPath(import.meta.url));
// services/api-gateway/src/routes/workforce/__tests__ → repo root → mobile lib.
const MOBILE_PROJECTION_TS = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'apps',
  'workforce-mobile',
  'src',
  'lib',
  'workforce-tab-projection.ts',
);

/**
 * Extract the literal keys of the `PROJECTED_KIND_TO_SCREEN` object from the
 * mobile source. Matches the `key: '...'` / `'key': '...'` entries inside the
 * object body — robust to formatting changes, no transpile needed.
 */
function readMobileScreenKinds(): ReadonlySet<string> {
  const src = readFileSync(MOBILE_PROJECTION_TS, 'utf8');
  // Anchor on the actual EXPORT (the identifier also appears in the doc
  // comment), then take the object body after the `=` assignment — past any
  // `Readonly<Record<...>>` type annotation.
  const declRe = /export\s+const\s+PROJECTED_KIND_TO_SCREEN\b[^=]*=\s*/;
  const declMatch = declRe.exec(src);
  if (!declMatch) {
    throw new Error(
      'lockstep: export const PROJECTED_KIND_TO_SCREEN not found in mobile workforce-tab-projection.ts',
    );
  }
  const afterEq = declMatch.index + declMatch[0].length;
  const open = src.indexOf('{', afterEq);
  const close = src.indexOf('}', open);
  if (open === -1 || close === -1) {
    throw new Error('lockstep: could not locate PROJECTED_KIND_TO_SCREEN body');
  }
  const body = src.slice(open + 1, close);
  const keys = new Set<string>();
  // key: 'screen'  |  'key': 'screen'  |  "key": "screen"
  const entryRe = /(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    keys.add(m[1] ?? m[2] ?? m[3] ?? '');
  }
  keys.delete('');
  return keys;
}

describe('KI-008 server↔mobile projectable-kind lockstep', () => {
  it('reads at least one kind from each end (guards against a parse miss)', () => {
    expect(PROJECTABLE_TAB_KINDS.length).toBeGreaterThan(0);
    expect(readMobileScreenKinds().size).toBeGreaterThan(0);
  });

  it('every server-projectable kind has a mobile screen-map entry', () => {
    const mobileKinds = readMobileScreenKinds();
    const orphaned = PROJECTABLE_TAB_KINDS.filter(
      (kind) => !mobileKinds.has(kind),
    );
    expect(
      orphaned,
      `server promises kind(s) the mobile app cannot render: ${orphaned.join(
        ', ',
      )} — add the expo-router screen + PROJECTED_KIND_TO_SCREEN entry, or remove the kind from PROJECTABLE_TAB_KINDS`,
    ).toEqual([]);
  });
});
