/**
 * Refresh Scheduler — daily auto-research loop.
 *
 * Finds claims that are expired or near-expiry, runs evidence-collector for
 * each, persists fresh evidence, and updates claim confidence + status.
 *
 * Run from /api/cron/truth-refresh (default schedule: every 6h, Vercel cron).
 * Caller persists a TruthRefreshRunRow with the aggregated stats.
 *
 * Concurrency: claims are refreshed in parallel batches of `BATCH_SIZE` to
 * stay under fetch budgets. Per-batch errors are collected, never thrown.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { collectEvidence } from "./evidence-collector";
import { persistClaim } from "./claim-store";
import {
  computeNextRefreshAt,
  isClaimNearExpiry,
  DAILY_SAMPLE_CHECK_FRACTION,
} from "./ttl-policy";
import type { ClaimDraft, TruthClaimRow, TruthRefreshRunRow } from "./types";

const BATCH_SIZE = 5;
const MAX_CLAIMS_PER_RUN = 100;
const MAX_SAMPLE_CHECKS_PER_RUN = 25;
const MAX_PENDING_VERIFICATIONS_PER_RUN = 50;

export interface RefreshRunSummary {
  readonly runId: string;
  readonly examined: number;
  readonly refreshed: number;
  readonly unchanged: number;
  readonly disputed: number;
  readonly failed: number;
  readonly evidenceAdded: number;
  readonly costUsd: number;
  readonly llmCalls: number;
  /** Of `examined`, how many came from the daily silent-drift sample. */
  readonly sampleChecked: number;
  /** Of `examined`, how many were pending_review claims being verified. */
  readonly pendingDrained: number;
  readonly errors: ReadonlyArray<{
    readonly claim_id: string;
    readonly error: string;
  }>;
}

/**
 * Find every claim that needs a refresh and re-research it. Returns
 * aggregate stats; persists a TruthRefreshRunRow for audit trail.
 */
export async function runDailyRefresh(args: {
  readonly triggeredBy?: string;
  readonly maxClaims?: number;
}): Promise<RefreshRunSummary> {
  const db = createServiceClient();
  const triggeredBy = args.triggeredBy ?? "cron:truth-refresh";
  const maxClaims = Math.min(
    args.maxClaims ?? MAX_CLAIMS_PER_RUN,
    MAX_CLAIMS_PER_RUN,
  );

  // 1) Open a refresh-run row
  const { data: runRow } = await db
    .from("truth_refresh_runs")
    .insert({ triggered_by: triggeredBy, status: "running" })
    .select("id")
    .single<{ id: string }>();

  const runId = runRow?.id ?? "unknown";

  // 2a) Fetch claims due for refresh (expired OR past TTL)
  const now = new Date();
  const { data: dueClaims } = await db
    .from("truth_claims")
    .select("*")
    .in("status", ["verified", "expired"])
    .lt("next_refresh_at", now.toISOString())
    .order("next_refresh_at", { ascending: true })
    .limit(maxClaims)
    .returns<TruthClaimRow[]>();

  // 2b) DAILY SAMPLE CHECK: pull a random ~2% slice of fresh verified claims
  // and re-fetch them too, so silent drift on otherwise-stable claims is
  // caught within ~50d. This is the daily-update guarantee for stability
  // categories like geographic and institutional.
  const { data: sampleClaims } = await db
    .from("truth_claims")
    .select("*")
    .eq("status", "verified")
    .gt("next_refresh_at", now.toISOString())
    .order("last_verified_at", { ascending: true }) // oldest verifications first
    .limit(MAX_SAMPLE_CHECKS_PER_RUN)
    .returns<TruthClaimRow[]>();

  // 2c) PENDING-VERIFICATION DRAINING: claims seeded via the bulk generators
  // are written with status='pending_review'. The cron must verify them so
  // they can graduate to 'verified' and become citable. Drain a slice each
  // run so the pending backlog converges to zero.
  const { data: pendingClaims } = await db
    .from("truth_claims")
    .select("*")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(MAX_PENDING_VERIFICATIONS_PER_RUN)
    .returns<TruthClaimRow[]>();

  const dueList = dueClaims ?? [];
  const sampleList = sampleClaims ?? [];
  const sampleSize = Math.ceil(sampleList.length * DAILY_SAMPLE_CHECK_FRACTION);
  const sampledForCheck = sampleList
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.max(1, sampleSize));
  const pendingList = pendingClaims ?? [];

  // De-duplicate by id (a stale claim might appear in multiple lists).
  const seen = new Set<string>();
  const claims: TruthClaimRow[] = [];
  for (const c of [...dueList, ...sampledForCheck, ...pendingList]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    claims.push(c);
  }

  let refreshed = 0;
  let unchanged = 0;
  let disputed = 0;
  let failed = 0;
  let evidenceAdded = 0;
  let costUsd = 0;
  let llmCalls = 0;
  const errors: { readonly claim_id: string; readonly error: string }[] = [];

  // 3) Process in batches to keep memory + connection pool flat
  for (let i = 0; i < claims.length; i += BATCH_SIZE) {
    const batch = claims.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((claim) => refreshSingleClaim(claim, triggeredBy)),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const claim = batch[j];

      if (r.status === "fulfilled" && r.value) {
        if (r.value.outcome === "refreshed") refreshed++;
        else if (r.value.outcome === "unchanged") unchanged++;
        else if (r.value.outcome === "disputed") disputed++;
        else failed++;
        evidenceAdded += r.value.evidenceCount;
        costUsd += r.value.costUsd;
        llmCalls += r.value.llmCalls;
      } else {
        failed++;
        errors.push({
          claim_id: claim.id,
          error:
            r.status === "rejected"
              ? String(r.reason).slice(0, 240)
              : "unknown",
        });
      }
    }
  }

  // 4) Close out the run
  await db
    .from("truth_refresh_runs")
    .update({
      completed_at: new Date().toISOString(),
      claims_examined: claims.length,
      claims_refreshed: refreshed,
      claims_unchanged: unchanged,
      claims_disputed: disputed,
      claims_failed: failed,
      evidence_added: evidenceAdded,
      llm_calls: llmCalls,
      cost_usd: costUsd,
      errors,
      status: failed > claims.length / 2 ? "partial" : "completed",
    } satisfies Partial<TruthRefreshRunRow>)
    .eq("id", runId);

  return {
    runId,
    examined: claims.length,
    refreshed,
    unchanged,
    disputed,
    failed,
    evidenceAdded,
    costUsd,
    llmCalls,
    sampleChecked: sampledForCheck.length,
    pendingDrained: pendingList.length,
    errors,
  };
}

