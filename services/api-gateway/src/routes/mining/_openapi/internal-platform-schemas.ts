/**
 * Zod-OpenAPI schemas for the platform-admin internal mining routes:
 *   /internal/{compliance-queue,tenants,corpus,prompts,audit-log}.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// compliance-queue
// ---------------------------------------------------------------------------

export const ComplianceSeverityEnum = z
  .enum(['low', 'medium', 'high', 'critical'])
  .openapi('ComplianceSeverity');

export const ComplianceEscalationSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    severity: ComplianceSeverityEnum,
    escalatedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    resolvedByUserId: z.string().nullable(),
    resolutionDecision: z.string().nullable(),
    evidenceIds: z.array(z.string()).optional(),
  })
  .passthrough()
  .openapi('ComplianceEscalation');

export const ComplianceQueueQuerySchema = z
  .object({
    tenantId: z.string().min(1).max(120).optional(),
    severity: ComplianceSeverityEnum.optional(),
    state: z.enum(['open', 'resolved', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .openapi('ComplianceQueueQuery');

// ---------------------------------------------------------------------------
// tenants
// ---------------------------------------------------------------------------

export const TenantPlanEnum = z
  .enum(['mwanzo', 'mkulima', 'mfanyabiashara', 'kampuni', 'group'])
  .openapi('TenantPlan');

export const TenantTierEnum = z
  .enum(['starter', 'professional', 'enterprise', 'custom'])
  .openapi('TenantSubscriptionTier');

export const TenantRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    subscriptionTier: TenantTierEnum,
    plan: TenantPlanEnum,
    primaryEmail: z.string(),
    primaryPhone: z.string().nullable(),
    country: z.string(),
    region: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  })
  .passthrough()
  .openapi('TenantRow');

export const ProvisionTenantSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9-]+$/),
    primaryEmail: z.string().email(),
    primaryPhone: z.string().max(40).optional(),
    // UNIV-4: hardcoded launch-beachhead default — defer to jurisdiction profile of the requesting platform operator; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    country: z.string().length(2).default('TZ'),
    plan: TenantPlanEnum.default('mkulima'),
    subscriptionTier: TenantTierEnum.default('starter'),
    region: z.string().optional(),
  })
  .openapi('ProvisionTenantRequest');

export const PatchTenantSchema = z
  .object({
    plan: TenantPlanEnum.optional(),
    subscriptionTier: TenantTierEnum.optional(),
    billingSettings: z.record(z.unknown()).optional(),
    maxUsers: z.number().int().nonnegative().optional(),
    maxProperties: z.number().int().nonnegative().optional(),
    maxUnits: z.number().int().nonnegative().optional(),
  })
  .openapi('PatchTenantRequest');

// ---------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------

export const CorpusChunkSchema = z
  .object({
    id: z.string(),
    tenantId: z.string().nullable(),
    sourceFile: z.string(),
    section: z.string().nullable(),
    page: z.number().int().nullable(),
    text: z.string(),
    url: z.string().nullable(),
    language: z.string(),
    metadata: z.record(z.unknown()),
    supersededById: z.string().nullable(),
    ingestedAt: z.string().datetime(),
  })
  .passthrough()
  .openapi('CorpusChunk');

export const CorpusVersionSchema = z
  .object({
    id: z.string(),
    sourceFile: z.string(),
    section: z.string().nullable(),
    page: z.number().int().nullable(),
    language: z.string(),
    url: z.string().nullable(),
    supersededById: z.string().nullable(),
    ingestedAt: z.string().datetime(),
  })
  .openapi('CorpusVersion');

export const UploadCorpusSchema = z
  .object({
    sourceFile: z.string().min(1).max(500),
    section: z.string().max(200).optional(),
    page: z.number().int().nonnegative().optional(),
    text: z.string().min(1),
    url: z.string().url().optional(),
    language: z.enum(['en', 'sw', 'fr', 'zh', 'pt']).default('en'),
    metadata: z.record(z.unknown()).optional(),
    embedding: z.array(z.number()).length(1024).optional(),
  })
  .openapi('UploadCorpusRequest');

export const SupersedeCorpusSchema = z
  .object({
    oldChunkId: z.string().min(1),
    newChunkId: z.string().min(1),
  })
  .openapi('SupersedeCorpusRequest');

export const CorpusVersionsQuerySchema = z
  .object({
    source_file: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).default(200).optional(),
  })
  .openapi('CorpusVersionsQuery');

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

export const PromptRegistryRowSchema = z
  .object({
    id: z.string(),
    capability: z.string(),
    version: z.string(),
    status: z.string(),
    promotedAt: z.string().datetime().nullable(),
    promotedBy: z.string().nullable(),
  })
  .passthrough()
  .openapi('PromptRegistryRow');

export const PromotePromptSchema = z
  .object({
    capability: z.string().min(1).max(200),
    version: z.string().min(1).max(80),
  })
  .openapi('PromotePromptRequest');

export const PromptListQuerySchema = z
  .object({
    capability: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).default(200).optional(),
  })
  .openapi('PromptListQuery');

// ---------------------------------------------------------------------------
// audit-log
// ---------------------------------------------------------------------------

export const WormAuditRowSchema = z
  .object({
    id: z.string(),
    tenantId: z.string().nullable(),
    actorId: z.string().nullable(),
    action: z.string(),
    sequenceNumber: z.number().int(),
    hash: z.string().nullable(),
    timestamp: z.string().datetime(),
  })
  .passthrough()
  .openapi('WormAuditRow');

export const AuditLogQuerySchema = z
  .object({
    tenantId: z.string().optional(),
    junior: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().max(200).default(50).optional(),
  })
  .openapi('AuditLogQuery');
