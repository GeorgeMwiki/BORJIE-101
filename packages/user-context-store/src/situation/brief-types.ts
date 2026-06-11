/**
 * Situational-awareness standing brief — type surface.
 *
 * The per-tenant SIX-FACET model the orchestration spec calls for:
 *   { happened, doing, toDo, couldMatterLater, blindSpots, caveats }
 *
 * One queryable artifact the brain can read FIRST each turn (the
 * Anthropic long-running-agent re-orientation ritual: read state →
 * highest-priority undone item → verify-before-work). It is SYNTHESIZED
 * from memory + audit + open workflows via injected read-only ports —
 * this package owns no I/O.
 *
 * ADDITIVE: the brief is a read-model. It never mutates source state, the
 * audit chain, or the money path. It does not gate anything; it INFORMS.
 *
 * Pure contracts + zod only.
 */
import { z } from 'zod';

/** A single evidence pointer attached to a facet item (evidence-required). */
export interface BriefEvidence {
  /** What it references ('audit' | 'workflow' | 'memory' | 'forecast' | 'signal'). */
  readonly kind: 'audit' | 'workflow' | 'memory' | 'forecast' | 'signal';
  /** Stable id of the referenced record. */
  readonly id: string;
  readonly detail?: string;
}

/** Common shape for every facet item. */
export interface BriefItem {
  /** Stable id within the facet (dedupe + idempotency across refreshes). */
  readonly id: string;
  /** Owner-facing one-liner. */
  readonly summary: string;
  /**
   * Salience ∈ [0,1] — scored retrieval (recency decay × importance ×
   * relevance). The brain reads the highest-salience undone item first.
   */
  readonly salience: number;
  /** ISO-8601 of the underlying event/record. */
  readonly at?: string;
  /** Never empty — satisfies the evidence-required rule. */
  readonly evidence: ReadonlyArray<BriefEvidence>;
}

/** A future item that COULD matter — carries the date that makes it future. */
export interface FutureItem extends BriefItem {
  /** ISO-8601 when it becomes live (renewal, filing window, bid expiry). */
  readonly dueAt: string;
  /** Days from brief build to `dueAt`. */
  readonly daysUntil: number;
}

/**
 * A blind spot — a first-class known-unknown. A fact the brain lacks but
 * a decision needs. Drives clarify/abstain rather than bluffing.
 */
export interface BlindSpot extends BriefItem {
  /** What decision this gap blocks. */
  readonly blocksDecision: string;
  /** Suggested way to close it (commission assay, pull FX quote, ask owner). */
  readonly resolutionHint: string;
}

/**
 * A caveat — a confidence band / uncertainty note attached to the brief
 * as a whole or to a high-stakes area. Complements the existing intent-
 * verification + sycophancy gates; never overrides a rail.
 */
export interface Caveat {
  readonly id: string;
  readonly note: string;
  /** Confidence band the caveat qualifies ∈ [0,1]. */
  readonly confidence: number;
  /** Whether the brain should ABSTAIN/escalate on this area (high entropy). */
  readonly abstain: boolean;
  readonly evidence: ReadonlyArray<BriefEvidence>;
}

/**
 * The standing brief. Read first each turn; refreshable + surfaceable to
 * the owner.
 */
export interface StandingBrief {
  readonly tenantId: string | null;
  readonly builtAt: string;
  /** Past — completed flows, posted ledger entries, decided trajectories. */
  readonly happened: ReadonlyArray<BriefItem>;
  /** In-flight — running goals, active sub-MDs, live loop cycles. */
  readonly doing: ReadonlyArray<BriefItem>;
  /** Pending + blocked + stalled-self-heal proposals. */
  readonly toDo: ReadonlyArray<BriefItem>;
  /** Forecasts — renewals, filing windows, bid expiries, FX thresholds. */
  readonly couldMatterLater: ReadonlyArray<FutureItem>;
  /** First-class known-unknowns map. */
  readonly blindSpots: ReadonlyArray<BlindSpot>;
  /** Confidence bands + abstention policy on high-stakes areas. */
  readonly caveats: ReadonlyArray<Caveat>;
  /**
   * Pre-computed pointer to the single highest-priority undone item the
   * brain should re-orient to first. `null` when nothing is pending.
   */
  readonly nextBestAction: BriefItem | null;
}

// ---------------------------------------------------------------------------
// Zod schemas (host-boundary validation)
// ---------------------------------------------------------------------------

export const briefEvidenceSchema = z.object({
  kind: z.enum(['audit', 'workflow', 'memory', 'forecast', 'signal']),
  id: z.string().min(1),
  detail: z.string().optional(),
});

export const briefItemSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  salience: z.number().min(0).max(1),
  at: z.string().optional(),
  evidence: z.array(briefEvidenceSchema).min(1),
});

export const futureItemSchema = briefItemSchema.extend({
  dueAt: z.string().min(1),
  daysUntil: z.number(),
});

export const blindSpotSchema = briefItemSchema.extend({
  blocksDecision: z.string().min(1),
  resolutionHint: z.string().min(1),
});

export const caveatSchema = z.object({
  id: z.string().min(1),
  note: z.string().min(1),
  confidence: z.number().min(0).max(1),
  abstain: z.boolean(),
  evidence: z.array(briefEvidenceSchema).min(1),
});

export const standingBriefSchema = z.object({
  tenantId: z.string().min(1).nullable(),
  builtAt: z.string().min(1),
  happened: z.array(briefItemSchema),
  doing: z.array(briefItemSchema),
  toDo: z.array(briefItemSchema),
  couldMatterLater: z.array(futureItemSchema),
  blindSpots: z.array(blindSpotSchema),
  caveats: z.array(caveatSchema),
  nextBestAction: briefItemSchema.nullable(),
});
