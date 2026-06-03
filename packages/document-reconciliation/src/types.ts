/**
 * Cross-document fact reconciliation — shared types (LP-26).
 *
 * A mining estate accumulates paperwork: NIDA/TIN identity, mining/broker
 * licences, assay certificates, royalty receipts, bank + M-PESA statements,
 * lease agreements. When several documents are submitted for one matter, the
 * brain projects each to a normalized {@link FactBag}, then runs pairwise
 * comparisons to surface mismatches before a decision. STRICT mismatches
 * block; SOFT mismatches flag for human review.
 *
 * Domain-neutral plumbing re-skinned from LITFIN: borrower -> owner/worker,
 * loan documents -> mining/identity/financial documents. Thresholds are
 * named constants (no magic numbers in business logic).
 *
 * @module @borjie/document-reconciliation/types
 */

// ----------------------------------------------------------------------------
// Document taxonomy (mining estate)
// ----------------------------------------------------------------------------

export type MiningDocType =
  | 'nida'
  | 'tin-certificate'
  | 'drivers-licence'
  | 'passport'
  | 'voter-id'
  | 'mining-licence'
  | 'broker-dealer-licence'
  | 'assay-certificate'
  | 'royalty-receipt'
  | 'bank-statement'
  | 'mpesa-statement'
  | 'lease-agreement'
  | 'business-registration'
  | 'tax-clearance'
  | 'other';

// ----------------------------------------------------------------------------
// Normalized value shapes
// ----------------------------------------------------------------------------

export interface NormalizedName {
  readonly first: string;
  readonly middle?: string;
  readonly last: string;
  /** Original full-string after whitespace collapse + uppercase. */
  readonly full: string;
}

/** E.164 phone string. */
export type E164Phone = string;

export interface NormalizedAddress {
  readonly raw: string;
  readonly poBox?: string;
  readonly region?: string;
  readonly district?: string;
  readonly street?: string;
}

export interface BankAccountFact {
  readonly bank: string;
  readonly accountNumber: string;
}

// ----------------------------------------------------------------------------
// FactBag — one per source document
// ----------------------------------------------------------------------------

/** Comparable fact fields; also used as confidence-map keys. */
export type FactField =
  | 'primaryName'
  | 'dateOfBirth'
  | 'nationalId'
  | 'tin'
  | 'phones'
  | 'addresses'
  | 'bankAccounts'
  | 'amount';

export interface FactBag {
  readonly primaryName?: NormalizedName;
  /** ISO 8601 date string YYYY-MM-DD. */
  readonly dateOfBirth?: string;
  /** Digits-only national id. */
  readonly nationalId?: string;
  /** Digits-only TIN. */
  readonly tin?: string;
  readonly phones: readonly E164Phone[];
  readonly addresses: readonly NormalizedAddress[];
  readonly bankAccounts: readonly BankAccountFact[];
  /** Optional monetary fact (e.g. royalty receipt amount), minor-unit-free. */
  readonly amount?: number;
  readonly sourceDocId: string;
  readonly sourceDocType: MiningDocType;
  readonly fieldConfidences: Readonly<Record<FactField, number>>;
}

// ----------------------------------------------------------------------------
// Match results
// ----------------------------------------------------------------------------

export interface NameMatchResult {
  readonly matched: boolean;
  readonly distance: number;
  readonly reasons: readonly string[];
  readonly swapDetected: boolean;
}

export interface AddressMatchResult {
  readonly matched: boolean;
  readonly similarity: number;
  readonly reasons: readonly string[];
}

export type DateTolerance = 'exact' | 'monthYear' | 'year';

// ----------------------------------------------------------------------------
// Mismatch + report
// ----------------------------------------------------------------------------

export type MismatchSeverity = 'STRICT_MISMATCH' | 'SOFT_MISMATCH';

export interface FactPairSource {
  readonly docId: string;
  readonly docType: MiningDocType;
  readonly confidence: number;
}

