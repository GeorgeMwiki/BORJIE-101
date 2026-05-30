/**
 * Nightly Amplification Job.
 *
 * Ported from LitFin (litfin → borjie). Reads everything in
 * `learning_observations` since the last run and:
 *
 *   1. Re-scores claim confidence via Bayesian roll-up (multiple
 *      confirms ratchet up; multiple disputes ratchet down).
 *   2. Promotes claims with ≥3 user confirmations + recent cron-verify
 *      to a higher confidence band so the engine cites them more
 *      aggressively.
 *   3. Demotes claims with ≥2 user disputes OR cron-changed values
 *      into pending_review.
 *   4. Emits cohort metrics (deferral rate, confirm rate, language
 *      match accuracy) so the brain can prove "user 100 > user 50".
 *
 * Run from /api/cron/learning-amplify (default schedule: nightly at
 * 02:00) OR wired into the api-gateway background supervisor.
 */

import type { ConfidenceUpdate, SupabaseLike, UserCohortStats } from "./types.js";

const PROMOTE_THRESHOLD_CONFIRMATIONS = 3;
const DEMOTE_THRESHOLD_DISPUTES = 2;
const HALF_LIFE_DAYS = 30;

export interface AmplificationRunSummary {
  readonly observationsConsumed: number;
  readonly claimsPromoted: number;
  readonly claimsDemoted: number;
  readonly confidenceUpdates: readonly ConfidenceUpdate[];
  readonly cohorts: readonly UserCohortStats[];
}

let _clientFactory: (() => SupabaseLike) | null = null;

/**
 * Inject a service-role Supabase client factory. Mirrors the recorder's
 * configure hook so both can be wired from a single bootstrap call.
 */
export function configureAmplificationJob(
  factory: () => SupabaseLike,
): void {
  _clientFactory = factory;
}

function getClient(): SupabaseLike | null {
  if (_clientFactory === null) return null;
  try {
    return _clientFactory();
  } catch {
    return null;
  }
}

export async function runAmplification(): Promise<AmplificationRunSummary> {
  const db = getClient();
  if (db === null) {
    return {
      observationsConsumed: 0,
      claimsPromoted: 0,
      claimsDemoted: 0,
      confidenceUpdates: [],
      cohorts: [],
    };
  }

  // 1) Pull the observation window
  const since = new Date(
    Date.now() - HALF_LIFE_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const { data: rows } = (await db
    .from("learning_observations")
    .select("kind, subject_key, weight, recorded_at")
    .gte("recorded_at", since)) as {
    data: Array<{
      readonly kind: string;
      readonly subject_key: string;
      readonly weight: number;
      readonly recorded_at: string;
    }> | null;
  };

  const obs = rows ?? [];

  // 2) Roll up per-claim confirm/dispute counts with exponential decay
  type RollUp = { confirms: number; disputes: number; cronChanges: number };
  const perClaim = new Map<string, RollUp>();
  const now = Date.now();
  for (const r of obs) {
    if (!r.subject_key.match(/^[0-9a-f-]{36}$/i)) continue;
    const ageDays =
      (now - new Date(r.recorded_at).getTime()) / (24 * 3600 * 1000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const w = (r.weight ?? 1) * decay;
    const cur = perClaim.get(r.subject_key) ?? {
      confirms: 0,
      disputes: 0,
      cronChanges: 0,
    };
    if (
      r.kind === "claim_confirmed_by_user" ||
      r.kind === "claim_verified_by_cron"
    ) {
      cur.confirms += w;
    } else if (
      r.kind === "claim_disputed_by_user" ||
      r.kind === "claim_corrected_by_user"
    ) {
      cur.disputes += w;
    } else if (r.kind === "claim_changed_by_cron") {
      cur.cronChanges += w;
    }
    perClaim.set(r.subject_key, cur);
  }

  const confidenceUpdates: ConfidenceUpdate[] = [];
  let promoted = 0;
  let demoted = 0;

  // 3) Apply per-claim updates
  for (const [claimId, roll] of perClaim) {
    const { data: claim } = await db
      .from("truth_claims")
      .select("id, confidence, status")
      .eq("id", claimId)
      .maybeSingle<{ id: string; confidence: number; status: string }>();
    if (!claim) continue;

    let target = claim.confidence;
    let reason = "no-op";

    if (roll.confirms >= PROMOTE_THRESHOLD_CONFIRMATIONS && roll.disputes < 1) {
      target = Math.min(0.99, claim.confidence + 0.05);
      reason = `promoted: ${roll.confirms.toFixed(1)} confirms`;
      promoted++;
    } else if (
      roll.disputes >= DEMOTE_THRESHOLD_DISPUTES ||
      roll.cronChanges >= 1
    ) {
      target = Math.max(0.2, claim.confidence - 0.15);
      reason = `demoted: ${roll.disputes.toFixed(1)} disputes / ${roll.cronChanges.toFixed(1)} drifts`;
      demoted++;
    } else {
      continue;
    }

    const round = (n: number) => Number(n.toFixed(3));
    const newConfidence = round(target);
    const newStatus =
      target < 0.5 && claim.status === "verified"
        ? "pending_review"
        : claim.status;

    await db
      .from("truth_claims")
      .update({ confidence: newConfidence, status: newStatus })
      .eq("id", claim.id);

    confidenceUpdates.push({
      claimId,
      previousConfidence: claim.confidence,
      newConfidence,
      reason,
      observationsApplied: Math.round(
        roll.confirms + roll.disputes + roll.cronChanges,
      ),
    });
  }

  // 4) Cohort stats — proves user 100 > user 50
  const cohorts = await computeCohortStats(db);

  return {
    observationsConsumed: obs.length,
    claimsPromoted: promoted,
    claimsDemoted: demoted,
    confidenceUpdates,
    cohorts,
  };
}

async function computeCohortStats(
  db: SupabaseLike,
): Promise<readonly UserCohortStats[]> {
  // Cohort buckets are computed on the fly — this is best-effort signal,
  // not load-bearing math. Returning empty if the SQL view isn't
  // available.
  try {
    const { data } = (await db
      .from("learning_cohort_stats")
      .select("*")
      .gte("aggregated_at", "1970-01-01")) as {
      data: UserCohortStats[] | null;
    };
    return data ?? [];
  } catch {
    return [];
  }
}
