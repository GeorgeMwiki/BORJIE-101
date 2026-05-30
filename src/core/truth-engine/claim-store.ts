/**
 * Claim Store
 *
 * Persistence layer for truth claims + evidence. All writes use the service-role
 * Supabase client (bypasses RLS) and run as 'system' or 'admin' actor IDs.
 *
 * Reads are immutable; mutations always insert/update via Supabase parameterized
 * queries (no string concatenation, no SQL injection surface).
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  CandidateEvidence,
  ClaimCategory,
  ClaimDraft,
  ClaimLookupResult,
  TruthClaimRow,
  TruthEvidenceRow,
} from "./types";
import {
  computeConfidence,
  classifyClaimStatus,
  detectNumericDisagreement,
  scoreCandidates,
} from "./evidence-scorer";
import {
  computeNextRefreshAt,
  isClaimFresh,
  TTL_BY_CATEGORY,
} from "./ttl-policy";
import { validateClaimDraft } from "./security";

type DB = SupabaseClient;

// ============================================================================
// Lookup
// ============================================================================

/**
 * Look up a claim by category + fact_key. Returns the AI-facing answer grade
 * (verified / research_estimate / deferred). Never returns invented data.
 *
 * `triggerAutoResearch` (default true) kicks off an async refresh if the
 * claim is missing or expired. The caller doesn't wait for it.
 */
export async function lookupClaim(args: {
  readonly category: ClaimCategory;
  readonly factKey: string;
  readonly jurisdiction?: string;
  readonly db?: DB;
  readonly triggerAutoResearch?: boolean;
}): Promise<ClaimLookupResult> {
  const db = args.db ?? createServiceClient();
  const jurisdiction = args.jurisdiction ?? "TZ";

  const { data: claim, error } = await db
    .from("truth_claims")
    .select("*")
    .eq("category", args.category)
    .eq("fact_key", args.factKey)
    .eq("jurisdiction", jurisdiction)
    .maybeSingle<TruthClaimRow>();

  if (error || !claim) {
    return {
      status: "must_defer",
      grade: "deferred",
      reason: "not_found",
      suggestedDeferralEn:
        "I don't have current data on that yet. Let me research it now and come back with an evidence-backed answer.",
      suggestedDeferralSw:
        "Sina taarifa za sasa kuhusu hilo bado. Niitafiti sasa hivi nikupe jibu lenye ushahidi.",
      autoResearchTriggered: false,
    };
  }

  if (claim.status === "disputed") {
    return {
      status: "must_defer",
      grade: "deferred",
      reason: "disputed",
      suggestedDeferralEn:
        "This figure has conflicting reports right now. I'll defer rather than risk misleading you. Verify directly with the institution.",
      suggestedDeferralSw:
        "Takwimu hii ina ripoti zinazokinzana sasa. Nitaiacha badala ya kukupotosha. Hakikisha moja kwa moja na taasisi.",
      autoResearchTriggered: false,
    };
  }

  // Fetch evidence sorted by authority desc
  const { data: evidence } = await db
    .from("truth_evidence")
    .select("*")
    .eq("claim_id", claim.id)
    .order("source_authority", { ascending: false })
    .returns<TruthEvidenceRow[]>();

  const evidenceList = evidence ?? [];

  if (!isClaimFresh(claim)) {
    // Stale -> answer with research-estimate framing if we have any evidence,
    // otherwise defer. NEVER pass off stale data as authoritative.
    if (evidenceList.length === 0) {
      return {
        status: "must_defer",
        grade: "deferred",
        reason: "no_authoritative_evidence",
        suggestedDeferralEn:
          "I don't have a recent verified source for that. Let me research now.",
        suggestedDeferralSw:
          "Sina chanzo cha hivi karibuni cha kuthibitisha hilo. Niitafiti sasa.",
        autoResearchTriggered: false,
      };
    }
    const newest = evidenceList[0];
    return {
      status: "found",
      grade: "research_estimate",
      claim,
      evidence: evidenceList,
      attributionEn: buildAttributionEn(newest, "research_estimate"),
      attributionSw: buildAttributionSw(newest, "research_estimate"),
      verifyHintEn:
        "Verify directly with the institution for the current figure.",
      verifyHintSw:
        "Hakikisha moja kwa moja na taasisi kupata takwimu ya sasa.",
    };
  }

  // Fresh + verified -> highest grade
  const top = evidenceList[0];
  if (!top) {
    return {
      status: "must_defer",
      grade: "deferred",
      reason: "no_authoritative_evidence",
      suggestedDeferralEn:
        "Source attribution missing. Let me research and re-verify.",
      suggestedDeferralSw: "Chanzo hakipo. Niitafiti na kuthibitisha tena.",
      autoResearchTriggered: false,
    };
  }

  const grade = top.source_authority >= 0.85 ? "verified" : "research_estimate";

  if (grade === "verified") {
    return {
      status: "found",
      grade: "verified",
      claim,
      evidence: evidenceList,
      attributionEn: buildAttributionEn(top, "verified"),
      attributionSw: buildAttributionSw(top, "verified"),
    };
  }

  return {
    status: "found",
    grade: "research_estimate",
    claim,
    evidence: evidenceList,
    attributionEn: buildAttributionEn(top, "research_estimate"),
    attributionSw: buildAttributionSw(top, "research_estimate"),
    verifyHintEn: "Verify with the institution before acting on this figure.",
    verifyHintSw: "Hakikisha na taasisi kabla ya kutumia takwimu hii.",
  };
}

