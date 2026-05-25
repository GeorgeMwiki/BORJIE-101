/**
 * Metadata layer schemas — typed Zod schemas for each of the 6 standard
 * layers, plus a generic `customLayerSchema` factory.
 *
 * Each layer carries a `recordedAt` ISO-timestamp; the layer store keeps
 * versioned history so an older recording can be retrieved at any point.
 */

import { z } from 'zod';

// ============================================================================
// Legal
// ============================================================================

export const legalLayerSchema = z.object({
  title: z.string().optional(),
  tenure: z.enum([
    'freehold',
    'leasehold',
    'right_of_occupancy',
    'customary',
    'communal',
    'concession',
    'unknown',
  ]).default('unknown'),
  registryNumber: z.string().optional(),
  encumbrances: z.array(z.object({
    kind: z.string(),
    holder: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().length(3).optional(),
    description: z.string().optional(),
  })).default([]),
  easements: z.array(z.object({
    kind: z.string(),
    beneficiary: z.string().optional(),
    description: z.string().optional(),
  })).default([]),
  expiresAt: z.string().datetime().optional(),
});

export type LegalLayer = z.infer<typeof legalLayerSchema>;

// ============================================================================
// Physical
// ============================================================================

export const physicalLayerSchema = z.object({
  terrain: z.enum(['flat', 'rolling', 'sloped', 'steep', 'undulating', 'unknown']).default('unknown'),
  slopePct: z.number().min(0).max(100).optional(),
  soilType: z.string().optional(),
  drainage: z.enum(['well_drained', 'moderate', 'poor', 'wetland', 'unknown']).default('unknown'),
  accessRoads: z.array(z.object({
    name: z.string().optional(),
    classification: z.string().optional(),
    surface: z.string().optional(),
  })).default([]),
  utilitiesPresent: z.object({
    power: z.boolean().default(false),
    water: z.boolean().default(false),
    sewer: z.boolean().default(false),
    gas: z.boolean().default(false),
    internet: z.boolean().default(false),
  }).default({}),
});

export type PhysicalLayer = z.infer<typeof physicalLayerSchema>;

// ============================================================================
// Financial
// ============================================================================

export const financialLayerSchema = z.object({
  valuation: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().length(3),
    asOf: z.string().datetime(),
    methodology: z.string().optional(),
  }).optional(),
  taxes: z.object({
    annualLandTax: z.number().optional(),
    currency: z.string().length(3).optional(),
    lastPaidAt: z.string().datetime().optional(),
  }).optional(),
  mortgage: z.object({
    lender: z.string(),
    principal: z.number(),
    interestRatePct: z.number(),
    currency: z.string().length(3),
    maturesAt: z.string().datetime().optional(),
  }).optional(),
  noiAnnual: z.number().optional(),
  comparableSales: z.array(z.object({
    soldAt: z.string().datetime(),
    pricePerSqm: z.number(),
    currency: z.string().length(3),
    referenceParcelId: z.string().optional(),
  })).default([]),
});

export type FinancialLayer = z.infer<typeof financialLayerSchema>;

// ============================================================================
// Environmental
// ============================================================================

export const environmentalLayerSchema = z.object({
  floodRisk: z.enum(['none', 'low', 'moderate', 'high', 'extreme']).default('none'),
  ghgEmissionsTco2e: z.number().optional(),
  biodiversityScore: z.number().min(0).max(100).optional(),
  protectedStatus: z.enum(['none', 'buffer_zone', 'protected', 'critical_habitat']).default('none'),
  eiaHistory: z.array(z.object({
    completedAt: z.string().datetime(),
    rating: z.string().optional(),
    findingsSummary: z.string().optional(),
  })).default([]),
  treeCoverPct: z.number().min(0).max(100).optional(),
});

export type EnvironmentalLayer = z.infer<typeof environmentalLayerSchema>;

// ============================================================================
// Social
// ============================================================================

export const socialLayerSchema = z.object({
  nearbySchoolsCount: z.number().int().nonnegative().optional(),
  nearbyHospitalsCount: z.number().int().nonnegative().optional(),
  transitStopsWithin1km: z.number().int().nonnegative().optional(),
  populationDensityPerSqkm: z.number().nonnegative().optional(),
  crimeIndex: z.number().min(0).max(100).optional(),
  walkScore: z.number().min(0).max(100).optional(),
  primaryLanguage: z.string().optional(),
});

export type SocialLayer = z.infer<typeof socialLayerSchema>;

// ============================================================================
// Infrastructure
// ============================================================================

export const infrastructureLayerSchema = z.object({
  power: z.object({
    connected: z.boolean().default(false),
    supplier: z.string().optional(),
    voltage: z.string().optional(),
  }).default({}),
  water: z.object({
    connected: z.boolean().default(false),
    supplier: z.string().optional(),
    source: z.enum(['piped', 'borehole', 'rainwater', 'truck', 'none']).optional(),
  }).default({}),
  sewer: z.object({
    connected: z.boolean().default(false),
    method: z.enum(['municipal', 'septic', 'pit', 'none']).optional(),
  }).default({}),
  internet: z.object({
    available: z.boolean().default(false),
    technology: z.enum(['fiber', '5g', '4g', 'satellite', 'dsl', 'none']).optional(),
  }).default({}),
  roadClass: z.string().optional(),
  publicTransit: z.array(z.string()).default([]),
});

export type InfrastructureLayer = z.infer<typeof infrastructureLayerSchema>;

// ============================================================================
// Custom layer factory — org-specific extensions via JSON-schema fragment
// ============================================================================

/**
 * Builds a Zod-validated custom layer from a plain shape spec. Caller is
 * responsible for storing the shape spec alongside the org's
 * configuration.
 */
export function customLayerSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape);
}

// ============================================================================
// Registry — kind -> schema lookup
// ============================================================================

export const layerSchemaByKind = {
  legal: legalLayerSchema,
  physical: physicalLayerSchema,
  financial: financialLayerSchema,
  environmental: environmentalLayerSchema,
  social: socialLayerSchema,
  infrastructure: infrastructureLayerSchema,
} as const;

export type StandardLayerKind = keyof typeof layerSchemaByKind;
