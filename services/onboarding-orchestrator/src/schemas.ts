/**
 * Zod schemas — onboarding-orchestrator inputs / outputs.
 *
 * Every step accepts a typed input and returns a typed result; the
 * orchestrator persists both into the `onboarding_sessions.state_jsonb`
 * blob keyed by step name. Adding a new step means appending a key
 * here, an entry in `WizardStepSchema`, and a sibling file under
 * `./steps/`.
 *
 * All schemas use `strict()` so unknown keys raise — no silent
 * passthrough into the database.
 */

import { z } from 'zod';

// ============================================================================
// Wizard step enum + session lifecycle
// ============================================================================

export const WIZARD_STEPS = [
  'kyb',
  'licences',
  'sites',
  'drill_holes',
  'cockpit_seed',
  'complete',
] as const;

export const WizardStepSchema = z.enum(WIZARD_STEPS);
export type WizardStep = z.infer<typeof WizardStepSchema>;

// ============================================================================
// Step 1 — NIDA + company KYB
// ============================================================================

export const KybInputSchema = z
  .object({
    companyName: z.string().min(1).max(256),
    registrationNo: z.string().min(1).max(64),
    tin: z.string().min(1).max(32),
    registeredAddress: z.string().min(1).max(512),
    country: z.string().length(2).default('TZ'),
    directors: z
      .array(
        z
          .object({
            fullName: z.string().min(1).max(256),
            nidaId: z.string().min(8).max(32),
            role: z.string().min(1).max(64),
            nationality: z.string().length(2).default('TZ'),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type KybInput = z.infer<typeof KybInputSchema>;

export const KybResultSchema = z
  .object({
    companyId: z.string(),
    directorIds: z.array(z.string()),
    nidaVerified: z.boolean(),
  })
  .strict();
export type KybResult = z.infer<typeof KybResultSchema>;

// ============================================================================
// Step 2 — Licence import (PML/PL/SML/ML)
// ============================================================================

export const LICENCE_KINDS = ['PML', 'PL', 'SML', 'ML'] as const;

export const LicenceUploadSchema = z
  .object({
    kind: z.enum(LICENCE_KINDS),
    number: z.string().min(1).max(64),
    mineral: z.string().min(1).max(64),
    grantDate: z.string().date().optional(),
    expiryDate: z.string().date().optional(),
    areaHa: z.number().nonnegative().optional(),
    pdfRef: z.string().url().optional(),
  })
  .strict();

export const LicencesInputSchema = z
  .object({
    companyId: z.string().min(1),
    licences: z.array(LicenceUploadSchema).min(1).max(100),
  })
  .strict();
export type LicencesInput = z.infer<typeof LicencesInputSchema>;

export const LicencesResultSchema = z
  .object({
    licenceIds: z.array(z.string()),
    parsedCount: z.number().int().nonnegative(),
  })
  .strict();
export type LicencesResult = z.infer<typeof LicencesResultSchema>;

// ============================================================================
// Step 3 — Site geometry intake (GeoJSON polygons)
// ============================================================================

export const GeoJsonPolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  })
  .strict();

export const SiteIntakeSchema = z
  .object({
    licenceId: z.string().min(1),
    name: z.string().min(1).max(256),
    mineral: z.string().min(1).max(64),
    polygon: GeoJsonPolygonSchema,
  })
  .strict();

export const SitesInputSchema = z
  .object({
    sites: z.array(SiteIntakeSchema).min(1).max(50),
  })
  .strict();
export type SitesInput = z.infer<typeof SitesInputSchema>;

export const SitesResultSchema = z
  .object({
    siteIds: z.array(z.string()),
  })
  .strict();
export type SitesResult = z.infer<typeof SitesResultSchema>;

// ============================================================================
// Step 4 — First drill-hole batch (CSV-derived rows)
// ============================================================================

export const DrillHoleRowSchema = z
  .object({
    siteId: z.string().min(1),
    holeIdExternal: z.string().min(1).max(64),
    kind: z.enum([
      'pit',
      'shaft',
      'rc',
      'diamond',
      'hand_augur',
      'trench',
      'channel',
    ]),
    azimuthDeg: z.number().min(0).max(360).optional(),
    dipDeg: z.number().min(-90).max(90).optional(),
    totalDepthM: z.number().nonnegative().optional(),
    layers: z
      .array(
        z
          .object({
            depthFromM: z.number().nonnegative(),
            depthToM: z.number().nonnegative(),
            lithology: z.string().max(128).optional(),
            isVeinIntersect: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export const DrillHolesInputSchema = z
  .object({
    rows: z.array(DrillHoleRowSchema).min(1).max(1000),
  })
  .strict();
export type DrillHolesInput = z.infer<typeof DrillHolesInputSchema>;

export const DrillHolesResultSchema = z
  .object({
    holeIds: z.array(z.string()),
    layerCount: z.number().int().nonnegative(),
  })
  .strict();
export type DrillHolesResult = z.infer<typeof DrillHolesResultSchema>;

// ============================================================================
// Step 5 — Cockpit seed (first daily-brief stub)
// ============================================================================

export const CockpitSeedInputSchema = z
  .object({
    headline: z.string().min(1).max(256).optional(),
  })
  .strict();
export type CockpitSeedInput = z.infer<typeof CockpitSeedInputSchema>;

export const CockpitSeedResultSchema = z
  .object({
    briefId: z.string(),
    seededAt: z.string().datetime(),
  })
  .strict();
export type CockpitSeedResult = z.infer<typeof CockpitSeedResultSchema>;

// ============================================================================
// Session envelope
// ============================================================================

export const StartSessionSchema = z
  .object({
    tenantId: z.string().min(1),
    ownerUserId: z.string().min(1),
  })
  .strict();
export type StartSessionInput = z.infer<typeof StartSessionSchema>;

export const AdvanceSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    step: WizardStepSchema,
    payload: z.unknown(),
  })
  .strict();
export type AdvanceSessionInput = z.infer<typeof AdvanceSessionSchema>;

export const SessionStateSchema = z
  .object({
    sessionId: z.string(),
    tenantId: z.string(),
    ownerUserId: z.string(),
    currentStep: WizardStepSchema,
    state: z.record(z.unknown()),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type SessionState = z.infer<typeof SessionStateSchema>;
