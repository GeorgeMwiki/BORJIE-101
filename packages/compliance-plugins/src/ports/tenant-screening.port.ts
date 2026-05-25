/**
 * TenantScreeningPort — external credit-bureau adapter.
 *
 * Our CreditRatingService computes a GENERAL in-platform score from payment
 * history. Where we ALSO want an external signal (CRB for Kenya, Experian
 * for US/UK, Schufa for Germany), that call is abstracted here.
 *
 * The real implementations are env-gated — callers MUST hold a
 * `consentToken` proving GDPR / local-law consent before invoking.
 * Plugins with no configured integration return a clean
 * "BUREAU_NOT_CONFIGURED" flag instead of crashing.
 */

export interface IdentityDocument {
  /** Document kind — country plugins may add kinds via `kindOther`. */
  readonly kind:
    | 'national-id'
    | 'passport'
    | 'ssn'
    | 'itin'
    | 'bvn'
    | 'nida'
    | 'nin'
    | 'tax-id'
    | 'other';
  /** The raw identifier as presented. Implementations MUST NOT log this. */
  readonly value: string;
  /** ISO-3166-1 alpha-2 issuing country. */
  readonly country: string;
  /** Free-form label when `kind === 'other'`. */
  readonly kindOther?: string;
}

export interface BureauLookupResult {
  /**
   * Score on the bureau's native scale. Callers must use `scoreScaleMax`
   * to normalize — there is no single global scale.
   */
  readonly bureauScore?: number;
  /** Maximum value `bureauScore` can take on this bureau's scale. */
  readonly scoreScaleMax?: number;
  /**
   * Structured flags — always present (empty array on success). Standard
   * tokens callers look for:
   *   'BUREAU_NOT_CONFIGURED'  — no adapter registered for this jurisdiction
   *   'CONSENT_TOKEN_INVALID'  — consent header did not verify
   *   'BUREAU_TIMEOUT'         — upstream did not respond in time
   *   'BUREAU_MATCH_NOT_FOUND' — bureau returned no record
   */
  readonly flags: readonly string[];
  /**
   * Evidence references to persist alongside the credit decision. Each is
   * expected to be an opaque provider reference (URL, receipt ID, trace ID).
   */
  readonly sourceRefs: readonly string[];
  /** Bureau short-name (e.g. 'CRB_KE', 'EXPERIAN_US', 'SCHUFA_DE'). */
  readonly bureau: string;
}

export interface TenantScreeningPort {
  /**
   * Look up the external bureau for `identityDocument`. `consentToken`
   * MUST come from a signed consent envelope; implementations may refuse
   * when the token is missing or cannot be verified.
   */
  lookupBureau(
    identityDocument: IdentityDocument,
    country: string,
    consentToken: string
  ): Promise<BureauLookupResult>;
}

/** Default — returns BUREAU_NOT_CONFIGURED for any input. */
export const DEFAULT_TENANT_SCREENING: TenantScreeningPort = {
  async lookupBureau(_identityDocument, country, _consentToken) {
    return {
      flags: ['BUREAU_NOT_CONFIGURED'],
      sourceRefs: [],
      bureau: `GENERIC_${country.toUpperCase()}`,
    };
  },
};

/**
 * Helper for country plugins that carry a bureau-adapter env prefix but
 * no real network adapter yet — returns a "stubbed" result with a
 * meaningful source ref.
 */
export function buildStubBureauResult(
  bureau: string,
  flags: readonly string[] = ['BUREAU_NOT_CONFIGURED']
): BureauLookupResult {
  return {
    flags,
    sourceRefs: [],
    bureau,
  };
}
