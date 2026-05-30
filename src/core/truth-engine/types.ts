/**
 * Continuous Truth Engine — Core Types
 *
 * Evidence-backed knowledge with provenance, TTL refresh, and human oversight.
 * Every claim the AI makes about a price, rate, regulation, or threshold is
 * anchored to a row in `truth_claims` with at least one supporting `truth_evidence`
 * record. If no fresh verified claim exists, the AI must defer; it must NEVER lie.
 */

// ============================================================================
// Claim taxonomy
// ============================================================================

export type ClaimCategory =
  | "pricing" // bank loan rates, fees
  | "forex" // exchange rates
  | "commodity" // crop/market prices
  | "regulatory" // tax rates, thresholds, caps
  | "structural" // business reg requirements, KYC
  | "benchmark" // sector averages
  | "geographic" // region-specific facts
  | "institutional"; // which banks/MNOs/MFIs exist

export type ClaimStatus =
  | "pending_review"
  | "verified"
  | "disputed"
  | "expired"
  | "retired";

export type EvidenceSourceType =
  | "official_gov"
  | "bank_official"
  | "regulator"
  | "news"
  | "academic"
  | "industry_report"
  | "user_contributed"
  | "llm_consensus"
  | "partner_api";

export type ReviewReason =
  | "new_low_confidence"
  | "refresh_disagreement"
  | "cross_provider_diverge"
  | "user_dispute"
  | "expiry_approaching";

// ============================================================================
// Database row shapes (mirror schema in 20260430_truth_engine.sql)
// ============================================================================

