/**
 * Continuous Learning Amplification — types.
 *
 * Ported verbatim from LitFin (litfin → borjie). The brain MUST be
 * measurably smarter for user 100 than for user 50. We achieve that by
 * capturing every interaction as a datum that updates:
 *
 *   - claim confidence  (Bayesian posterior over evidence + observations)
 *   - prompt effectiveness (which framing gets the lowest deferral / fastest
 *     "yes that helps" feedback?)
 *   - language coverage (which language pair tripped up the detector?)
 *   - intent routing (which user goal is under-served by current modules?)
 *
 * Every observation is anonymised, hashed, and federated: what one user
 * teaches the engine helps every subsequent user without ever leaking
 * PII back into the corpus. The Borjie BorjieMark privacy invariant
 * (SHA-256 user_id) is preserved.
 */

export type ObservationKind =
  // Claim-side observations
  | "claim_cited" // engine cited a claim in an answer
  | "claim_confirmed_by_user" // user said "that's correct" / acted on it
  | "claim_disputed_by_user" // user said "that's wrong"
  | "claim_corrected_by_user" // user provided a different value
  | "claim_verified_by_cron" // cron re-fetched and matched
  | "claim_changed_by_cron" // cron re-fetched and value moved
  | "claim_source_dead" // 404 / DNS / fetch failure
  // Prompt-side observations
  | "answer_accepted" // user proceeded to next step / no clarification
  | "answer_rejected" // user asked again / showed confusion
  | "answer_deferred" // engine returned grade='deferred'
  // Language-side observations
  | "language_misdetected" // user followed up in a different language
  | "code_switch_observed"
  | "dialect_observed"
  // Intent-side observations
  | "intent_resolved"
  | "intent_unresolved";

export interface Observation {
  readonly kind: ObservationKind;
  readonly subjectKey: string; // claim-id, intent-id, language-code, prompt-hash
  readonly userIdHash?: string; // SHA-256(user_id) — not raw id
  readonly tenantId?: string;
  readonly portalContext?: "owner" | "manager" | "worker" | "buyer" | "admin" | "public";
  readonly correlationId?: string; // session/turn linkage
  readonly evidence?: {
    readonly userText?: string; // anonymised excerpt
    readonly proposedValue?: string | number;
    readonly proposedUnit?: string;
  };
  readonly weight?: number; // 0..1 — how strongly to update on this obs
  readonly recordedAt?: string; // ISO; defaults to now
}

export interface ConfidenceUpdate {
  readonly claimId: string;
  readonly previousConfidence: number;
  readonly newConfidence: number;
  readonly reason: string;
  readonly observationsApplied: number;
}

export interface UserCohortStats {
  readonly cohort:
    | "users-1-50"
    | "users-51-100"
    | "users-101-500"
    | "users-500plus";
  readonly avgDeferralRate: number; // 0..1
  readonly avgUserConfirmRate: number;
  readonly avgLanguageMatchAccuracy: number;
  readonly claimsCovered: number;
  readonly aggregatedAt: string;
}

/**
 * Minimal Supabase-like client interface the recorder + job need.
 * Borjie is multi-surface (owner-web, admin-web, mobile, api-gateway);
 * each surface injects its own service-role client through this shape
 * so the package stays portable. Mirrors the BorjieMark contract that
 * LitFin's recorder relied on via `@/lib/supabase/server`.
 */
export interface SupabaseLike {
  from(table: string): SupabaseQueryBuilder;
}

export interface SupabaseQueryBuilder {
  insert(row: unknown): Promise<{ error: { message: string } | null }>;
  select(columns?: string): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  maybeSingle<T = unknown>(): Promise<{
    data: T | null;
    error: { message: string } | null;
  }>;
  update(values: Record<string, unknown>): SupabaseQueryBuilder;
  gte(column: string, value: unknown): Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
}

/**
 * Borjie BorjieMark — package brand marker for diagnostic logs.
 * Mirrors LitFin's LitfinMark constant so the LitFin → Borjie port
 * stays grep-able across the two codebases.
 */
export const BorjieMark = "BorjieMark::learning-amplification" as const;
