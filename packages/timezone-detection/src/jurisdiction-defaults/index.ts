/**
 * Jurisdiction → IANA timezone lookup.
 *
 * Combined Africa + ROW table. Lookups are case-insensitive on the
 * alpha-2 code. Missing jurisdictions yield `undefined` — the composite
 * resolver then falls back to UTC.
 */

import type { JurisdictionCode, JurisdictionDefault } from '../types.js';
import { AFRICA_DEFAULTS } from './africa.js';
import { REST_OF_WORLD_DEFAULTS } from './rest-of-world.js';

export { AFRICA_DEFAULTS } from './africa.js';
export { REST_OF_WORLD_DEFAULTS } from './rest-of-world.js';

const ALL: ReadonlyArray<JurisdictionDefault> = Object.freeze([
  ...AFRICA_DEFAULTS,
  ...REST_OF_WORLD_DEFAULTS,
]);

const INDEX: ReadonlyMap<string, JurisdictionDefault> = (() => {
  const m = new Map<string, JurisdictionDefault>();
  for (const entry of ALL) m.set(entry.jurisdiction.toUpperCase(), entry);
  return m;
})();

/** All jurisdiction defaults — Africa first, ROW second. Immutable. */
export const ALL_JURISDICTION_DEFAULTS = ALL;

/** Total count: should be 54 African + ROW. Used by tests. */
export const JURISDICTION_DEFAULTS_COUNT = ALL.length;

/** Returns the default entry for an alpha-2 jurisdiction, or `undefined`. */
export function getJurisdictionDefault(
  code: JurisdictionCode,
): JurisdictionDefault | undefined {
  if (!code || typeof code !== 'string') return undefined;
  return INDEX.get(code.toUpperCase());
}
