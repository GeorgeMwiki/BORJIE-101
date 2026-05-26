/**
 * Compliance gate — orchestrates the 4 sub-checks (claims, forbidden,
 * disclaimer, geo) and returns a single structured result. Pure.
 */

import type {
  ComplianceContract,
  ComposedAsset,
  SpanCitation,
} from '../types.js';
import { findUncitedClaims, type UncitedClaim } from './claims-validator.js';
import { scanForbiddenPhrases } from './forbidden-phrase-scanner.js';
import { findMissingDisclaimers } from './disclaimer-checker.js';
import { findGeoRestrictionFlags } from './geo-restriction-filter.js';

export interface ComplianceScanResult {
  readonly scan_passed: boolean;
  readonly uncited_claims: ReadonlyArray<UncitedClaim>;
  readonly forbidden_phrases_found: ReadonlyArray<string>;
  readonly missing_disclaimers: ReadonlyArray<string>;
  readonly geo_restriction_flags: ReadonlyArray<string>;
}

export interface ScanArgs {
  readonly asset: ComposedAsset;
  readonly compliance: ComplianceContract;
}

/** Strip hidden `<!--prompt:...-->` markers so they don't enter scans. */
function stripHiddenPrompts(s: string): string {
  return s.replace(/<!--prompt:[^]*?-->\n?/g, '');
}

export function runComplianceScan(args: ScanArgs): ComplianceScanResult {
  const body = stripHiddenPrompts(args.asset.body);
  const citations: ReadonlyArray<SpanCitation> = args.asset.span_citations;

  const uncited: ReadonlyArray<UncitedClaim> = args.compliance.claims_must_cite
    ? findUncitedClaims(body, citations)
    : Object.freeze([] as ReadonlyArray<UncitedClaim>);

  const forbidden = scanForbiddenPhrases({
    body,
    extra_forbidden: args.compliance.forbidden_phrases,
  });

  const missing = findMissingDisclaimers({
    body,
    required_disclaimers: args.compliance.required_disclaimers,
  });

  const geo = findGeoRestrictionFlags({
    body,
    geo_restrictions: args.compliance.geo_restrictions,
  });

  const scan_passed =
    uncited.length === 0 &&
    forbidden.length === 0 &&
    missing.length === 0 &&
    geo.length === 0;

  return {
    scan_passed,
    uncited_claims: uncited,
    forbidden_phrases_found: forbidden,
    missing_disclaimers: missing,
    geo_restriction_flags: geo,
  };
}

export { findUncitedClaims, claimsAllCited } from './claims-validator.js';
export type { UncitedClaim } from './claims-validator.js';
export { scanForbiddenPhrases } from './forbidden-phrase-scanner.js';
export { findMissingDisclaimers } from './disclaimer-checker.js';
export { findGeoRestrictionFlags } from './geo-restriction-filter.js';
