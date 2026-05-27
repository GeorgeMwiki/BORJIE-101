/**
 * Zod schemas + TypeScript types for the mining-shift-planner.
 *
 * Models a 24h-window shift plan over a set of workers, equipment, and
 * tasks, constrained by OSHA-TZ rest rules + fatigue + certifications.
 */

import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────

export const shiftKindSchema = z.enum(['morning', 'afternoon', 'night']);
export type ShiftKind = z.infer<typeof shiftKindSchema>;

export const taskZoneSchema = z.enum([
  'surface-pit',
  'underground',
  'crusher',
  'processing-plant',
  'haulage-road',
  'maintenance-bay',
  'overburden',
]);
export type TaskZone = z.infer<typeof taskZoneSchema>;

export const certificationSchema = z.enum([
  'haul-truck-license',
  'excavator-license',
  'underground-cert',
  'blaster-permit',
  'first-aid',
  'crusher-operator',
  'electrician-class-b',
  'confined-space',
]);
export type Certification = z.infer<typeof certificationSchema>;

export const equipmentKindSchema = z.enum([
  'excavator',
  'haul-truck',
  'drill',
  'loader',
  'crusher',
  'grader',
  'lhd',
]);
export type EquipmentKind = z.infer<typeof equipmentKindSchema>;

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof severitySchema>;

// ─── Worker ─────────────────────────────────────────────────────────

export const workShiftRecordSchema = z.object({
  shiftId: z.string(),
  startISO: z.string(),
  endISO: z.string(),
  zone: taskZoneSchema,
});
export type WorkShiftRecord = z.infer<typeof workShiftRecordSchema>;

export const workerSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  certifications: z.array(certificationSchema).default([]),
  shiftPreferences: z.array(shiftKindSchema).default([]),
  /** Past 72h worked-shift log used by fatigue scoring. */
  last72hShifts: z.array(workShiftRecordSchema).default([]),
  /** Last completed safety briefing ISO timestamp (null if never). */
  lastSafetyBriefingISO: z.string().nullable().default(null),
});
export type Worker = z.infer<typeof workerSchema>;

// ─── Equipment ──────────────────────────────────────────────────────

export const equipmentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: equipmentKindSchema,
  /** ISO datetime windows when the unit is available. */
  availableFromISO: z.string(),
  availableToISO: z.string(),
  /** Required certification for the operator. */
  requiredCertification: certificationSchema,
});
export type Equipment = z.infer<typeof equipmentSchema>;

// ─── Tasks + request ────────────────────────────────────────────────

export const shiftTaskSchema = z.object({
  id: z.string().min(1),
  zone: taskZoneSchema,
  /** Required equipment kinds for the task. */
  requiredEquipment: z.array(equipmentKindSchema).min(1),
  /** Required certifications on the assigned worker. */
  requiredCertifications: z.array(certificationSchema).default([]),
  /** Estimated duration in hours. */
  estimatedHours: z.number().positive(),
});
export type ShiftTask = z.infer<typeof shiftTaskSchema>;

export const shiftRequestSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  shiftStartISO: z.string(),
  /** ISO duration in hours (1..12). */
  durationHours: z.number().positive().max(12),
  shiftKind: shiftKindSchema,
  workers: z.array(workerSchema).min(1),
  equipment: z.array(equipmentSchema).min(1),
  tasks: z.array(shiftTaskSchema).min(1),
  /** Surface ambient temperature in Celsius — drives heat-stress rule. */
  ambientTemperatureC: z.number().default(28),
});
export type ShiftRequest = z.infer<typeof shiftRequestSchema>;

// ─── Output ─────────────────────────────────────────────────────────

export const shiftAssignmentSchema = z.object({
  taskId: z.string(),
  workerId: z.string(),
  equipmentId: z.string(),
  zone: taskZoneSchema,
  startISO: z.string(),
  endISO: z.string(),
  /** Fatigue score 0..1 at the time of assignment. */
  fatigueAtAssignment: z.number().min(0).max(1),
});
export type ShiftAssignment = z.infer<typeof shiftAssignmentSchema>;

export const shiftPlanSchema = z.object({
  tenantId: z.string(),
  siteId: z.string(),
  shiftStartISO: z.string(),
  shiftEndISO: z.string(),
  shiftKind: shiftKindSchema,
  assignments: z.array(shiftAssignmentSchema),
  /** Tasks that could not be filled — with reason. */
  unassignedTasks: z.array(
    z.object({
      taskId: z.string(),
      reason: z.string(),
    }),
  ),
  /** Workers whose hazard-zone rotation requires a swap. */
  rotationAlerts: z.array(
    z.object({
      workerId: z.string(),
      atISO: z.string(),
      label: z.string(),
    }),
  ),
});
export type ShiftPlan = z.infer<typeof shiftPlanSchema>;

// ─── Fatigue ────────────────────────────────────────────────────────

export const fatigueScoreSchema = z.object({
  workerId: z.string(),
  /** 0..1. Higher = more fatigued. */
  score: z.number().min(0).max(1),
  hoursWorkedLast24h: z.number().nonnegative(),
  hoursWorkedLast72h: z.number().nonnegative(),
  consecutiveDays: z.number().int().nonnegative(),
  recommendedMaxHours: z.number().nonnegative(),
  factors: z.array(
    z.object({
      label: z.string(),
      contribution: z.number(),
    }),
  ),
});
export type FatigueScore = z.infer<typeof fatigueScoreSchema>;

// ─── OSHA-TZ compliance ─────────────────────────────────────────────

export const oshaRuleResultSchema = z.object({
  ruleId: z.string(),
  ruleLabel: z.string(),
  pass: z.boolean(),
  severity: severitySchema,
  affectedWorkerIds: z.array(z.string()).default([]),
  detail: z.string(),
});
export type OshaRuleResult = z.infer<typeof oshaRuleResultSchema>;

export const complianceReportSchema = z.object({
  tenantId: z.string(),
  siteId: z.string(),
  shiftStartISO: z.string(),
  pass: z.boolean(),
  results: z.array(oshaRuleResultSchema),
  /** Critical failures that should block plan approval. */
  blockingFailures: z.array(z.string()),
});
export type ComplianceReport = z.infer<typeof complianceReportSchema>;
