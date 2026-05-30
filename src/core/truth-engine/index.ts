/**
 * Continuous Truth Engine — public API
 *
 * Evidence-backed knowledge with daily auto-research, provenance tracking,
 * cross-provider audits, and human-in-the-loop review. The single guarantee
 * this engine provides:
 *
 *     The AI never invents a number. Every monetary, regulatory, or rate
 *     claim is either anchored to a fresh verified source, framed as a
 *     research-estimate with attribution, or deferred entirely.
 */

export type {
  AnswerGrade,
  CandidateEvidence,
  ClaimCategory,
  ClaimDraft,
  ClaimLookupResult,
  ClaimStatus,
  EvidenceSourceType,
  ReviewReason,
  TruthClaimRow,
  TruthDisputeRow,
  TruthEvidenceRow,
  TruthProviderAuditRow,
  TruthRefreshRunRow,
  TruthReviewQueueRow,
} from "./types";

export {
  TTL_BY_CATEGORY,
  computeNextRefreshAt,
  isClaimFresh,
  isClaimNearExpiry,
} from "./ttl-policy";
export { resolveSourceAuthority, extractDomain } from "./source-authority";
export {
  computeConfidence,
  classifyClaimStatus,
  detectNumericDisagreement,
  scoreCandidates,
} from "./evidence-scorer";
export {
  lookupClaim,
  persistClaim,
  searchFreshClaims,
  markExpired,
  DEFER_ALL_FACT_KEY,
} from "./claim-store";
export { collectEvidence } from "./evidence-collector";
export { runDailyRefresh, refreshOnDemand } from "./refresh-scheduler";
export {
  detectClaims,
  gradeResponse,
  isResponseGrounded,
} from "./answer-grader";
export {
  auditProviderPair,
  extractPrimaryClaim,
  hashPrompt,
  shouldSampleForAudit,
} from "./cross-provider-auditor";
export {
  assertFetchAllowed,
  canRefreshOnDemand,
  claimDraftSchema,
  sanitizeExcerptForPrompt,
  scrubPII,
  validateClaimDraft,
  verifyCronSecret,
} from "./security";
