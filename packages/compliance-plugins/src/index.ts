/**
 * @borjie/compliance-plugins — public entrypoint.
 *
 * Usage:
 *   import { getCountryPlugin, availableCountries } from '@borjie/compliance-plugins';
 *   const tz = getCountryPlugin('TZ');
 *   tz.normalizePhone('0712345678'); // returns the canonical E.164 form for TZ
 *
 * The registry is pre-populated with every bundled plugin at module load time.
 * Callers can register additional / replacement plugins via the exported
 * singleton `countryPluginRegistry`.
 */

import { CountryPluginRegistry } from './core/registry.js';
import type { CountryPlugin } from './core/types.js';

import { kenyaPlugin } from './plugins/kenya.js';
import { nigeriaPlugin } from './plugins/nigeria.js';
import { southAfricaPlugin } from './plugins/south-africa.js';
import { tanzaniaPlugin } from './plugins/tanzania.js';
import { ugandaPlugin } from './plugins/uganda.js';
import { unitedStatesPlugin, withStateOverride } from './plugins/united-states.js';
import { registerAllCountryPlugins as _registerAllCountryPlugins } from './countries/index.js';

export * from './core/index.js';
export * from './ports/index.js';
export * from './validators/index.js';
export {
  EXTENDED_PROFILES,
  GLOBAL_DEFAULT_PROFILE,
  australiaProfile,
  brazilProfile,
  canadaProfile,
  franceProfile,
  germanyProfile,
  getTenantCountryDefault,
  indiaProfile,
  japanProfile,
  koreaProfile,
  mexicoProfile,
  registerAllCountryPlugins,
  resolveExtendedProfile,
  singaporeProfile,
  uaeProfile,
  ukProfile,
  // Wave 27 Agent B — Tanzania first-class.
  tanzaniaProfile,
  // Wave 27 Agent A — 200+ ISO-3166 scaffolds for global coverage.
  SCAFFOLD_PROFILES,
  SCAFFOLD_METADATA,
  SCAFFOLD_COUNTRY_CODES,
} from './countries/index.js';
export type { ExtendedCountryProfile, ScaffoldMetadata } from './countries/index.js';
export {
  kenyaPlugin,
  nigeriaPlugin,
  southAfricaPlugin,
  tanzaniaPlugin,
  ugandaPlugin,
  unitedStatesPlugin,
  withStateOverride,
};
export {
  DEFAULT_PLUGIN,
  getPortCoverageMatrix,
  resolvePlugin,
} from './registry.js';
export type {
  PortCoverageRow,
  ResolvedCountryPlugin,
} from './registry.js';

/**
 * Default country fallback. The presence of a default is intentional — it
 * stops pathological calls from crashing the process — but EVERY real call
 * site MUST pass a country explicitly. Relying on this default in a request
 * path is a bug.
 */
export const DEFAULT_COUNTRY_ID = 'TZ' as const;

/** Process-wide singleton registry. */
export const countryPluginRegistry = new CountryPluginRegistry();

// Register every bundled plugin at module load. The bundled six are
// the authoritative hand-rolled implementations and MUST win over any
// generated scaffold with the same country code.
for (const plugin of [
  tanzaniaPlugin,
  kenyaPlugin,
  ugandaPlugin,
  nigeriaPlugin,
  southAfricaPlugin,
  unitedStatesPlugin,
]) {
  countryPluginRegistry.register(plugin);
}

// Round-3 audit M7 fix — the generated `_registerAllCountryPlugins`
// previously called `register()` unconditionally, which (because the
// registry uses `set()`) silently overwrote the hand-tuned bundled
// plugins if any generated scaffold happened to share a country code.
// We pass `{ overwrite: false }` so the bundled six always win.
_registerAllCountryPlugins(countryPluginRegistry, { overwrite: false });

/**
 * Round-3 audit C6 — thrown by {@link getCountryPlugin} when the
 * supplied `countryCode` does not match any registered plugin.
 *
 * The previous implementation silently fell back to the Tanzania
 * plugin (`DEFAULT_COUNTRY_ID = 'TZ'`), so a typo like `'TZW'` made
 * every lease law, tax regime, deposit cap, and notice-window query
 * return Tanzanian values regardless of where the property actually
 * lived. That is a compliance violation by typo — KRA's MRI rate
 * applied to a Nigerian property, or the wrong deposit cap applied to
 * a Ugandan one. Failing closed surfaces the bug instead of papering
 * over it.
 */
export class UnknownJurisdictionError extends Error {
  readonly code = 'UNKNOWN_JURISDICTION';
  readonly countryCode: string;
  constructor(countryCode: string) {
    super(
      `[compliance-plugins] unknown country code "${countryCode}". ` +
        `Pass an explicit ISO-3166-1 alpha-2 code (e.g. 'KE', 'TZ', 'NG') or ` +
        `use \`resolvePlugin(...)\` from the low-level registry if a typed-` +
        `default fallback is genuinely required.`
    );
    this.name = 'UnknownJurisdictionError';
    this.countryCode = countryCode;
  }
}

/**
 * Resolve a plugin by ISO-3166-1 alpha-2 country code. Case-insensitive.
 *
 * Round-3 audit C6 fix — throws {@link UnknownJurisdictionError} on
 * unknown / missing inputs. Callers that genuinely need a typed
 * default should use `resolvePlugin(...)` from
 * `./registry.js`, which returns `DEFAULT_PLUGIN` (USD / no
 * jurisdiction) and never lies about which country it picked.
 */
export function getCountryPlugin(
  countryCode: string | null | undefined
): CountryPlugin {
  if (!countryCode || !countryCode.trim()) {
    throw new UnknownJurisdictionError(String(countryCode ?? ''));
  }
  const resolved = countryPluginRegistry.resolve(countryCode);
  if (resolved) return resolved;
  throw new UnknownJurisdictionError(countryCode);
}

/** Snapshot of every registered country code (upper-case). */
export function availableCountries(): readonly string[] {
  return countryPluginRegistry.list();
}

/** @deprecated Kept for backwards-compatibility with tests that called
 * the pre-C6 `__resetDefaultFallbackWarning()` helper. No-op now. */
export function __resetDefaultFallbackWarning(): void {
  /* no-op — C6 fix removed the silent fallback path */
}
