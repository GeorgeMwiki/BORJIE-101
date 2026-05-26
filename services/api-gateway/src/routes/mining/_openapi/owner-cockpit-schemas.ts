/**
 * Zod-OpenAPI schemas for owner-cockpit-adjacent mining routes:
 *   /lmbm, /documents, /reports, /portfolio-map, /buyers (KYC).
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// lmbm (Live Mining Brain Memory)
// ---------------------------------------------------------------------------

export const TemporalEntitySchema = z
  .object({
    id: z.string(),
    tenantId: z.string().nullable(),
    entityType: z.string(),
    name: z.string().nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .passthrough()
  .openapi('TemporalEntity');

export const TemporalRelationshipSchema = z
  .object({
    id: z.string(),
    tenantId: z.string().nullable(),
    fromEntityId: z.string(),
    toEntityId: z.string(),
    relationship: z.string(),
    invalidatedAt: z.string().datetime().nullable().optional(),
  })
  .passthrough()
  .openapi('TemporalRelationship');

export const LmbmGraphDataSchema = z
  .object({
    entities: z.array(TemporalEntitySchema),
    edges: z.array(TemporalRelationshipSchema),
  })
  .openapi('LmbmGraphData');

export const LmbmTraverseEdgeSchema = z
  .object({
    id: z.string(),
    from_entity_id: z.string(),
    to_entity_id: z.string(),
    relationship: z.string(),
    depth: z.number().int().positive(),
  })
  .openapi('LmbmTraverseEdge');

export const LmbmTraverseDataSchema = z
  .object({
    from: z.string(),
    maxDepth: z.number().int().positive(),
    edges: z.array(LmbmTraverseEdgeSchema),
  })
  .openapi('LmbmTraverseData');

export const LmbmGraphQuerySchema = z
  .object({
    entity_type: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).default(200).optional(),
  })
  .openapi('LmbmGraphQuery');

export const LmbmTraverseQuerySchema = z
  .object({
    from: z.string().min(1).openapi({
      param: { name: 'from', in: 'query' },
      description: 'Starting entity id for the traversal.',
    }),
    depth: z.coerce.number().int().positive().max(8).default(4).optional(),
  })
  .openapi('LmbmTraverseQuery');

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export const DocumentUploadSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    customerId: z.string().nullable(),
    documentType: z.string(),
    status: z.string(),
    source: z.string(),
    fileName: z.string(),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.string(),
    fileUrl: z.string(),
    thumbnailUrl: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    metadata: z.record(z.unknown()),
    tags: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  })
  .openapi('DocumentUpload');

export const UploadMetadataSchema = z
  .object({
    fileName: z.string().min(1).max(500),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.string().min(1).max(200),
    documentType: z
      .enum([
        'national_id',
        'passport',
        'driving_license',
        'work_permit',
        'residence_permit',
        'utility_bill',
        'bank_statement',
        'employment_letter',
        'lease_agreement',
        'move_in_report',
        'move_out_report',
        'maintenance_photo',
        'receipt',
        'notice',
        'other',
      ])
      .default('other'),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .openapi('UploadDocumentRequest');

export const DocChatSchema = z
  .object({
    question: z.string().min(1).max(4000),
    language: z.enum(['sw', 'en']).default('sw'),
  })
  .openapi('DocumentChatRequest');

export const SignDocumentSchema = z
  .object({
    fingerprintEventId: z.string().min(1),
    signerRole: z.string().max(120).optional(),
    note: z.string().max(2000).optional(),
  })
  .openapi('SignDocumentRequest');

export const DocumentUploadResultSchema = z
  .object({
    document: DocumentUploadSchema,
    presignedPut: z.string(),
  })
  .openapi('DocumentUploadResult');

export const DocumentChatResultSchema = z
  .object({
    documentId: z.string(),
    question: z.string(),
    language: z.enum(['sw', 'en']),
    answer: z.string().nullable(),
    evidenceIds: z.array(z.string()),
    note: z.string(),
  })
  .openapi('DocumentChatResult');

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export const ReportKindEnum = z
  .enum(['daily', 'weekly', 'monthly', 'investor', 'bank', 'board', 'audit'])
  .openapi('ReportKind');

export const GenerateReportSchema = z
  .object({
    kind: ReportKindEnum,
    asOf: z.string().datetime().optional(),
    siteIds: z.array(z.string()).optional(),
    language: z.enum(['sw', 'en']).default('en'),
    format: z.enum(['html', 'pdf', 'docx']).default('pdf'),
    recipients: z.array(z.string().email()).optional(),
  })
  .openapi('GenerateReportRequest');

export const ReportJobSchema = z
  .object({
    jobId: z.string().uuid(),
    kind: ReportKindEnum,
    tenantId: z.string(),
    requestedBy: z.string(),
    asOf: z.string().datetime(),
    siteIds: z.array(z.string()),
    language: z.enum(['sw', 'en']),
    format: z.enum(['html', 'pdf', 'docx']),
    recipients: z.array(z.string().email()),
    status: z.literal('queued'),
    note: z.string(),
  })
  .openapi('ReportJob');

// ---------------------------------------------------------------------------
// portfolio-map
// ---------------------------------------------------------------------------

export const GeoFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    geometry: z.record(z.unknown()),
    properties: z.record(z.unknown()),
  })
  .openapi('PortfolioMapFeature');

export const PortfolioMapDataSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(GeoFeatureSchema),
    layers: z.object({
      sites: z.number().int().nonnegative(),
      licences: z.number().int().nonnegative(),
      settlements: z.number().int().nonnegative(),
      protectedAreas: z.number().int().nonnegative(),
    }),
  })
  .openapi('PortfolioMapData');

// ---------------------------------------------------------------------------
// buyers / KYC
// ---------------------------------------------------------------------------

export const BuyerKindEnum = z
  .enum(['trader', 'smelter', 'refinery', 'export_buyer', 'bot', 'broker'])
  .openapi('BuyerKind');

export const BuyerSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    companyId: z.string().nullable(),
    kind: BuyerKindEnum,
    country: z.string(),
    licenceNumber: z.string().nullable(),
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    kycStatus: z.string(),
    linkedUserId: z.string().nullable(),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .openapi('Buyer');

export const SubmitKycSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: BuyerKindEnum,
    // UNIV-4: hardcoded launch-beachhead default — defer to tenant's jurisdiction profile; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    country: z.string().length(2).default('TZ'),
    companyId: z.string().optional(),
    licenceNumber: z.string().max(200).optional(),
    nidaId: z.string().min(6).max(40).optional(),
    tin: z.string().min(6).max(40).optional(),
    amlScreenResult: z
      .enum(['clear', 'flagged', 'pending'])
      .default('pending'),
    contactName: z.string().max(200).optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().max(40).optional(),
  })
  .openapi('SubmitKycRequest');

export const KycStatusSchema = z
  .object({
    id: z.string().uuid(),
    kycStatus: z.string(),
    kind: BuyerKindEnum,
    country: z.string(),
    updatedAt: z.string().datetime(),
    attributes: z.record(z.unknown()),
  })
  .openapi('BuyerKycStatus');
