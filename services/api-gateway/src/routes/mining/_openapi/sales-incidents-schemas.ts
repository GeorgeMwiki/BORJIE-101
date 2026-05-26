/**
 * Zod-OpenAPI schemas for the sales / incidents / grievances mining routes.
 * Split out of `operations-schemas.ts` to keep each module under 300 lines.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// sales
// ---------------------------------------------------------------------------

export const SaleRouteEnum = z
  .enum(['BoT', 'MTC', 'export_direct', 'trader', 'domestic', 'other'])
  .openapi('SaleRoute');

export const PaymentStatusEnum = z
  .enum(['pending', 'partial', 'paid', 'cancelled'])
  .openapi('SalePaymentStatus');

export const SaleSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    parcelId: z.string().uuid(),
    buyerId: z.string().nullable(),
    route: SaleRouteEnum,
    weighbridgeDocId: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
    driverUserId: z.string().nullable(),
    grossPriceUsd: z.string().nullable(),
    grossPriceTzs: z.string().nullable(),
    fxAtSaleTzsPerUsd: z.string().nullable(),
    royaltyPct: z.string().nullable(),
    inspectionPct: z.string().nullable(),
    vatPct: z.string().nullable(),
    otherLevies: z.record(z.unknown()),
    netTzs: z.string().nullable(),
    paymentStatus: PaymentStatusEnum,
    ts: z.string().datetime(),
  })
  .openapi('Sale');

export const CreateSaleSchema = z
  .object({
    parcelId: z.string().min(1),
    buyerId: z.string().optional(),
    bidId: z.string().optional(),
    route: SaleRouteEnum.default('trader'),
    weighbridgeDocId: z.string().optional(),
    vehiclePlate: z.string().optional(),
    driverUserId: z.string().optional(),
    grossPriceUsd: z.string().optional(),
    grossPriceTzs: z.string().optional(),
    fxAtSaleTzsPerUsd: z.string().optional(),
    royaltyPct: z.string().optional(),
    inspectionPct: z.string().optional(),
    vatPct: z.string().optional(),
    otherLevies: z.record(z.unknown()).optional(),
    netTzs: z.string().optional(),
    paymentStatus: PaymentStatusEnum.default('pending'),
  })
  .openapi('CreateSaleRequest');

export const ListSalesQuerySchema = z
  .object({
    parcelId: z.string().optional(),
    buyerId: z.string().optional(),
    paymentStatus: PaymentStatusEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListSalesQuery');

// ---------------------------------------------------------------------------
// incidents
// ---------------------------------------------------------------------------

export const IncidentKindEnum = z
  .enum([
    'safety',
    'environmental',
    'community',
    'near_miss',
    'equipment_failure',
    'fatality',
  ])
  .openapi('IncidentKind');

export const IncidentSeverityEnum = z
  .enum(['low', 'medium', 'high', 'critical'])
  .openapi('IncidentSeverity');

export const IncidentSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    siteId: z.string().nullable(),
    kind: IncidentKindEnum,
    severity: IncidentSeverityEnum,
    occurredAt: z.string().datetime(),
    description: z.string().nullable(),
    affectedUserIds: z.array(z.string()),
    fatalities: z.number().int().nonnegative(),
    injuries: z.number().int().nonnegative(),
    location: z.string().nullable(),
    status: z.string(),
    rootCause: z.string().nullable(),
    correctiveActions: z.array(z.record(z.unknown())),
    reportedByUserId: z.string().nullable(),
    photos: z.array(z.string()),
    evidenceIds: z.array(z.string()),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('Incident');

export const CreateIncidentSchema = z
  .object({
    siteId: z.string().optional(),
    kind: IncidentKindEnum,
    severity: IncidentSeverityEnum.default('low'),
    occurredAt: z.string().datetime(),
    description: z.string().max(8000).optional(),
    affectedUserIds: z.array(z.string()).optional(),
    fatalities: z.number().int().nonnegative().default(0),
    injuries: z.number().int().nonnegative().default(0),
    location: z.string().optional(),
    rootCause: z.string().max(4000).optional(),
    correctiveActions: z.array(z.record(z.unknown())).optional(),
    photos: z.array(z.string()).optional(),
    evidenceIds: z.array(z.string()).optional(),
  })
  .openapi('CreateIncidentRequest');

export const ListIncidentsQuerySchema = z
  .object({
    siteId: z.string().optional(),
    kind: IncidentKindEnum.optional(),
    severity: IncidentSeverityEnum.optional(),
    status: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListIncidentsQuery');

// ---------------------------------------------------------------------------
// grievances
// ---------------------------------------------------------------------------

export const GrievanceRaisedByKindEnum = z
  .enum([
    'worker',
    'villager',
    'landowner',
    'community_leader',
    'local_govt',
    'ngo',
  ])
  .openapi('GrievanceRaisedByKind');

export const GrievanceCategoryEnum = z
  .enum(['noise', 'dust', 'water', 'land', 'wages', 'housing', 'access', 'other'])
  .openapi('GrievanceCategory');

export const GrievanceSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    siteId: z.string().nullable(),
    raisedByKind: GrievanceRaisedByKindEnum,
    raisedByName: z.string().nullable(),
    raisedByContact: z.string().nullable(),
    category: GrievanceCategoryEnum,
    summary: z.string(),
    status: z.string(),
    raisedAt: z.string().datetime(),
    evidenceIds: z.array(z.string()),
    attributes: z.record(z.unknown()),
  })
  .openapi('Grievance');

export const CreateGrievanceSchema = z
  .object({
    siteId: z.string().optional(),
    raisedByKind: GrievanceRaisedByKindEnum,
    raisedByName: z.string().max(200).optional(),
    raisedByContact: z.string().max(200).optional(),
    category: GrievanceCategoryEnum,
    summary: z.string().min(1).max(4000),
    evidenceIds: z.array(z.string()).optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('CreateGrievanceRequest');

export const ListGrievancesQuerySchema = z
  .object({
    siteId: z.string().optional(),
    status: z.string().optional(),
    category: GrievanceCategoryEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListGrievancesQuery');
