/**
 * Phone helpers — Issue #207 (world-scale tenants), WS-4.
 *
 * Thin wrapper that resolves the E.164 dialing code for a tenant
 * from the JURISDICTION_DEFAULTS registry. Production code never
 * hard-codes '+255' — it goes through this helper.
 *
 * The actual normalization (strip trunk prefix, glue dialing code)
 * lives in `services/identity/src/phone-normalize.ts`. This helper
 * just answers "what dialing code does THIS tenant want?".
 */

import {
  getDefaultsByCountry,
  getJurisdictionDefaults,
} from './jurisdictions.js';
import type { TenantConfig } from './types.js';

/**
 * Returns the E.164 dialing code (no leading '+') for the tenant.
 * Falls back to the regulator-set defaults; ultimately falls back
 * to TZ (255). Never throws — phone fallback to the platform
 * beachhead is safer than blocking a signup mid-flow.
 */
export function dialingCodeForTenant(cfg: TenantConfig): string {
  const byCountry = getDefaultsByCountry(cfg.countryCode);
  if (byCountry) return byCountry.phonePrefix;
  return getJurisdictionDefaults(cfg.regulatorSet).phonePrefix;
}

/**
 * Returns the `+CC` prefix (with the leading '+') for use in
 * presentation copy. NEVER use this to BUILD a normalized phone —
 * `services/identity` `normalizePhoneForCountry` is the only path
 * that should compose the full E.164 string.
 */
export function dialingPrefixForTenant(cfg: TenantConfig): string {
  return `+${dialingCodeForTenant(cfg)}`;
}