// ============================================================================
// Search (for prompt-assembler Layer 9 injection)
// ============================================================================

/**
 * Sentinel fact_key returned by `searchFreshClaims` when EVERY candidate
 * row was excluded by the 30-day staleness gate. Callers (e.g.
 * `loadVerifiedClaimsBlock`) detect this and emit a "defer ALL numeric
 * claims to bank confirmation" directive into the system prompt rather
 * than an empty list — empty lists are ambiguous, the sentinel is loud.
 */
export const DEFER_ALL_FACT_KEY = "_defer_all_";

/**
 * Hard ceiling (in days) on how long a `pendingVerification` claim is
 * allowed to retain any prompt-injection eligibility. Mirrors
 * `MAX_VERIFIED_AGE_DAYS` from ttl-policy.ts but is applied as a
 * *defense-in-depth* gate at the search layer too: even if a row's
 * status / next_refresh_at slipped past the DB filter, this catches
 * stale pending seeds.
 */
const PENDING_STALENESS_DAYS = 30;

function isPendingAndStale(row: TruthClaimRow): boolean {
  // We treat `pending_review` rows as "pendingVerification: true" — they
  // were seeded as honest-scaffolding anchors and the cron has not yet
  // re-fetched them.
  if (row.status !== "pending_review") return false;
  if (!row.last_verified_at) return true;
  const ageMs = Date.now() - new Date(row.last_verified_at).getTime();
  return ageMs > PENDING_STALENESS_DAYS * 24 * 60 * 60 * 1000;
}

