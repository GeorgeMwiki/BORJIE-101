/**
 * Follow-Up — Types
 *
 * The MD remembers commitments ("I'll get back to you Tuesday") and turns
 * them into trackable `FollowUp` rows. The scheduler ticks across them on
 * the heartbeat and surfaces ones whose `dueAt` has elapsed.
 *
 * All shapes here are frozen at construction time. Mutation is forbidden;
 * callers must produce new objects via spread.
 *
 * @module features/central-command/md/follow-up/types
 */

import { z } from "zod";

/**
 * Lifecycle status of a follow-up. `pending` = waiting for dueAt;
 * `due` = dueAt elapsed, awaiting MD surface; `completed` = owner ack'd;
 * `cancelled` = owner explicitly dropped it; `escalated` = overdue by
 * sufficient margin to bump priority.
 */
export const followUpStatusSchema = z.enum([
  "pending",
  "due",
  "completed",
  "cancelled",
  "escalated",
]);
export type FollowUpStatus = z.infer<typeof followUpStatusSchema>;

/**
 * Escalation level monotonically increases as a follow-up ages past its
 * due date. Level 0 = on time; higher levels trigger louder surfaces.
 */
export const escalationLevelSchema = z.number().int().min(0).max(3);
export type EscalationLevel = z.infer<typeof escalationLevelSchema>;

/**
 * Priority (informational hint to the surface layer).
 */
export const followUpPrioritySchema = z.enum([
  "low",
  "normal",
  "high",
  "urgent",
]);
export type FollowUpPriority = z.infer<typeof followUpPrioritySchema>;

/**
 * Core follow-up row. Persisted with RLS scoped to `tenantId`.
 */
export const followUpSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  ownerId: z.string().uuid(),
  subject: z.string().min(1).max(500),
  dueAt: z.string().datetime(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  status: followUpStatusSchema,
  originTurnId: z.string().min(1),
  escalationLevel: escalationLevelSchema,
  priority: followUpPrioritySchema.default("normal"),
  /** ISO date when the FollowUp was first created. Anchors aging math. */
  createdAt: z.string().datetime(),
  /** Optional commitment counterparty (e.g. "customer Alice"). */
  counterparty: z.string().max(200).nullable().optional(),
  /** Optional metadata bag (frozen on persist). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type FollowUp = z.infer<typeof followUpSchema>;

/**
 * Input to the extractor. A raw chat turn plus the context the MD has
 * about the speaker (used to anchor relative dates like "next Tuesday").
 */
export const extractorInputSchema = z.object({
  turnId: z.string().min(1),
  tenantId: z.string().uuid(),
  ownerId: z.string().uuid(),
  text: z.string().min(1).max(10_000),
  /** Reference time for resolving relative dates. */
  now: z.string().datetime(),
  /** Optional counterparty hint. */
  counterparty: z.string().max(200).nullable().optional(),
});
export type ExtractorInput = z.infer<typeof extractorInputSchema>;

/**
 * A single commitment extracted from a turn. The extractor returns one
 * per detected commitment; callers turn them into persisted `FollowUp`s.
 */
export const extractedCommitmentSchema = z.object({
  subject: z.string().min(1).max(500),
  dueAt: z.string().datetime(),
  /** Optional confidence score (0..1). */
  confidence: z.number().min(0).max(1),
  /** Implied priority from the language ("urgent", "asap"). */
  priority: followUpPrioritySchema,
  /** The literal substring that triggered the extraction (for trace). */
  evidence: z.string().min(1).max(1000),
});
export type ExtractedCommitment = z.infer<typeof extractedCommitmentSchema>;

/**
 * Output of the scheduler tick. Lists follow-ups whose status transitioned
 * (became due, escalated, etc.) during this tick.
 */
export interface SchedulerTickOutput {
  readonly tickId: string;
  readonly takenAt: string;
  readonly becameDue: ReadonlyArray<FollowUp>;
  readonly escalated: ReadonlyArray<FollowUp>;
  readonly stillSnoozed: ReadonlyArray<FollowUp>;
}

/**
 * Pure dependency-injectable LLM-shaped extractor. Production wires this
 * to a real LLM; tests inject a deterministic stub.
 */
export type ExtractorFn = (
  input: ExtractorInput,
) => Promise<ReadonlyArray<ExtractedCommitment>>;
