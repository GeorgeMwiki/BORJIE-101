/**
 * Zod schemas + types for the geology advisor.
 */

import { z } from 'zod';

export const point3DSchema = z.tuple([z.number(), z.number(), z.number()]);
export type Point3D = z.infer<typeof point3DSchema>;

export const drillHoleCollarSchema = z.object({
  holeId: z.string(),
  collar: point3DSchema,
  azimuthDeg: z.number(),
  dipDeg: z.number(),
  totalDepthM: z.number().positive(),
});
export type DrillHoleCollar = z.infer<typeof drillHoleCollarSchema>;

export const assayIntervalSchema = z.object({
  holeId: z.string(),
  fromM: z.number().nonnegative(),
  toM: z.number().nonnegative(),
  /** Grade in caller-defined unit (e.g. g/t Au). */
  grade: z.number().nonnegative(),
  density: z.number().positive().default(2.7),
});
export type AssayInterval = z.infer<typeof assayIntervalSchema>;

export const veinSamplePointSchema = z.object({
  point: point3DSchema,
  grade: z.number().nonnegative(),
});
export type VeinSamplePoint = z.infer<typeof veinSamplePointSchema>;

export const geologyInputSchema = z.object({
  collars: z.array(drillHoleCollarSchema).min(1),
  assays: z.array(assayIntervalSchema).min(1),
  veinSamples: z.array(veinSamplePointSchema).default([]),
  /** Cutoff grade — intervals below are excluded from contained metal. */
  cutoffGrade: z.number().nonnegative().default(0),
});
export type GeologyInput = z.infer<typeof geologyInputSchema>;

// ─── Output ───────────────────────────────────────────────────────

export const compositedIntervalSchema = z.object({
  holeId: z.string(),
  fromM: z.number(),
  toM: z.number(),
  lengthM: z.number(),
  weightedGrade: z.number(),
  weightedDensity: z.number(),
});
export type CompositedInterval = z.infer<typeof compositedIntervalSchema>;

export const triangulatedMeshSchema = z.object({
  vertices: z.array(point3DSchema),
  /** Triangle index triples into the vertex array. */
  triangles: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])),
});
export type TriangulatedMesh = z.infer<typeof triangulatedMeshSchema>;

export const oreBodyStatsSchema = z.object({
  totalTonnes: z.number(),
  weightedAverageGrade: z.number(),
  containedMetalTonnes: z.number(),
  meanGradeAboveCutoff: z.number(),
  intervalCount: z.number().int(),
});
export type OreBodyStats = z.infer<typeof oreBodyStatsSchema>;

export const geologyAnalysisSchema = z.object({
  composited: z.array(compositedIntervalSchema),
  veinMesh: triangulatedMeshSchema.nullable(),
  stats: oreBodyStatsSchema,
  computedAtISO: z.string(),
});
export type GeologyAnalysis = z.infer<typeof geologyAnalysisSchema>;

// ─── Recommendation ───────────────────────────────────────────────

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['assay', 'collar', 'vein-sample', 'mesh', 'stats']),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const geologyRecommendationKindSchema = z.enum([
  'infill-drill',
  'extend-vein',
  'raise-cutoff',
  'flag-low-confidence-volume',
]);
export type GeologyRecommendationKind = z.infer<typeof geologyRecommendationKindSchema>;

export const geologyRecommendationSchema = z.object({
  id: z.string(),
  kind: geologyRecommendationKindSchema,
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type GeologyRecommendation = z.infer<typeof geologyRecommendationSchema>;

export const geologyRecommendationContextSchema = z.object({
  input: geologyInputSchema,
  analysis: geologyAnalysisSchema,
  policy: z
    .object({
      minSamplesPerVein: z.number().int().positive().default(3),
      minHolesPerArea: z.number().int().positive().default(2),
    })
    .default({}),
});
export type GeologyRecommendationContext = z.infer<
  typeof geologyRecommendationContextSchema
>;