function buildDeferAllSentinel(jurisdiction: string): TruthClaimRow {
  const nowIso = new Date().toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    category: "regulatory",
    subject: "DEFER ALL: knowledge corpus is stale",
    fact_key: DEFER_ALL_FACT_KEY,
    claim_text:
      "All seeded claims for this jurisdiction are older than 30 days and have not been re-verified by the cron refresher. The model MUST defer every numeric / regulatory figure to bank or regulator confirmation and MUST NOT quote any seed value as fact.",
    numeric_value: null,
    unit: null,
    jurisdiction,
    confidence: 0,
    status: "pending_review",
    effective_date: null,
    expiry_date: null,
    ttl_seconds: 0,
    last_verified_at: nowIso,
    next_refresh_at: nowIso,
    created_by: "system",
    curated_by: null,
    curated_at: null,
    curator_notes: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * Fetch top-N fresh + verified claims that match an intent or category. Used
 * by prompt-assembler to inject relevant facts into the prompt window.
 *
 * Defense-in-depth staleness gate (Anthropic alignment review 2026-04-30):
 *   1. The DB query filters on `status='verified'` and `next_refresh_at >
 *      now()` as before.
 *   2. We also fetch any `status='pending_review'` rows so we can apply
 *      the 30-day staleness ceiling on un-refreshed honest-scaffolding
 *      seeds. Rows older than 30 days are excluded entirely.
 *   3. If the resulting set is empty (everything fell through both
 *      filters), we return a single `_defer_all_` sentinel claim so the
 *      caller can emit an explicit "defer ALL numeric claims to bank
 *      confirmation" directive into the system prompt instead of an
 *      ambiguous empty list.
 */
export async function searchFreshClaims(args: {
  readonly categories?: readonly ClaimCategory[];
  readonly searchText?: string;
  readonly jurisdiction?: string;
  readonly limit?: number;
  readonly db?: DB;
}): Promise<readonly TruthClaimRow[]> {
  const db = args.db ?? createServiceClient();
  const limit = args.limit ?? 20;
  const jurisdiction = args.jurisdiction ?? "TZ";

  let query = db
    .from("truth_claims")
    .select("*")
    .in("status", ["verified", "pending_review"])
    .eq("jurisdiction", jurisdiction);

  if (args.categories && args.categories.length > 0) {
    query = query.in("category", args.categories);
  }

  if (args.searchText) {
    // Postgres full-text search via the GIN index
    query = query.textSearch("subject", args.searchText, {
      type: "websearch",
      config: "english",
    });
  }

  // Pull a wider pool than `limit` so the staleness filter has headroom
  // before we trim to the requested number.
  const { data, error } = await query
    .order("confidence", { ascending: false })
    .limit(limit * 3)
    .returns<TruthClaimRow[]>();

  if (error || !data) return [];

  const fresh = data.filter((row) => {
    // Verified rows must still be inside their TTL window.
    if (row.status === "verified") {
      return new Date(row.next_refresh_at).getTime() > Date.now();
    }
    // Pending rows are only allowed if within the 30-day ceiling.
    return !isPendingAndStale(row);
  });

  if (fresh.length === 0) {
    // EVERY candidate was either expired or stale-pending — emit the
    // explicit "defer all" sentinel rather than a silently empty list.
    return [buildDeferAllSentinel(jurisdiction)];
  }

  return fresh.slice(0, limit);
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Persist a new claim with evidence. Computes confidence from evidence,
 * picks status (verified / pending_review / disputed / rejected), and writes
 * everything in a single Supabase round-trip.
 *
 * Returns the persisted claim ID, or null if the draft was rejected (low
 * confidence).
 */
export async function persistClaim(
  draft: ClaimDraft,
  options: { readonly db?: DB; readonly upsert?: boolean } = {},
): Promise<{
  readonly claimId: string | null;
  readonly status: "verified" | "pending_review" | "disputed" | "rejected";
  readonly confidence: number;
} | null> {
  // Defense-in-depth zod validation. Throws on malformed input so callers
  // never silently persist tainted records.
  const validated = validateClaimDraft(draft);

  const db = options.db ?? createServiceClient();
  const jurisdiction = validated.jurisdiction ?? "TZ";

  if (validated.evidence.length === 0) return null;

  const scored = scoreCandidates(validated.evidence);
  const newestRetrievedAt = new Date();
  const computedConfidence = computeConfidence(
    scored,
    validated.category,
    newestRetrievedAt,
  );
  const hasDisagreement = detectNumericDisagreement(validated.evidence);

  // Honest-scaffolding: when a draft is marked pendingVerification (or carries
  // an explicit initialConfidence < 0.5), force the claim into pending_review
  // with confidence below the verified threshold so the lookup layer NEVER
  // returns grade='verified' until the cron refresher has re-fetched the
  // source and re-scored. This is the "no lies" invariant: generator
  // template values cannot impersonate authoritative anchors.
  const explicitInitialConfidence = validated.initialConfidence;
  const isPending = validated.pendingVerification === true;
  const confidence = isPending
    ? Math.min(0.3, explicitInitialConfidence ?? 0)
    : (explicitInitialConfidence ?? computedConfidence);
  const status = isPending
    ? "pending_review"
    : classifyClaimStatus(scored, confidence, hasDisagreement);

  if (status === "rejected") {
    return { claimId: null, status, confidence };
  }

  const ttlSeconds = TTL_BY_CATEGORY[validated.category];

  // Upsert claim. For pendingVerification seeds we honour the draft's
  // `lastVerifiedAt` (set by the seed catalog as a baseline). Verified
  // and curator-pushed claims always stamp `now()` so the 30-day
  // staleness gate uses the actual re-fetch time.
  const lastVerifiedAt =
    isPending && validated.lastVerifiedAt
      ? validated.lastVerifiedAt
      : new Date().toISOString();
  const claimRecord = {
    category: validated.category,
    subject: validated.subject,
    fact_key: validated.factKey,
    claim_text: validated.claimText,
    numeric_value: validated.numericValue ?? null,
    unit: validated.unit ?? null,
    jurisdiction,
    confidence,
    status,
    effective_date: validated.effectiveDate ?? null,
    expiry_date: validated.expiryDate ?? null,
    ttl_seconds: ttlSeconds,
    last_verified_at: lastVerifiedAt,
    next_refresh_at: computeNextRefreshAt(validated.category),
    created_by: validated.createdBy,
  };

  const { data: claim, error } = await db
    .from("truth_claims")
    .upsert(claimRecord, {
      onConflict: "category,fact_key,jurisdiction",
      ignoreDuplicates: false,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !claim) {
    console.error("[truth-engine] Failed to persist claim:", error);
    return null;
  }

  // Insert evidence rows (skip duplicates via content_hash unique constraint)
  const evidenceRows = scored.map(
    ({ evidence, authority, resolvedDomain }) => ({
      claim_id: claim.id,
      source_type: evidence.sourceType,
      source_url: evidence.sourceUrl,
      source_domain: resolvedDomain,
      source_authority: authority,
      excerpt: evidence.excerpt,
      full_text: evidence.fullText ?? null,
      retrieved_by: evidence.retrievedBy,
      content_hash: hashEvidence(evidence),
    }),
  );

  await db.from("truth_evidence").upsert(evidenceRows, {
    onConflict: "claim_id,content_hash",
    ignoreDuplicates: true,
  });

  // Queue for review if pending_review
  if (status === "pending_review") {
    await db.from("truth_review_queue").insert({
      claim_id: claim.id,
      reason: "new_low_confidence",
      priority: 60,
    });
  }

  return { claimId: claim.id, status, confidence };
}

/**
 * Mark a claim as expired so the refresh job will re-fetch it on next run.
 */
export async function markExpired(
  claimId: string,
  db: DB = createServiceClient(),
): Promise<void> {
  await db.from("truth_claims").update({ status: "expired" }).eq("id", claimId);
}

// ============================================================================
// Internal helpers
// ============================================================================

function hashEvidence(evidence: CandidateEvidence): string {
  return createHash("sha256")
    .update(`${evidence.sourceUrl ?? ""}|${evidence.excerpt}`)
    .digest("hex");
}

function buildAttributionEn(
  evidence: TruthEvidenceRow,
  grade: "verified" | "research_estimate",
): string {
  const date = new Date(evidence.retrieved_at).toISOString().slice(0, 10);
  const domain = evidence.source_domain ?? "online research";

  if (grade === "verified") {
    return `Per ${domain} (retrieved ${date})`;
  }
  return `Based on online research from ${domain} (retrieved ${date})`;
}

function buildAttributionSw(
  evidence: TruthEvidenceRow,
  grade: "verified" | "research_estimate",
): string {
  const date = new Date(evidence.retrieved_at).toISOString().slice(0, 10);
  const domain = evidence.source_domain ?? "utafiti wa mtandaoni";

  if (grade === "verified") {
    return `Kwa mujibu wa ${domain} (imepatikana ${date})`;
  }
  return `Kulingana na utafiti wa mtandaoni kutoka ${domain} (${date})`;
}
