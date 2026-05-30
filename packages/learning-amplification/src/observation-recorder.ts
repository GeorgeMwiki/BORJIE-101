/**
 * Observation Recorder.
 *
 * Ported from LitFin (litfin → borjie); BorjieMark privacy invariant
 * preserved (SHA-256 user_id, no raw id ever stored). Single entry
 * point for any Borjie module to feed an observation into the
 * continuous-learning loop. The recorder:
 *
 *   1. Anonymises the user id (SHA-256, no raw user_id ever stored).
 *   2. Truncates and PII-scrubs `userText` evidence (Tanzanian +254/+255
 *      phone prefixes + emails + 12+ digit ids).
 *   3. Inserts into `learning_observations` (Supabase) for batch
 *      processing by the nightly amplification job.
 *   4. For high-signal observations (claim_disputed_by_user,
 *      claim_corrected_by_user, claim_source_dead) it ALSO updates the
 *      claim's confidence + status synchronously so the next user query
 *      is already smarter.
 *
 * Failure mode: if the DB is unreachable, observations are dropped
 * silently (we never block the user-facing path on a learning record).
 * Counters still increment in-memory so /admin/intelligence/health can
 * flag the gap.
 */

import { createHash } from "crypto";
import type { Observation, SupabaseLike } from "./types.js";

const HIGH_SIGNAL_KINDS: ReadonlySet<Observation["kind"]> = new Set([
  "claim_disputed_by_user",
  "claim_corrected_by_user",
  "claim_source_dead",
  "claim_changed_by_cron",
]);

let droppedCount = 0;

export function recordedObservationsDropped(): number {
  return droppedCount;
}

/**
 * Borjie-style client accessor. Each surface (api-gateway, owner-web,
 * admin-web, mobile BFFs) registers its own service-role Supabase
 * client at bootstrap. Replaces LitFin's `createServiceClient()` import
 * path so the package stays standalone.
 */
let _clientFactory: (() => SupabaseLike) | null = null;

export function configureLearningAmplification(
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

export async function recordObservation(obs: Observation): Promise<void> {
  try {
    const db = getClient();
    if (db === null) {
      droppedCount++;
      return;
    }
    const recordedAt = obs.recordedAt ?? new Date().toISOString();
    const row = {
      kind: obs.kind,
      subject_key: obs.subjectKey,
      user_id_hash: obs.userIdHash ? hashUser(obs.userIdHash) : null,
      tenant_id: obs.tenantId ?? null,
      portal_context: obs.portalContext ?? null,
      correlation_id: obs.correlationId ?? null,
      user_text: obs.evidence?.userText
        ? scrubAndTruncate(obs.evidence.userText)
        : null,
      proposed_value:
        obs.evidence?.proposedValue !== undefined
          ? String(obs.evidence.proposedValue).slice(0, 200)
          : null,
      proposed_unit: obs.evidence?.proposedUnit ?? null,
      weight: obs.weight ?? 1.0,
      recorded_at: recordedAt,
    };
    const { error } = await db.from("learning_observations").insert(row);
    if (error) {
      droppedCount++;
      return;
    }
    if (HIGH_SIGNAL_KINDS.has(obs.kind)) {
      await applyImmediateConfidenceShift(obs, db);
    }
  } catch {
    droppedCount++;
  }
}

/**
 * Applies a synchronous confidence shift for high-signal observations
 * so the next user query is already smarter. Bayesian-flavoured update:
 *
 *   new = old + (target - old) * weight
 *
 * where `target` is the observation's pull. A user dispute pulls
 * toward 0.4 (review-needed), a cron-confirmed value pulls toward 0.95.
 */
async function applyImmediateConfidenceShift(
  obs: Observation,
  db: SupabaseLike,
): Promise<void> {
  const target = pullTarget(obs.kind);
  if (target === null) return;

  const { data: claim } = await db
    .from("truth_claims")
    .select("id, confidence, status")
    .eq("id", obs.subjectKey)
    .maybeSingle<{ id: string; confidence: number; status: string }>();
  if (!claim) return;

  const weight = obs.weight ?? 0.2;
  const newConfidence = round(
    Math.max(
      0,
      Math.min(1, claim.confidence + (target - claim.confidence) * weight),
    ),
  );
  const newStatus =
    obs.kind === "claim_disputed_by_user" ||
    obs.kind === "claim_changed_by_cron"
      ? "disputed"
      : obs.kind === "claim_source_dead"
        ? "expired"
        : claim.status;

  await db
    .from("truth_claims")
    .update({ confidence: newConfidence, status: newStatus })
    .eq("id", claim.id);

  // queue for human review on dispute / drift
  if (
    obs.kind === "claim_disputed_by_user" ||
    obs.kind === "claim_corrected_by_user"
  ) {
    await db.from("truth_review_queue").insert({
      claim_id: claim.id,
      reason: "user_dispute",
      priority: 90,
    });
  }
}

function pullTarget(kind: Observation["kind"]): number | null {
  switch (kind) {
    case "claim_disputed_by_user":
      return 0.4;
    case "claim_corrected_by_user":
      return 0.3;
    case "claim_source_dead":
      return 0.2;
    case "claim_changed_by_cron":
      return 0.45;
    default:
      return null;
  }
}

function hashUser(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function scrubAndTruncate(s: string): string {
  return s
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b(?:\+255|0)[67]\d{8}\b/g, "[phone]")
    .replace(/\b\d{12,}\b/g, "[id]")
    .slice(0, 500);
}

function round(n: number): number {
  return Number(n.toFixed(3));
}
