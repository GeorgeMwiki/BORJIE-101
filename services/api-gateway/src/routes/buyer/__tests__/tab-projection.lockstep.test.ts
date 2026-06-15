/**
 * BUYER LOCKSTEP GUARD — server BUYER_PROJECTABLE_TAB_KINDS ⊆ mobile screen-map.
 *
 * The owner-spawn → buyer projection bridge has TWO ends that must stay in
 * lockstep (the buyer twin of the KI-008 workforce guard):
 *   • SERVER: `BUYER_PROJECTABLE_TAB_KINDS` (routes/buyer/tab-projection.hono.ts)
 *     — the kinds the gateway will project to the buyer device.
 *   • MOBILE: `BUYER_PROJECTED_KIND_TO_SCREEN`
 *     (apps/buyer-mobile/src/marketplace/buyerTabProjection.ts) — the kinds the
 *     buyer app can actually RENDER (each maps to an expo-router screen).
 *
 * If the server promises a kind the mobile map lacks, the buyer app SILENTLY
 * drops it (into `skippedKinds`) — the owner is told a buyer-facing capability
 * materialized that the buyer never sees. That is a broken completion promise,
 * not honest-degrade. This test fails red the moment the two drift, so a new
 * projectable kind cannot ship server-side without its buyer screen landing in
 * the SAME change.
 *
 * It reads the mobile module from SOURCE (the two packages have separate test
 * harnesses / module graphs, so a cross-package import is not available here);
 * the key set of `BUYER_PROJECTED_KIND_TO_SCREEN` is parsed structurally.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { BUYER_PROJECTABLE_TAB_KINDS } from '../tab-projection.hono';

const HERE = dirname(fileURLToPath(import.meta.url));
// services/api-gateway/src/routes/buyer/__tests__ → repo root → buyer mobile lib.
const MOBILE_PROJECTION_TS = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'apps',
  'buyer-mobile',
  'src',
  'marketplace',
  'buyerTabProjection.ts',
);

/**
 * Extract the literal keys of the `BUYER_PROJECTED_KIND_TO_SCREEN` object from
 * the mobile source. Matches the `key: '...'` / `'key': '...'` entries inside
 * the object body — robust to formatting changes, no transpile needed.
 */
function readMobileScreenKinds(): ReadonlySet<string> {
  const src = readFileSync(MOBILE_PROJECTION_TS, 'utf8');
  const declRe = /export\s+const\s+BUYER_PROJECTED_KIND_TO_SCREEN\b[^=]*=\s*/;
  const declMatch = declRe.exec(src);
  if (!declMatch) {
    throw new Error(
      'lockstep: export const BUYER_PROJECTED_KIND_TO_SCREEN not found in mobile buyerTabProjection.ts',
    );
  }
  const afterEq = declMatch.index + declMatch[0].length;
  const open = src.indexOf('{', afterEq);
  const close = src.indexOf('}', open);
  if (open === -1 || close === -1) {
    throw new Error(
      'lockstep: could not locate BUYER_PROJECTED_KIND_TO_SCREEN body',
    );
  }
  const body = src.slice(open + 1, close);
  const keys = new Set<string>();
  const entryRe = /(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    keys.add(m[1] ?? m[2] ?? m[3] ?? '');
  }
  keys.delete('');
  return keys;
}

describe('buyer server↔mobile projectable-kind lockstep', () => {
  it('reads at least one kind from each end (guards against a parse miss)', () => {
    expect(BUYER_PROJECTABLE_TAB_KINDS.length).toBeGreaterThan(0);
    expect(readMobileScreenKinds().size).toBeGreaterThan(0);
  });

  it('every server-projectable buyer kind has a mobile screen-map entry', () => {
    const mobileKinds = readMobileScreenKinds();
    const orphaned = BUYER_PROJECTABLE_TAB_KINDS.filter(
      (kind) => !mobileKinds.has(kind),
    );
    expect(
      orphaned,
      `server promises buyer kind(s) the mobile app cannot render: ${orphaned.join(
        ', ',
      )} — add the expo-router screen + BUYER_PROJECTED_KIND_TO_SCREEN entry, or remove the kind from BUYER_PROJECTABLE_TAB_KINDS`,
    ).toEqual([]);
  });
});
