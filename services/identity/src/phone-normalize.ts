/**
 * Phone normalization — ITU-T E.164 without the '+' prefix.
 *
 * Minimal table-driven normalizer covering the regions BORJIE targets.
 * Region config (full list of dialing codes, trunk-prefix rules) ships with
 * `@borjie/region-config` in a later phase; for now we inline a small
 * map so the identity service is self-contained and testable.
 *
 * Unknown country codes throw — refusing to store an ambiguous phone is
 * safer than producing a near-duplicate that later blocks a merge.
 */

/** Known country code -> { dialingCode, trunkPrefix?: string }. */
const REGION_TABLE: Readonly<
  Record<string, { readonly dialingCode: string; readonly trunkPrefix?: string }>
> = {
  TZ: { dialingCode: '255', trunkPrefix: '0' },
  KE: { dialingCode: '254', trunkPrefix: '0' },
  UG: { dialingCode: '256', trunkPrefix: '0' },
  RW: { dialingCode: '250', trunkPrefix: '0' },
  US: { dialingCode: '1' },
  GB: { dialingCode: '44', trunkPrefix: '0' },
};

/** Strip every non-digit character. */
function digitsOnly(input: string): string {
  return input.replace(/\D+/g, '');
}

/**
 * Normalize a raw phone string into E.164 digits (no '+'). The country
 * code determines the dialing prefix and trunk-prefix stripping rule.
 *
 * Throws when `countryCode` isn't recognized or the input is empty.
 */
export function normalizePhoneForCountry(
  phone: string,
  countryCode: string
): string {
  if (!phone || phone.trim().length === 0) {
    throw new Error('normalizePhoneForCountry: phone is empty');
  }
  const region = REGION_TABLE[countryCode];
  if (!region) {
    throw new Error(
      `normalizePhoneForCountry: unknown country code "${countryCode}"`
    );
  }
  let digits = digitsOnly(phone);
  // Order matters: strip the dialing code first (for '+CC...' inputs), then
  // strip the trunk prefix (for '0XXX' inputs). Only one of the two branches
  // should apply to any given input.
  if (digits.startsWith(region.dialingCode)) {
    digits = digits.slice(region.dialingCode.length);
  } else if (region.trunkPrefix && digits.startsWith(region.trunkPrefix)) {
    digits = digits.slice(region.trunkPrefix.length);
  }
  return `${region.dialingCode}${digits}`;
}
