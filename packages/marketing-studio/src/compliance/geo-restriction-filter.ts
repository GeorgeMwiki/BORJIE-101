/**
 * Geo-restriction filter — per spec §8 + §11.
 *
 * Some claims are legal in TZ but restricted in US/EU (e.g. forward
 * looking statements about returns require Reg D / MiFID-equivalent
 * disclosures). This filter takes a list of restricted-jurisdiction
 * codes and a body, and returns flags when the body contains claims
 * that should not be published into a restricted jurisdiction.
 *
 * Conservative — flags whenever any of a known set of restricted
 * claim patterns appears. The publish-time decision (block vs.
 * geo-fence) is made by the channel adapter using these flags.
 */

const RESTRICTED_CLAIM_PATTERNS: ReadonlyArray<readonly [string, string]> =
  Object.freeze([
    ['expected returns of', 'forward_looking_returns'],
    ['expected yield of', 'forward_looking_returns'],
    ['guaranteed dividend', 'forward_looking_returns'],
    ['target irr', 'forward_looking_returns'],
    ['projected payback', 'forward_looking_returns'],
    ['as good as gold', 'misleading_safety'],
    ['fully insured', 'insurance_claim'],
    ['government-backed', 'sovereign_claim'],
  ]);

export interface GeoFilterArgs {
  readonly body: string;
  readonly geo_restrictions: ReadonlyArray<string>;
}

/**
 * Return the geo-restriction flags found in the body. The caller
 * uses these to: (a) block publish in restricted jurisdictions,
 * (b) attach required local disclosures, or (c) refuse with
 * `GEO_RESTRICTED`.
 */
export function findGeoRestrictionFlags(
  args: GeoFilterArgs,
): ReadonlyArray<string> {
  if (args.geo_restrictions.length === 0) {
    return Object.freeze([]);
  }
  const lowered = args.body.toLowerCase();
  const flags = new Set<string>();
  for (const [pattern, label] of RESTRICTED_CLAIM_PATTERNS) {
    if (lowered.includes(pattern)) {
      for (const jurisdiction of args.geo_restrictions) {
        flags.add(`${jurisdiction}:${label}`);
      }
    }
  }
  return Object.freeze(Array.from(flags));
}
