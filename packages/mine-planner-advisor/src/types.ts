/**
 * Zod schemas + types for the mine-planner advisor.
 */

import { z } from 'zod';

export const lngLatSchema = z.tuple([z.number(), z.number()]);
export type LngLat = z.infer<typeof lngLatSchema>;

export const polygonSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** First and last point must match — closed ring. */
  ring: z.array(lngLatSchema).min(4),
  /** Estimated ore tonnage in the polygon. */
  estimatedTonnes: z.number().nonnegative(),
  /** Avg ore grade — caller-specific unit (e.g. g/t Au). */
  grade: z.number().nonnegative().default(0),
});
export type Polygon = z.infer<typeof polygonSchema>;

export const equipmentKindSchema = z.enum([
  'excavator',
  'haul-truck',
  'drill',
  'loader',
  'crusher',
  'grader',
]);
export type EquipmentKind = z.infer<typeof equipmentKindSchema>;

export const equipmentSchema = z.object({
  id: z.string(),
  kind: equipmentKindSchema,
  capacityTonnesPerHour: z.number().positive(),
  /** ISO date window the unit is available — both inclusive. */
  availableFromISO: z.string(),
  availableToISO: z.string(),
  hourlyOpex: z.number().nonnegative(),
});
export type Equipment = z.infer<typeof equipmentSchema>;

export const crewMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  skills: z.array(equipmentKindSchema),
  shiftAvailability: z.array(z.enum(['morning', 'afternoon', 'night'])),
});
export type CrewMember = z.infer<typeof crewMemberSchema>;

export const planInputSchema = z.object({
  siteId: z.string(),
  planDateISO: z.string(),
  polygons: z.array(polygonSchema).min(1),
  fleet: z.array(equipmentSchema).min(1),
  crew: z.array(crewMemberSchema).min(1),
  targetTonnesPerDay: z.number().positive(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

// ─── Output ───────────────────────────────────────────────────────

export const taskAssignmentSchema = z.object({
  polygonId: z.string(),
  shift: z.enum(['morning', 'afternoon', 'night']),
  equipmentId: z.string(),
  crewIds: z.array(z.string()).min(1),
  estimatedTonnes: z.number().nonnegative(),
  estimatedHours: z.number().nonnegative(),
  estimatedOpex: z.number().nonnegative(),
});
export type TaskAssignment = z.infer<typeof taskAssignmentSchema>;

export const shiftPlanSchema = z.object({
  siteId: z.string(),
  planDateISO: z.string(),
  assignments: z.array(taskAssignmentSchema),
  totalEstimatedTonnes: z.number(),
  totalEstimatedOpex: z.number(),
  unmetTonnes: z.number(),
});
export type ShiftPlan = z.infer<typeof shiftPlanSchema>;

// ─── Recommendation ───────────────────────────────────────────────

export const planRecommendationKindSchema = z.enum([
  'add-shift',
  'rebalance-equipment',
  'hire-skill',
  'defer-polygon',
  'increase-availability-window',
]);
export type PlanRecommendationKind = z.infer<typeof planRecommendationKindSchema>;

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['polygon', 'equipment', 'crew', 'assignment']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const planRecommendationSchema = z.object({
  id: z.string(),
  kind: planRecommendationKindSchema,
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type PlanRecommendation = z.infer<typeof planRecommendationSchema>;

export const planRecommendationContextSchema = z.object({
  input: planInputSchema,
  plan: shiftPlanSchema,
});
export type PlanRecommendationContext = z.infer<
  typeof planRecommendationContextSchema
>;
