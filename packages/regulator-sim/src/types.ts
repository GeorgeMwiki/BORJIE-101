/**
 * Regulator simulation — shared types.
 *
 * Mirrors the artefacts a Tanzania mining regulator (Mining Commission),
 * BRELA, or a PDPA examiner would request: decision audit replays,
 * subject-access / erasure proofs, and a supervision document pack.
 *
 * Ported from LITFIN `src/core/security/regulator-sim`, re-skinned from
 * lending (credit decisions, ECOA, BoT capital ratios) to mining
 * (licence / royalty / payout decisions, mining decision-reason codes,
 * and mining-estate supervision metrics).
 */

/** A single decision the regulator may replay. */
export type DecisionOutcome =
  | 'approve'
  | 'approve_with_conditions'
  | 'decline'
  | 'defer';

/** The mining decision domains the replay covers. */
export type DecisionDomain = 'licence' | 'royalty' | 'payout';

export interface DecisionRecord {
  readonly decisionId: string;
  readonly domain: DecisionDomain;
  readonly decidedAt: string; // ISO 8601
  readonly outcome: DecisionOutcome;
  /** Chain-of-thought sink (id or content hash). Must be present. */
  readonly cotTrace: string;
  /** Decision-reason codes, mining-specific (see DEFAULT_ALLOWED_REASON_CODES). */
  readonly reasonCodes: ReadonlyArray<string>;
  /** Borrower/owner-facing reason notes. Both must be non-empty. */
  readonly reasonNotesEn: string;
  readonly reasonNotesSw: string;
  readonly modelId: string;
  readonly modelCardVersion: string;
  readonly modelCardCurrentAt: string; // ISO 8601 of last model-card review
  readonly fairnessTpDelta: number; // |TPR_protected - TPR_baseline|
  readonly fairnessFpDelta: number;
  /** Whether this action crossed an org / subsidiary boundary. */
  readonly crossOrgAction: boolean;
  readonly approverIds: ReadonlyArray<string>; // for the four-eye check
}

export interface AuditReplayInput {
  readonly fromIso: string;
  readonly toIso: string;
  readonly records: ReadonlyArray<DecisionRecord>;
  /** Allowed disparate-impact tolerance (e.g. 0.1 for +/-10pp). */
  readonly fairnessTolerance: number;
  /** Models registered in the model registry. */
  readonly registeredModelIds: ReadonlyArray<string>;
  /** Reason codes accepted under the mining decision framework. */
  readonly allowedReasonCodes: ReadonlyArray<string>;
  /** Max age (days) for a current model card. */
  readonly modelCardMaxAgeDays: number;
}

export type AuditFindingCode =
  | 'missing_cot'
  | 'missing_bilingual_notes'
  | 'unknown_model'
  | 'stale_model_card'
  | 'disallowed_reason_code'
  | 'fairness_breach'
  | 'missing_four_eye';

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AuditFinding {
  readonly decisionId: string;
  readonly code: AuditFindingCode;
  readonly severity: FindingSeverity;
  readonly detail: string;
}

export interface AuditReplayResult {
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly recordsReplayed: number;
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly passed: boolean;
}

// PDPA -----------------------------------------------------------------------

export interface SubjectAccessRequest {
  readonly subjectId: string;
  readonly receivedAt: string;
  readonly scope: 'full' | 'summary';
}

export interface ErasureRequest {
  readonly subjectId: string;
  readonly receivedAt: string;
}

export type PdpaAction = 'access' | 'erasure';

export interface PdpaResult {
  readonly subjectId: string;
  readonly action: PdpaAction;
  readonly artefactsCount: number;
  readonly fulfilledAt: string;
  readonly redactedFields: ReadonlyArray<string>;
  readonly residualOnLegalHold: ReadonlyArray<string>;
  readonly passed: boolean;
  readonly reason?: string;
}

// Supervision pack -----------------------------------------------------------

export interface SupervisionPackInput {
  readonly periodFromIso: string;
  readonly periodToIso: string;
  readonly institution: string;
  readonly miningLicenceNumber: string;
  /** Royalty remitted to the Mining Commission as a share of assessed (0..1). */
  readonly royaltyRemittanceRatio: number;
  /** Active licences in good standing as a share of total (0..1). */
  readonly licenceComplianceRatio: number;
  /** Treasury liquidity coverage ratio (0..1+). */
  readonly liquidityRatio: number;
  /** AML / sanctions alerts raised + closed in the period. */
  readonly amlAlerts: number;
  readonly amlClosed: number;
}

export interface SupervisionDocument {
  readonly section: string;
  readonly title: string;
  readonly contents: string;
}

export interface SupervisionPackResult {
  readonly institution: string;
  readonly periodFromIso: string;
  readonly periodToIso: string;
  readonly documents: ReadonlyArray<SupervisionDocument>;
  readonly checksum: string;
}

/** Default mining decision-reason codes accepted by the framework. */
export const DEFAULT_ALLOWED_REASON_CODES: ReadonlyArray<string> = [
  'ASSAY_VERIFIED',
  'ASSAY_INSUFFICIENT',
  'LICENCE_VALID',
  'LICENCE_LAPSED',
  'ROYALTY_RECONCILED',
  'ROYALTY_SHORTFALL',
  'COLLATERAL_TITLED',
  'PAYOUT_WITHIN_TREASURY_LIMIT',
  'PAYOUT_EXCEEDS_TREASURY_LIMIT',
  'BENEFICIAL_OWNER_VERIFIED',
  'SANCTIONS_CLEAR',
];
