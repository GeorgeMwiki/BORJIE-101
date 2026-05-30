/**
 * Employees — Types
 *
 * The MD tracks the owner's direct reports + extended team: when each
 * person was last 1-on-1'd, what feedback they've been mentioned with,
 * and how their sentiment is trending. Also drafts 30-60-90 plans for
 * new hires.
 *
 * @module features/central-command/md/employees/types
 */

import { z } from "zod";

export const employeeSentimentSchema = z.enum([
  "positive",
  "neutral",
  "concerning",
]);
export type EmployeeSentiment = z.infer<typeof employeeSentimentSchema>;

export const sentimentPolaritySchema = z.enum([
  "positive",
  "neutral",
  "negative",
]);
export type SentimentPolarity = z.infer<typeof sentimentPolaritySchema>;

export const employeeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  hireDate: z.string().datetime(),
  manager: z.string().uuid().nullable().optional(),
  last1on1At: z.string().datetime().nullable().optional(),
  feedbackReceivedAt: z.string().datetime().nullable().optional(),
  sentiment: employeeSentimentSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const sentimentEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  employeeId: z.string().uuid(),
  polarity: sentimentPolaritySchema,
  /** Signed score in [-1, +1]; -1 = strongly negative, +1 = strongly positive. */
  score: z.number().min(-1).max(1),
  /** Evidence substring from the chat turn. */
  evidence: z.string().min(1).max(2000),
  /** The chat turn that produced this signal. */
  originTurnId: z.string().min(1),
  recordedAt: z.string().datetime(),
});
export type SentimentEvent = z.infer<typeof sentimentEventSchema>;

export const onboardingMilestoneSchema = z.object({
  id: z.string().min(1),
  /** "30-day", "60-day", "90-day" or a custom bucket. */
  bucket: z.string().min(1).max(80),
  /** What the new hire should be doing at this point. */
  objective: z.string().min(1).max(1000),
  dueAt: z.string().datetime(),
});
export type OnboardingMilestone = z.infer<typeof onboardingMilestoneSchema>;

export const onboardingPlanSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  employeeId: z.string().uuid(),
  milestones: z.array(onboardingMilestoneSchema).min(1),
  /** Suggested 1-on-1 cadence in days. */
  cadenceDays: z.number().int().min(1).max(120),
  createdAt: z.string().datetime(),
});
export type OnboardingPlan = z.infer<typeof onboardingPlanSchema>;

/**
 * Aggregated sentiment view for an employee. Pure derivation from
 * sentiment events.
 */
export interface SentimentAggregate {
  readonly employeeId: string;
  readonly sampleSize: number;
  /** Weighted score: recent events count more (exponential half-life). */
  readonly weightedScore: number;
  /** Counts per polarity (raw, unweighted). */
  readonly counts: Readonly<Record<SentimentPolarity, number>>;
  readonly classification: EmployeeSentiment;
}

/**
 * Input to the feedback aggregator. A chat turn that mentions one or
 * more employees by name.
 */
export const feedbackTurnSchema = z.object({
  turnId: z.string().min(1),
  tenantId: z.string().uuid(),
  text: z.string().min(1).max(10_000),
  recordedAt: z.string().datetime(),
  /** Optional pre-resolved name → employeeId map. The aggregator falls
   *  back to a fuzzy name lookup if a name isn't found here. */
  nameMap: z.record(z.string(), z.string().uuid()).optional(),
});
export type FeedbackTurn = z.infer<typeof feedbackTurnSchema>;
