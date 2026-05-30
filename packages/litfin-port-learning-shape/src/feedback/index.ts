/**
 * Feedback collection primitives.
 *
 * Ported from LITFIN's feedback-collection shape (which gathered
 * borrower-experience NPS + per-flow signals). For Borjie the
 * feedback surfaces are mining-domain:
 *
 *   - persona-chat-quality  (per-turn thumbs / typed)
 *   - drafted-document      (per-artifact rating)
 *   - decision-help         (did Mr. Mwikila help you decide?)
 *   - shift-tooling         (mobile workforce app quality)
 *   - buyer-marketplace     (buyer-side quality)
 *
 * Pure functions, no I/O. Backend pluggable so callers can persist to
 * Postgres / Supabase / event-bus.
 */

export type FeedbackSurface =
  | "persona_chat_quality"
  | "drafted_document"
  | "decision_help"
  | "shift_tooling"
  | "buyer_marketplace";

export type FeedbackSentiment = "positive" | "neutral" | "negative";

export interface FeedbackPayload {
  readonly surface: FeedbackSurface;
  readonly tenantId: string;
  readonly personId: string;
  readonly sentiment: FeedbackSentiment;
  readonly rating?: number; // 1..5
  readonly typedNote?: string;
  readonly artifactId?: string;
  readonly conversationId?: string;
  readonly observedAt: string;
}

export interface FeedbackSummary {
  readonly surface: FeedbackSurface;
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly counts: Readonly<Record<FeedbackSentiment, number>>;
  readonly averageRating: number | null;
  readonly totalResponses: number;
  readonly netSentiment: number; // -1..+1
}

export function summariseFeedback(args: {
  readonly tenantId: string;
  readonly surface: FeedbackSurface;
  readonly payloads: ReadonlyArray<FeedbackPayload>;
  readonly periodStart: string;
  readonly periodEnd: string;
}): FeedbackSummary {
  const matching = args.payloads.filter(
    (p) => p.tenantId === args.tenantId && p.surface === args.surface,
  );
  const counts: Record<FeedbackSentiment, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const p of matching) {
    counts[p.sentiment] += 1;
    if (typeof p.rating === "number") {
      ratingSum += p.rating;
      ratingCount += 1;
    }
  }
  const total = matching.length;
  const netSentiment = total === 0 ? 0 : (counts.positive - counts.negative) / total;
  return Object.freeze({
    surface: args.surface,
    tenantId: args.tenantId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    counts: Object.freeze(counts),
    averageRating: ratingCount === 0 ? null : ratingSum / ratingCount,
    totalResponses: total,
    netSentiment,
  });
}
