/**
 * Zod-OpenAPI schemas for the field-capture mining routes:
 *   /drill-holes, /samples, /shift-reports, /attendance, /fuel-logs,
 *   /maintenance, /ore-parcels, /sales, /incidents, /grievances.
 *
 * Mirrors the inline schemas previously declared in each route file
 * (see issue #60). Splitting them out lets the spec generator emit
 * named components and lets route-defs files stay under 300 lines.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// drill-holes
// ---------------------------------------------------------------------------

export const DrillHoleKindEnum = z
  .enum(['pit', 'shaft', 'rc', 'diamond', 'hand_augur', 'trench', 'channel'])
  .openapi('DrillHoleKind');

export const DrillHoleSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    siteId: z.string().uuid(),
    holeIdExternal: z.string(),
    kind: DrillHoleKindEnum,
    collarLocation: z.string().nullable(),
    azimuthDeg: z.string().nullable(),
    dipDeg: z.string().nullable(),
    totalDepthM: z.string().nullable(),
    supervisorUserId: z.string().nullable(),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('DrillHole');

export const DrillHoleLayerSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    holeId: z.string().uuid(),
    depthFromM: z.string(),
    depthToM: z.string(),
    lithology: z.string().nullable(),
    colour: z.string().nullable(),
    grainSize: z.string().nullable(),
    isVeinIntersect: z.boolean(),
    veinWidthM: z.string().nullable(),
    veinDipDeg: z.string().nullable(),
    hostRock: z.string().nullable(),
    mineralisationIndicators: z.array(z.string()),
    photoUrl: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('DrillHoleLayer');

export const CreateDrillHoleSchema = z
  .object({
    siteId: z.string().min(1),
    holeIdExternal: z.string().min(1).max(80),
    kind: DrillHoleKindEnum,
    collarLocation: z.string().optional(),
    azimuthDeg: z.string().optional(),
    dipDeg: z.string().optional(),
    totalDepthM: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('CreateDrillHoleRequest');

export const CreateDrillHoleLayerSchema = z
  .object({
    depthFromM: z.string().min(1),
    depthToM: z.string().min(1),
    lithology: z.string().optional(),
    colour: z.string().optional(),
    grainSize: z.string().optional(),
    isVeinIntersect: z.boolean().default(false),
    veinWidthM: z.string().optional(),
    veinDipDeg: z.string().optional(),
    hostRock: z.string().optional(),
    mineralisationIndicators: z.array(z.string()).optional(),
    photoUrl: z.string().url().optional(),
    notes: z.string().max(2000).optional(),
  })
  .openapi('CreateDrillHoleLayerRequest');

export const ListDrillHolesQuerySchema = z
  .object({
    siteId: z.string().optional(),
    kind: DrillHoleKindEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListDrillHolesQuery');

export const IdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('MiningIdParam');

// ---------------------------------------------------------------------------
// samples
// ---------------------------------------------------------------------------

export const SampleSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    drillHoleId: z.string().nullable(),
    depthM: z.string().nullable(),
    sampleTag: z.string(),
    massG: z.string().nullable(),
    labId: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
    receivedAt: z.string().datetime().nullable(),
    resultsAt: z.string().datetime().nullable(),
    results: z.record(z.unknown()),
    qaQc: z.record(z.unknown()),
    passedQaqc: z.boolean().nullable(),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('Sample');

export const CreateSampleSchema = z
  .object({
    drillHoleId: z.string().optional(),
    depthM: z.string().optional(),
    sampleTag: z.string().min(1).max(120),
    massG: z.string().optional(),
    labId: z.string().optional(),
    sentAt: z.string().datetime().optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('CreateSampleRequest');

export const AssayResultSchema = z
  .object({
    results: z.record(z.union([z.number(), z.string()])),
    qaQc: z.record(z.unknown()).optional(),
    passedQaqc: z.boolean(),
    receivedAt: z.string().datetime().optional(),
    resultsAt: z.string().datetime().optional(),
  })
  .openapi('AssayResultRequest');

export const ListSamplesQuerySchema = z
  .object({
    drillHoleId: z.string().optional(),
    passedQaqc: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListSamplesQuery');

// ---------------------------------------------------------------------------
// shift-reports
// ---------------------------------------------------------------------------

export const ShiftKindEnum = z.enum(['day', 'night']).openapi('ShiftKind');

export const ShiftDelaySchema = z
  .object({
    code: z.string(),
    minutes: z.number().int().nonnegative(),
    description: z.string().optional(),
  })
  .openapi('ShiftDelay');

export const ShiftReportSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    siteId: z.string().uuid(),
    supervisorUserId: z.string().nullable(),
    shiftDate: z.string(),
    shiftKind: ShiftKindEnum,
    workersPresent: z.number().int().nullable(),
    machineHours: z.record(z.number()),
    fuelLitres: z.string().nullable(),
    metresAdvanced: z.string().nullable(),
    bcmOverburden: z.string().nullable(),
    romTonnes: z.string().nullable(),
    blastsFired: z.number().int(),
    delays: z.array(ShiftDelaySchema),
    incidents: z.array(z.record(z.unknown())),
    photos: z.array(z.string()),
    nextShiftPlan: z.string().nullable(),
    signedOffAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('ShiftReport');

export const CreateShiftReportSchema = z
  .object({
    siteId: z.string().min(1),
    shiftDate: z.string().min(8),
    shiftKind: ShiftKindEnum.default('day'),
    workersPresent: z.number().int().nonnegative().optional(),
    machineHours: z.record(z.number()).optional(),
    fuelLitres: z.string().optional(),
    metresAdvanced: z.string().optional(),
    bcmOverburden: z.string().optional(),
    romTonnes: z.string().optional(),
    blastsFired: z.number().int().nonnegative().default(0),
    delays: z.array(ShiftDelaySchema).optional(),
    incidents: z.array(z.record(z.unknown())).optional(),
    photos: z.array(z.string()).optional(),
    voiceNoteRef: z.string().optional(),
    nextShiftPlan: z.string().max(4000).optional(),
  })
  .openapi('CreateShiftReportRequest');

export const ListShiftReportsQuerySchema = z
  .object({
    siteId: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListShiftReportsQuery');
