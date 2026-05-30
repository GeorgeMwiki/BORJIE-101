/**
 * Timeline — Types
 *
 * The MD auto-generates project timelines from owner conversations
 * ("I want to launch a new product in 3 months"). The internal model is
 * a DAG of `Milestone` nodes; downstream adapters render the same DAG as
 * waterfall, agile cycles, or kanban columns.
 *
 * All shapes are immutable on construction. Mutation is forbidden.
 *
 * @module features/central-command/md/timeline/types
 */

import { z } from "zod";

export const timelineStyleSchema = z.enum([
  "waterfall",
  "agile-cycles",
  "kanban",
]);
export type TimelineStyle = z.infer<typeof timelineStyleSchema>;

export const milestoneStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "done",
  "skipped",
]);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

export const milestoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(300),
  /** Estimated effort in days; required for CPM scheduling. */
  durationDays: z.number().int().min(0).max(3650),
  /** Computed by CPM; may be omitted before scheduling. */
  dueAt: z.string().datetime().nullable().optional(),
  /** Computed earliest-start (CPM). */
  earliestStartAt: z.string().datetime().nullable().optional(),
  status: milestoneStatusSchema.default("not_started"),
  /** Predecessor milestone IDs — defines the DAG. */
  dependencies: z.array(z.string().min(1)).default([]),
  /** True when this milestone is on the critical path. */
  onCriticalPath: z.boolean().default(false),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const timelineSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectName: z.string().min(1).max(300),
  milestones: z.array(milestoneSchema).min(1),
  /** Edges as `{from -> to}` pairs; redundant with milestone.dependencies
   *  but cheaper to walk for cycle detection.
   */
  dependencies: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
    }),
  ),
  style: timelineStyleSchema,
  /** ISO date the project conceptually starts (anchors CPM). */
  startsAt: z.string().datetime(),
  /** ISO date the project ends — derived from CPM. */
  endsAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Timeline = z.infer<typeof timelineSchema>;

/** Result of CPM scheduling — pure data, no persistence. */
export interface CpmResult {
  readonly milestones: ReadonlyArray<Milestone>;
  readonly criticalPath: ReadonlyArray<string>;
  readonly totalDurationDays: number;
  readonly endsAt: string;
}

/**
 * Generator input — a free-form project description plus the anchor date
 * and the owner's chosen style.
 */
export const generatorInputSchema = z.object({
  tenantId: z.string().uuid(),
  ownerId: z.string().uuid(),
  description: z.string().min(1).max(10_000),
  /** ISO date the project starts (defaults to now). */
  startsAt: z.string().datetime(),
  style: timelineStyleSchema,
  /** Optional explicit project name override. */
  projectNameHint: z.string().max(300).nullable().optional(),
});
export type GeneratorInput = z.infer<typeof generatorInputSchema>;

/**
 * Pure dependency-injectable generator function. Production wires this
 * to an LLM that returns structured milestones; tests inject a stub.
 */
export type GeneratorFn = (input: GeneratorInput) => Promise<{
  readonly projectName: string;
  readonly milestones: ReadonlyArray<
    Omit<Milestone, "dueAt" | "earliestStartAt" | "onCriticalPath" | "status">
  >;
}>;