export interface Mismatch {
  readonly field: FactField;
  readonly severity: MismatchSeverity;
  readonly leftValue: string;
  readonly rightValue: string;
  readonly left: FactPairSource;
  readonly right: FactPairSource;
  readonly reasonCodes: readonly string[];
  readonly explanation: string;
}

export interface Match {
  readonly field: FactField;
  readonly leftValue: string;
  readonly rightValue: string;
  readonly left: FactPairSource;
  readonly right: FactPairSource;
}

export interface Blocker {
  readonly field: FactField;
  readonly explanation: string;
  readonly involvedDocIds: readonly string[];
}

export interface SoftFlag {
  readonly field: FactField;
  readonly explanation: string;
  readonly involvedDocIds: readonly string[];
}

export interface ReconciliationReport {
  readonly mismatches: readonly Mismatch[];
  readonly matches: readonly Match[];
  /** Criticality-weighted share of compared pairs that matched, 0..1. */
  readonly overallConsistency: number;
  readonly blockers: readonly Blocker[];
  readonly softFlags: readonly SoftFlag[];
}

// ----------------------------------------------------------------------------
// Constants — named thresholds (no magic numbers in logic)
// ----------------------------------------------------------------------------

export const NAME_LEVENSHTEIN_SOFT_THRESHOLD = 2;
/**
 * Max extra-token gap for a token-subset name match to count as the SAME
 * person (a single missing/extra middle name). A larger gap (e.g.
 * 'Juma Kessy' vs 'Juma Hassan Kessy Mwita') is too much unexplained name
 * material to treat as a match — it surfaces as a mismatch instead.
 */
export const NAME_SUBSET_MAX_TOKEN_DELTA = 1;
export const ADDRESS_SIMILARITY_MATCH_THRESHOLD = 0.6;
export const ADDRESS_SIMILARITY_STRICT_BELOW = 0.25;
export const LOW_CONFIDENCE_DOWNGRADE_THRESHOLD = 0.7;
export const DEFAULT_FIELD_CONFIDENCE = 1.0;

/** Tanzania country code (default jurisdiction). */
export const DEFAULT_COUNTRY_CODE = '255';

/** Identity fields where a mismatch is STRICT by default (different person). */
export const STRICT_IDENTITY_FIELDS: readonly FactField[] = [
  'nationalId',
  'tin',
  'dateOfBirth',
];

/** Field criticality 0..1 — weights overallConsistency. */
export const FIELD_CRITICALITY: Readonly<Record<FactField, number>> = {
  primaryName: 1.0,
  dateOfBirth: 1.0,
  nationalId: 1.0,
  tin: 0.9,
  phones: 0.7,
  addresses: 0.6,
  bankAccounts: 0.85,
  amount: 0.8,
};

export const REASON_CODES = {
  EXACT_MATCH: 'EXACT_MATCH',
  NORMALIZED_MATCH: 'NORMALIZED_MATCH',
  LEVENSHTEIN_WITHIN_THRESHOLD: 'LEVENSHTEIN_WITHIN_THRESHOLD',
  NAME_SWAP_DETECTED: 'NAME_SWAP_DETECTED',
  MIDDLE_NAME_DIFFERS: 'MIDDLE_NAME_DIFFERS',
  INITIALS_MATCH: 'INITIALS_MATCH',
  ADDRESS_FUZZY_MATCH: 'ADDRESS_FUZZY_MATCH',
  ADDRESS_REGION_MATCH: 'ADDRESS_REGION_MATCH',
  DATE_TOLERANCE_APPLIED: 'DATE_TOLERANCE_APPLIED',
  LOW_CONFIDENCE_DOWNGRADE: 'LOW_CONFIDENCE_DOWNGRADE',
  COMPLETELY_DIFFERENT: 'COMPLETELY_DIFFERENT',
} as const;

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];
