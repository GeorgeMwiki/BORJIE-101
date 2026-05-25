/**
 * Piece Q — Long-horizon agency types.
 *
 * Zod schemas mirror the migrations (0266–0270) so anything the package
 * surface accepts round-trips through validators. Internal helpers may
 * use the inferred TS types directly.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Mission header (0266)
// ─────────────────────────────────────────────────────────────────────────

export const riskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']);
export type RiskTier = z.infer<typeof riskTierSchema>;

export const autonomyTierSchema = z.enum([
  'HITL_HIGH',
  'HITL_MEDIUM',
  'HITL_LOW',
  'AUTONOMOUS',
]);
export type AutonomyTier = z.infer<typeof autonomyTierSchema>;

export const missionStatusSchema = z.enum([
  'planning',
  'active',
  'paused',
  'completed',
  'abandoned',
  'escalated',
]);
export type MissionStatus = z.infer<typeof missionStatusSchema>;

export const agencyMissionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  assignedByUserId: z.string().min(1),
  ownerPersonaId: z.string().min(1).nullable(),
  title: z.string().min(1),
  goal: z.string().min(1),
  contextJsonb: z.record(z.unknown()).default({}),
  expectedCompletionDate: z.string().nullable(),
  riskTier: riskTierSchema,
  autonomyTier: autonomyTierSchema,
  status: missionStatusSchema,
  budgetMinorUnits: z.number().int().min(0).nullable(),
  spentMinorUnits: z.number().int().min(0),
  assetRefs: z.array(z.string()).default([]),
  auditChainId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AgencyMission = z.infer<typeof agencyMissionSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Steps (0267)
// ─────────────────────────────────────────────────────────────────────────

export const stepKindSchema = z.enum([
  'plan',
  'gather',
  'execute',
  'check',
  'reflect',
]);
export type StepKind = z.infer<typeof stepKindSchema>;

export const stepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped',
  'failed',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const missionStepSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  missionId: z.string().min(1),
  ordinal: z.number().int().min(0).max(32_767),
  title: z.string().min(1),
  description: z.string().nullable(),
  stepKind: stepKindSchema,
  actionPlanId: z.string().nullable(),
  status: stepStatusSchema,
  scheduledFor: z.string().nullable(),
  attempts: z.number().int().min(0),
  resultJsonb: z.record(z.unknown()).nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MissionStep = z.infer<typeof missionStepSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Checkpoints (0268)
// ─────────────────────────────────────────────────────────────────────────

export const checkpointKindSchema = z.enum(['daily', 'weekly', 'milestone']);
export type CheckpointKind = z.infer<typeof checkpointKindSchema>;

export const checkpointStatusSchema = z.enum([
  'pending',
  'completed',
  'missed',
]);
export type CheckpointStatus = z.infer<typeof checkpointStatusSchema>;

export const checkpointGapSchema = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
});
export type CheckpointGap = z.infer<typeof checkpointGapSchema>;

export const driftSignalSchema = z.object({
  kind: z.string().min(1),
  message: z.string().min(1),
  observedAt: z.string(),
  details: z.record(z.unknown()).default({}),
});
export type DriftSignal = z.infer<typeof driftSignalSchema>;

export const missionCheckpointSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  missionId: z.string().min(1),
  checkpointKind: checkpointKindSchema,
  scheduledAt: z.string(),
  status: checkpointStatusSchema,
  summary: z.string().nullable(),
  gapsJsonb: z.array(checkpointGapSchema).nullable(),
  driftSignalsJsonb: z.array(driftSignalSchema).nullable(),
  needsHumanReview: z.boolean(),
  reviewedAt: z.string().nullable(),
  reviewedByUserId: z.string().nullable(),
  createdAt: z.string(),
});
export type MissionCheckpoint = z.infer<typeof missionCheckpointSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Outcomes (0269)
// ─────────────────────────────────────────────────────────────────────────

export const outcomeKindSchema = z.enum([
  'success',
  'partial',
  'failed',
  'abandoned',
]);
export type OutcomeKind = z.infer<typeof outcomeKindSchema>;

export const lessonLearnedSchema = z.object({
  lesson: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sourceStepIds: z.array(z.string()).default([]),
});
export type LessonLearned = z.infer<typeof lessonLearnedSchema>;

export const missionMetricsSchema = z.object({
  stepsCompleted: z.number().int().min(0),
  stepsFailed: z.number().int().min(0),
  stepsSkipped: z.number().int().min(0),
  daysElapsed: z.number().int().min(0),
  costMinorUnits: z.number().int().min(0),
  replans: z.number().int().min(0),
  escalations: z.number().int().min(0),
});
export type MissionMetrics = z.infer<typeof missionMetricsSchema>;

export const missionOutcomeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  missionId: z.string().min(1),
  outcomeKind: outcomeKindSchema,
  narrative: z.string().min(1),
  metricsJsonb: missionMetricsSchema,
  lessonsLearnedJsonb: z.array(lessonLearnedSchema),
  createdAt: z.string(),
});
export type MissionOutcome = z.infer<typeof missionOutcomeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Drift log (0270)
// ─────────────────────────────────────────────────────────────────────────

export const driftKindSchema = z.enum([
  'goal_shift',
  'step_replan',
  'budget_overrun',
  'deadline_slip',
  'external_blocker',
]);
export type DriftKind = z.infer<typeof driftKindSchema>;

export const detectedBySchema = z.enum(['self', 'human', 'drift_detector']);
export type DetectedBy = z.infer<typeof detectedBySchema>;

export const missionDriftEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  missionId: z.string().min(1),
  driftKind: driftKindSchema,
  description: z.string().min(1),
  beforeJsonb: z.record(z.unknown()).nullable(),
  afterJsonb: z.record(z.unknown()).nullable(),
  detectedBy: detectedBySchema,
  approvedByUserId: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MissionDriftEvent = z.infer<typeof missionDriftEventSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Planner input / output
// ─────────────────────────────────────────────────────────────────────────

export const planMissionInputSchema = z.object({
  tenantId: z.string().min(1),
  assignedByUserId: z.string().min(1),
  ownerPersonaId: z.string().nullable().default(null),
  title: z.string().min(1),
  goal: z.string().min(1),
  context: z.record(z.unknown()).default({}),
  constraints: z
    .object({
      expectedCompletionDate: z.string().nullable().default(null),
      riskTier: riskTierSchema.default('MEDIUM'),
      autonomyTier: autonomyTierSchema.default('HITL_HIGH'),
      budgetMinorUnits: z.number().int().min(0).nullable().default(null),
      assetRefs: z.array(z.string()).default([]),
    })
    .default({
      expectedCompletionDate: null,
      riskTier: 'MEDIUM',
      autonomyTier: 'HITL_HIGH',
      budgetMinorUnits: null,
      assetRefs: [],
    }),
});
export type PlanMissionInput = z.infer<typeof planMissionInputSchema>;

export const plannedStepSchema = z.object({
  ordinal: z.number().int().min(0).max(32_767),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  stepKind: stepKindSchema,
  actionPlanId: z.string().nullable().default(null),
  scheduledFor: z.string().nullable().default(null),
});
export type PlannedStep = z.infer<typeof plannedStepSchema>;

export const planMissionOutputSchema = z.object({
  mission: agencyMissionSchema,
  steps: z.array(missionStepSchema),
});
export type PlanMissionOutput = z.infer<typeof planMissionOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Dispatch result
// ─────────────────────────────────────────────────────────────────────────

export const stepDispatchResultSchema = z.object({
  stepId: z.string().min(1),
  status: stepStatusSchema,
  result: z.record(z.unknown()).nullable().default(null),
  durationMs: z.number().int().min(0),
  costMinorUnits: z.number().int().min(0).default(0),
  errorMessage: z.string().nullable().default(null),
});
export type StepDispatchResult = z.infer<typeof stepDispatchResultSchema>;