export interface TruthClaimRow {
  readonly id: string;
  readonly category: ClaimCategory;
  readonly subject: string;
  readonly fact_key: string;
  readonly claim_text: string;
  readonly numeric_value: number | null;
  readonly unit: string | null;
  readonly jurisdiction: string;
  readonly confidence: number;
  readonly status: ClaimStatus;
  readonly effective_date: string | null;
  readonly expiry_date: string | null;
  readonly ttl_seconds: number;
  readonly last_verified_at: string;
  readonly next_refresh_at: string;
  readonly created_by: string;
  readonly curated_by: string | null;
  readonly curated_at: string | null;
  readonly curator_notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TruthEvidenceRow {
  readonly id: string;
  readonly claim_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_url: string | null;
  readonly source_domain: string | null;
  readonly source_authority: number;
  readonly excerpt: string;
  readonly full_text: string | null;
  readonly retrieved_at: string;
  readonly retrieved_by: string;
  readonly content_hash: string;
  readonly parent_evidence_id: string | null;
  readonly created_at: string;
}

export interface TruthDisputeRow {
  readonly id: string;
  readonly claim_id: string;
  readonly contradicting_evidence_id: string | null;
  readonly reason: string;
  readonly proposed_new_value: string | null;
  readonly proposed_new_numeric: number | null;
  readonly reported_by: string;
  readonly status:
    | "open"
    | "resolved_kept"
    | "resolved_updated"
    | "resolved_retired";
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly resolution_notes: string | null;
  readonly created_at: string;
}

export interface TruthProviderAuditRow {
  readonly id: string;
  readonly prompt_hash: string;
  readonly prompt_excerpt: string;
  readonly intent: string | null;
  readonly provider_a: "claude" | "openai" | "deepseek";
  readonly provider_b: "claude" | "openai" | "deepseek";
  readonly claim_a: string;
  readonly claim_b: string;
  readonly numeric_a: number | null;
  readonly numeric_b: number | null;
  readonly agreement_score: number | null;
  readonly divergence_flagged: boolean;
  readonly divergence_kind: string | null;
  readonly reviewed_by: string | null;
  readonly reviewed_at: string | null;
  readonly created_at: string;
}

export interface TruthReviewQueueRow {
  readonly id: string;
  readonly claim_id: string;
  readonly reason: ReviewReason;
  readonly priority: number;
  readonly reviewer_id: string | null;
  readonly reviewed_at: string | null;
  readonly decision: "approve" | "reject" | "edit" | null;
  readonly decision_notes: string | null;
  readonly edit_payload: Record<string, unknown> | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

export interface TruthRefreshRunRow {
  readonly id: string;
  readonly triggered_by: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly claims_examined: number;
  readonly claims_refreshed: number;
  readonly claims_unchanged: number;
  readonly claims_disputed: number;
  readonly claims_failed: number;
  readonly evidence_added: number;
  readonly llm_calls: number;
  readonly cost_usd: number;
  readonly errors: ReadonlyArray<{
    readonly claim_id: string;
    readonly error: string;
  }>;
  readonly status: "running" | "completed" | "failed" | "partial";
}

// ============================================================================
// Domain types (used by services)
// ============================================================================

/**
 * Answer-grade — how the AI must frame the answer to the user.
 *
 * The "never lie" invariant: the AI NEVER invents a number. It either has a
 * verified source, has fresh online research it can attribute, or it must
 * defer. The grade tells the response layer which framing to use:
 *
 *   - "verified"          -> "Per [source] dated [date], X."
 *   - "research_estimate" -> "Based on our latest online research [date], ~X. Verify with [authority]."
 *   - "deferred"          -> "I don't have current data on that. Researching now."
 */
export type AnswerGrade = "verified" | "research_estimate" | "deferred";

/**
 * Result of a claim lookup. The engine NEVER returns a value the AI is allowed
 * to present as fact without provenance. If `grade === "deferred"`, the AI is
 * FORBIDDEN from answering with an invented number.
 */
export type ClaimLookupResult =
  | {
      readonly status: "found";
      readonly grade: "verified";
      readonly claim: TruthClaimRow;
      readonly evidence: readonly TruthEvidenceRow[];
      readonly attributionEn: string; // "Per Bank of Tanzania MPS dated 2026-04-15"
      readonly attributionSw: string;
    }
  | {
      readonly status: "found";
      readonly grade: "research_estimate";
      readonly claim: TruthClaimRow;
      readonly evidence: readonly TruthEvidenceRow[];
      readonly attributionEn: string; // "Based on our latest online research dated 2026-04-29"
      readonly attributionSw: string;
      readonly verifyHintEn: string; // "Verify directly with the bank for the current rate."
      readonly verifyHintSw: string;
    }
  | {
      readonly status: "must_defer";
      readonly grade: "deferred";
      readonly reason: "not_found" | "disputed" | "no_authoritative_evidence";
      readonly suggestedDeferralEn: string;
      readonly suggestedDeferralSw: string;
      readonly autoResearchTriggered: boolean; // engine kicked off async refresh
    };

export interface CandidateEvidence {
  readonly sourceType: EvidenceSourceType;
  readonly sourceUrl: string | null;
  readonly sourceDomain: string | null;
  readonly excerpt: string;
  readonly fullText?: string;
  readonly retrievedBy: string;
}

export interface ClaimDraft {
  readonly category: ClaimCategory;
  readonly subject: string;
  readonly factKey: string;
  readonly claimText: string;
  readonly numericValue?: number;
  readonly unit?: string;
  readonly jurisdiction?: string;
  readonly effectiveDate?: string;
  readonly expiryDate?: string;
  readonly evidence: readonly CandidateEvidence[];
  readonly createdBy: string;
  /**
   * Honest-scaffolding flag. When true, the claim is a STRUCTURED QUESTION
   * (subject + fact_key + authority URL) rather than a verified value.
   *
   * - The seed script writes such rows with confidence=0 and
   *   status='pending_review' so the lookup layer NEVER returns grade='verified'
   *   until the cron refresher has fetched the source and confirmed (or
   *   replaced) the templated numericValue.
   * - The numericValue on a pending claim is an INDICATIVE PLACEHOLDER only,
   *   never surfaced to users. The engine must defer or run live research.
   *
   * This is the "no lies" invariant: every generated row is either anchored to
   * a real anchor (regulator/bank URL with stable text — no numeric guess) or
   * marked pendingVerification so the cron must refresh before it can be cited.
   */
  readonly pendingVerification?: boolean;
  /**
   * Initial confidence (0..1). If omitted, defaults to:
   *   - 0.0  when pendingVerification is true (cron must refresh before use)
   *   - 0.85 for hand-curated regulatory/structural anchors
   *   - 0.95 for strong-source institutional anchors
   * The lookup layer treats confidence < 0.5 as ineligible for grade='verified'.
   */
  readonly initialConfidence?: number;
  /**
   * ISO-8601 timestamp marking when this seed was last manually verified by
   * a curator. Used by the lookup layer's 30-day staleness gate
   * (MAX_VERIFIED_AGE_DAYS): if a claim is `pendingVerification: true` AND
   * `lastVerifiedAt` is older than 30 days, the claim is excluded from the
   * fresh-claims set and (if all claims are stale) a `_defer_all_` sentinel
   * is returned so the system prompt instructs the model to defer ALL
   * numeric claims to bank confirmation.
   *
   * Defense-in-depth alongside `pendingVerification`: even an unrefreshed
   * pending seed eventually ages out and is replaced with a "defer all"
   * instruction rather than silently quoted as anchor text.
   */
  readonly lastVerifiedAt?: string;
}
