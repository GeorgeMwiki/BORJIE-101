/**
 * Legal draftsperson types.
 *
 * First-draft-only: every output is QUEUED for human review unless the
 * tenant's autonomy policy explicitly opts into auto-send for that document
 * kind. The compliance invariant `FORBIDDEN_AUTO_SEND` is enforced
 * independently — eviction notices are NEVER auto-sendable, regardless of
 * policy.
 */

import type { Citation } from '../phl-common/types.js';

export type LegalDocumentKind =
  | 'notice_to_vacate'
  | 'lease_addendum'
  | 'demand_letter'
  | 'eviction_notice'
  | 'renewal_offer'
  | 'rent_increase_notice'
  | 'cure_or_quit'
  | 'move_out_statement'
  | 'other';

/**
 * Safety invariant: these kinds MUST always route to human review, even if
 * the autonomy policy claims auto-send. Enforced in code AND in the DB via
 * `legal_drafts_eviction_must_review` check constraint.
 */
export const FORBIDDEN_AUTO_SEND: readonly LegalDocumentKind[] = Object.freeze([
  'eviction_notice',
]);

export interface TenantContextForLegal {
  readonly tenantId: string;
  readonly countryCode: string; // ISO-3166-1
  readonly subdivision?: string; // e.g. US state
  readonly languageCode?: string;
  readonly subjectCustomerId?: string;
  readonly subjectLeaseId?: string;
  readonly subjectPropertyId?: string;
  readonly subjectUnitId?: string;
}

export interface DraftFacts {
  /**
   * Free-form key-value facts the LLM uses to compose the document. Keys
   * like `amountMinor`, `currency`, `effectiveDate`, `noticeDays`, etc.
   */
  readonly [key: string]: unknown;
}

export interface LegalLawSnapshot {
  readonly noticeWindowDays: number;
  readonly requiredClauses: readonly string[];
  readonly citations: readonly string[];
  readonly forbiddenClauses: readonly string[];
  /** Country-level info string, e.g. "TZ-Rent-Restriction-Act-1984". */
  readonly sourceTag: string;
}

export interface LeaseLawDispatchPort {
  /**
   * Global-first dispatch: the call site resolves the country plugin and
   * returns the lease-law snapshot. Throws when the country is unknown
   * AND no fallback is configured — callers MUST pass a valid country.
   */
  resolve(
    countryCode: string,
    documentKind: LegalDocumentKind,
    subdivision?: string,
  ): LegalLawSnapshot;
}

export interface AutonomyPolicyLookup {
  /**
   * Returns the tenant's current policy for "auto-send-legal" for the
   * given document kind. The service NEVER overrides FORBIDDEN_AUTO_SEND.
   */
  canAutoSend(
    tenantId: string,
    documentKind: LegalDocumentKind,
  ): Promise<boolean>;
}

export interface LegalDraftLLMOutput {
  readonly title: string;
  readonly body: string;
  readonly languageCode: string; // echoes the tenant's language
  readonly reviewFlags: readonly string[];
  readonly citedClauses: readonly string[]; // subset of requiredClauses used
  readonly modelVersion: string;
  readonly confidence: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
}

export interface LegalDrafterLLMPort {
  compose(input: {
    readonly documentKind: LegalDocumentKind;
    readonly context: TenantContextForLegal;
    readonly facts: DraftFacts;
    readonly law: LegalLawSnapshot;
    readonly promptHash: string;
  }): Promise<LegalDraftLLMOutput>;
}

export interface LegalDraftRow {
  readonly id: string;
  readonly tenantId: string;
  readonly documentKind: LegalDocumentKind;
  readonly countryCode: string;
  readonly jurisdictionMetadata: Readonly<Record<string, unknown>>;
  readonly subjectCustomerId: string | null;
  readonly subjectLeaseId: string | null;
  readonly subjectPropertyId: string | null;
  readonly subjectUnitId: string | null;
  readonly languageCode: string | null;
  readonly draftTitle: string;
  readonly draftBody: string;
  readonly requiredClauses: readonly string[];
  readonly legalCitations: readonly string[];
  readonly reviewFlags: readonly string[];
  readonly needsHumanReview: boolean;
  readonly status: 'draft';
  readonly autonomyDecision:
    | 'queued_for_review'
    | 'auto_send_allowed'
    | 'auto_send_forbidden';
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly confidence: number;
  readonly context: Readonly<Record<string, unknown>>;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly citations: readonly Citation[];
}

export interface LegalDraftRepository {
  insert(row: LegalDraftRow): Promise<LegalDraftRow>;
  list(
    tenantId: string,
    filter?: { readonly documentKind?: LegalDocumentKind; readonly limit?: number },
  ): Promise<readonly LegalDraftRow[]>;
}
