/**
 * Postal-code helpers — exact-match probes and administrative-code
 * normalisation.
 *
 * The full postal-code → coords table is provided by an upstream port
 * (geo-platform). This module is the small pure-string layer between
 * the routing engine and that port.
 *
 * Why so thin? Because the resolver only needs to answer "does this
 * area's postal-code list / administrative-code list include the
 * customer's code?" — the geo-platform port is responsible for
 * carrying actual coordinates if a fallback resolution is needed.
 */

/**
 * Case-insensitive set membership probe. Normalises by uppercasing +
 * trimming whitespace.
 */
export function postalCodeMatches(
  customerCode: string | undefined,
  areaCodes: ReadonlyArray<string> | undefined,
): boolean {
  if (!customerCode || !areaCodes || areaCodes.length === 0) return false;
  const normalized = normalize(customerCode);
  for (const code of areaCodes) {
    if (normalize(code) === normalized) return true;
  }
  return false;
}

/**
 * Same probe for administrative codes (e.g. `TZ-DSM`). Same rules.
 */
export function administrativeCodeMatches(
  customerCode: string | undefined,
  areaCodes: ReadonlyArray<string> | undefined,
): boolean {
  return postalCodeMatches(customerCode, areaCodes);
}

function normalize(code: string): string {
  return code.trim().toUpperCase();
}