/**
 * Refresh one claim: collect new evidence, compare with stored, update if
 * the new value differs or the source is fresher.
 */
async function refreshSingleClaim(
  claim: TruthClaimRow,
  triggeredBy: string,
): Promise<{
  readonly outcome: "refreshed" | "unchanged" | "disputed" | "failed";
  readonly evidenceCount: number;
  readonly costUsd: number;
  readonly llmCalls: number;
}> {
  const collection = await collectEvidence({
    category: claim.category,
    subject: claim.subject,
    factKey: claim.fact_key,
    searchQuery: `${claim.subject} ${claim.unit ?? ""}`.trim(),
    maxWebFetches: 4,
    enableLLMConsensus:
      claim.category === "pricing" || claim.category === "regulatory",
    retrievedBy: triggeredBy,
  });

  if (collection.candidates.length === 0) {
    // Mark expired so we don't keep retrying tight loops; mark next refresh
    // an hour from now to allow source recovery.
    const db = createServiceClient();
    await db
      .from("truth_claims")
      .update({
        status: "expired",
        next_refresh_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq("id", claim.id);
    return {
      outcome: "failed",
      evidenceCount: 0,
      costUsd: collection.costUsd,
      llmCalls: collection.llmCalls,
    };
  }

  const draft: ClaimDraft = {
    category: claim.category,
    subject: claim.subject,
    factKey: claim.fact_key,
    claimText: claim.claim_text,
    numericValue: claim.numeric_value ?? undefined,
    unit: claim.unit ?? undefined,
    jurisdiction: claim.jurisdiction,
    effectiveDate: claim.effective_date ?? undefined,
    expiryDate: claim.expiry_date ?? undefined,
    evidence: collection.candidates,
    createdBy: triggeredBy,
  };

  const result = await persistClaim(draft);
  if (!result || result.status === "rejected") {
    return {
      outcome: "failed",
      evidenceCount: collection.candidates.length,
      costUsd: collection.costUsd,
      llmCalls: collection.llmCalls,
    };
  }

  return {
    outcome:
      result.status === "disputed"
        ? "disputed"
        : result.confidence > claim.confidence
          ? "refreshed"
          : "unchanged",
    evidenceCount: collection.candidates.length,
    costUsd: collection.costUsd,
    llmCalls: collection.llmCalls,
  };
}

/**
 * On-demand single claim refresh. Used by lookupClaim() when a user query
 * hits a missing/stale claim and we want to research it now (background).
 */
export async function refreshOnDemand(
  category: TruthClaimRow["category"],
  factKey: string,
  jurisdiction = "TZ",
): Promise<void> {
  const db = createServiceClient();
  const { data: claim } = await db
    .from("truth_claims")
    .select("*")
    .eq("category", category)
    .eq("fact_key", factKey)
    .eq("jurisdiction", jurisdiction)
    .maybeSingle<TruthClaimRow>();

  if (!claim) return;
  if (!isClaimNearExpiry(claim)) {
    // Update next_refresh_at anyway so the refresh job picks it up on next run
    await db
      .from("truth_claims")
      .update({
        next_refresh_at: computeNextRefreshAt(claim.category, new Date(0)),
      })
      .eq("id", claim.id);
    return;
  }
  await refreshSingleClaim(claim, "ondemand:user-query");
}
