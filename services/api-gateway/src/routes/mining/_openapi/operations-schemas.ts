/**
 * Zod-OpenAPI schemas for the attendance / fuel-logs / maintenance /
 * ore-parcels mining routes. The sales / incidents / grievances schemas
 * live in `./sales-incidents-schemas.ts` to keep each module under the
 * 300-line cap.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

export const AttendanceRowSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    employeeId: z.string(),
    siteId: z.string(),
    workDate: z.string(),
    shiftKind: z.enum(['day', 'night']),
    status: z.string(),
    hoursWorked: z.string().nullable(),
    signedOffByUserId: z.string().nullable(),
    signedOffAt: z.string().datetime().nullable(),
    signedOffFingerprintEventId: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .openapi('AttendanceRow');

export const CheckInSchema = z
  .object({
    employeeId: z.string().min(1),
    siteId: z.string().min(1),
    workDate: z.string().min(8),
    shiftKind: z.enum(['day', 'night']).default('day'),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    withinFence: z.boolean(),
    fingerprintEventId: z.string().optional(),
  })
  .openapi('AttendanceCheckInRequest');

export const CheckOutSchema = z
  .object({
    attendanceId: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    withinFence: z.boolean(),
    fingerprintEventId: z.string().optional(),
    notes: z.string().max(1000).optional(),
  })
  .openapi('AttendanceCheckOutRequest');

// ---------------------------------------------------------------------------
// fuel-logs
// ---------------------------------------------------------------------------

export const FuelKindEnum = z
  .enum(['diesel', 'petrol', 'lubricant', 'other'])
  .openapi('FuelKind');

export const FuelLogSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    assetId: z.string(),
    siteId: z.string().nullable(),
    logDate: z.string(),
    fuelKind: FuelKindEnum,
    litres: z.string(),
    pricePerLitreTzs: z.string().nullable(),
    totalCostTzs: z.string().nullable(),
    meterReading: z.string().nullable(),
    issuedByUserId: z.string().nullable(),
    receivedByUserId: z.string().nullable(),
    evidenceIds: z.array(z.string()),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('FuelLog');

export const CreateFuelLogSchema = z
  .object({
    assetId: z.string().min(1),
    siteId: z.string().optional(),
    logDate: z.string().min(8),
    fuelKind: FuelKindEnum.default('diesel'),
    litres: z.string().min(1),
    pricePerLitreTzs: z.string().optional(),
    totalCostTzs: z.string().optional(),
    meterReading: z.string().optional(),
    receivedByUserId: z.string().optional(),
    evidenceIds: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .openapi('CreateFuelLogRequest');

// ---------------------------------------------------------------------------
// maintenance
// ---------------------------------------------------------------------------

export const MaintenanceKindEnum = z
  .enum([
    'scheduled_service',
    'repair',
    'inspection',
    'breakdown',
    'overhaul',
    'tyre_change',
    'other',
  ])
  .openapi('MaintenanceKind');

export const MaintenanceStatusEnum = z
  .enum(['open', 'in_progress', 'completed', 'cancelled'])
  .openapi('MaintenanceStatus');

export const MaintenanceEventSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    assetId: z.string(),
    kind: MaintenanceKindEnum,
    status: MaintenanceStatusEnum,
    summary: z.string().nullable(),
    downtimeHours: z.string().nullable(),
    costTzs: z.string().nullable(),
    partsUsed: z.array(z.record(z.unknown())),
    performedByUserId: z.string().nullable(),
    scheduledFor: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    evidenceIds: z.array(z.string()),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('MaintenanceEvent');

export const CreateMaintenanceEventSchema = z
  .object({
    assetId: z.string().min(1),
    kind: MaintenanceKindEnum,
    status: MaintenanceStatusEnum.default('open'),
    summary: z.string().max(2000).optional(),
    downtimeHours: z.string().optional(),
    costTzs: z.string().optional(),
    partsUsed: z.array(z.record(z.unknown())).optional(),
    scheduledFor: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    evidenceIds: z.array(z.string()).optional(),
  })
  .openapi('CreateMaintenanceEventRequest');

export const ListMaintenanceQuerySchema = z
  .object({
    assetId: z.string().optional(),
    status: MaintenanceStatusEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListMaintenanceQuery');

// ---------------------------------------------------------------------------
// ore-parcels
// ---------------------------------------------------------------------------

export const OreParcelStatusEnum = z
  .enum(['in_stockpile', 'in_transit', 'at_buyer', 'sold', 'spoiled'])
  .openapi('OreParcelStatus');

export const OreParcelSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    siteId: z.string().uuid(),
    massKg: z.string().nullable(),
    grade: z.record(z.unknown()),
    storageLocation: z.string().nullable(),
    status: OreParcelStatusEnum,
    photos: z.array(z.string()),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('OreParcel');

export const CreateOreParcelSchema = z
  .object({
    siteId: z.string().min(1),
    massKg: z.string().optional(),
    grade: z.record(z.union([z.number(), z.string()])).optional(),
    storageLocation: z.string().optional(),
    photos: z.array(z.string()).optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('CreateOreParcelRequest');

export const ListForSaleSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    priceTzs: z.string().min(1),
    priceUnit: z.string().default('per_kg'),
    visibility: z
      .enum(['private', 'tanzania', 'regional', 'global'])
      .default('tanzania'),
    expiresAt: z.string().datetime().optional(),
    location: z.string().optional(),
  })
  .openapi('ListOreParcelForSaleRequest');

export const ListOreParcelsQuerySchema = z
  .object({
    siteId: z.string().optional(),
    status: OreParcelStatusEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListOreParcelsQuery');

