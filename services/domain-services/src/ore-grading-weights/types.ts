/**
 * Ore-grading weights — types, Zod validators, defaults.
 *
 * Weights drive how the headline grade for an ore parcel is composed
 * from its raw assay dimensions. Stored per-tenant inside
 * `tenants.settings.oreGradingWeights` (jsonb) so we don't need a
 * dedicated table for what is fundamentally a six-number config blob.
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface OreGradingWeights {
  /** Headline grade % weight (e.g. assay Au g/t). */
  readonly grade: number;
  /** Process recovery factor weight (0-1). */
  readonly processability: number;
  /** Mineable tonnage weight. */
  readonly tonnage: number;
  /** Penalty for deleterious elements (As, Hg, etc.). */
  readonly deleteriousPenalty: number;
  /** Logistics cost-to-market weight. */
  readonly logistics: number;
  /** Operator-confidence weight (geology + sampling density). */
  readonly confidence: number;
}

export const DEFAULT_ORE_GRADING_WEIGHTS: OreGradingWeights = Object.freeze({
  grade: 0.35,
  processability: 0.2,
  tonnage: 0.15,
  deleteriousPenalty: 0.1,
  logistics: 0.1,
  confidence: 0.1,
});

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

export const oreGradingWeightsSchema = z.object({
  grade: z.number().min(0).max(1),
  processability: z.number().min(0).max(1),
  tonnage: z.number().min(0).max(1),
  deleteriousPenalty: z.number().min(0).max(1),
  logistics: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface OreGradingWeightsRepository {
  getWeights(tenantId: TenantId): Promise<OreGradingWeights>;
  setWeights(
    tenantId: TenantId,
    weights: OreGradingWeights,
  ): Promise<OreGradingWeights>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw jsonb blob into a typed weights object. Falls back to
 * defaults on any validation failure so the grading pipeline never
 * crashes for a tenant whose settings drift out-of-schema.
 */
export function parseWeights(raw: unknown): OreGradingWeights {
  const parsed = oreGradingWeightsSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_ORE_GRADING_WEIGHTS;
  return parsed.data;
}

/**
 * Normalise weights so their sum equals 1.0. Idempotent on already-
 * normalised input.
 */
export function normaliseWeights(weights: OreGradingWeights): OreGradingWeights {
  const total =
    weights.grade +
    weights.processability +
    weights.tonnage +
    weights.deleteriousPenalty +
    weights.logistics +
    weights.confidence;
  if (total <= 0) return DEFAULT_ORE_GRADING_WEIGHTS;
  return {
    grade: weights.grade / total,
    processability: weights.processability / total,
    tonnage: weights.tonnage / total,
    deleteriousPenalty: weights.deleteriousPenalty / total,
    logistics: weights.logistics / total,
    confidence: weights.confidence / total,
  };
}
