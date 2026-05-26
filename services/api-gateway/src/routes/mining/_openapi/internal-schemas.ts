/**
 * Zod-OpenAPI schemas for SUPER_ADMIN-only mining internal routes:
 *   /internal/{decision-log,slo,killswitch,promotions,regulator-pipeline,
 *             citations,compliance-queue,tenants,corpus,prompts,audit-log}.
 */
import { z } from '@hono/zod-openapi';

// ---------------------------------------------------------------------------
// shared param schemas
// ---------------------------------------------------------------------------

export const InternalIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('InternalIdParam');

// ---------------------------------------------------------------------------
// decision-log
// ---------------------------------------------------------------------------

export const DecisionTraceRowSchema = z
  .object({
    id: z.string(),
    at: z.string().datetime().nullable(),
    tenantId: z.string().nullable(),
    name: z.string(),
    outcome: z.string(),
    chosenBranchId: z.string().nullable(),
    chosenRationale: z.string().nullable(),
    branches: z.unknown(),
    attributes: z.unknown(),
    durationMs: z.number().int().nullable(),
  })
  .openapi('DecisionTraceRow');

export const DecisionLogQuerySchema = z
  .object({
    tenantId: z.string().min(1).max(120).optional(),
    junior: z.string().min(1).max(200).optional(),
    outcome: z
      .enum(['approved', 'rejected', 'executed', 'refused', 'failed'])
      .optional(),
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .openapi('DecisionLogQuery');

// ---------------------------------------------------------------------------
// slo
// ---------------------------------------------------------------------------

export const SloRowSchema = z
  .object({
    tenantId: z.string().nullable(),
    junior: z.string(),
    juniorId: z.string(),
    p50ms: z.number(),
    p95ms: z.number(),
    p99ms: z.number(),
    errorRatePct: z.number(),
    spendUsd: z.number(),
    requestVolume24h: z.number().int(),
  })
  .openapi('SloRow');

export const SloQuerySchema = z
  .object({
    tenantId: z.string().min(1).max(120).optional(),
    junior: z.string().min(1).max(200).optional(),
    windowHours: z.coerce.number().int().min(1).max(168).default(24),
  })
  .openapi('SloQuery');

// ---------------------------------------------------------------------------
// killswitch
// ---------------------------------------------------------------------------

export const KillswitchLevelEnum = z
  .enum(['live', 'degraded', 'halt'])
  .openapi('KillswitchLevel');

export const KillswitchTargetSchema = z
  .object({
    scope: z.string(),
    level: KillswitchLevelEnum,
    reasonCode: z.string(),
    note: z.string().optional(),
  })
  .openapi('KillswitchTarget');

export const KillswitchInitiateSchema = z
  .object({
    scope: z
      .string()
      .min(1)
      .max(120)
      .refine((s) => s === 'platform' || s.startsWith('tenant:'), {
        message: 'Scope must be "platform" or "tenant:<tenantId>"',
      }),
    level: KillswitchLevelEnum,
    reasonCode: z.string().min(1).max(200),
    note: z.string().max(500).optional(),
  })
  .openapi('KillswitchInitiateRequest');

export const KillswitchPendingSchema = z
  .object({
    pendingConfirmationId: z.string(),
    target: KillswitchTargetSchema,
    expiresAt: z.string().datetime(),
    waitingForSecondOperator: z.literal(true),
  })
  .openapi('KillswitchPending');

export const KillswitchStateRowSchema = z
  .object({
    scope: z.string(),
    level: KillswitchLevelEnum,
    reasonCode: z.string().nullable(),
    note: z.string().nullable(),
    setBy: z.string().nullable(),
    setAt: z.string().datetime(),
  })
  .passthrough()
  .openapi('KillswitchStateRow');

export const KillswitchPendingRowSchema = z
  .object({
    id: z.string(),
    killswitchTarget: z.unknown(),
    initiatorUserId: z.string(),
    initiatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    confirmedByUserId: z.string().nullable(),
  })
  .openapi('KillswitchPendingRow');

export const KillswitchListQuerySchema = z
  .object({
    scope: z.string().min(1).max(120).optional(),
    tenantId: z.string().min(1).max(120).optional(),
    level: KillswitchLevelEnum.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .openapi('KillswitchListQuery');

// ---------------------------------------------------------------------------
// promotions
// ---------------------------------------------------------------------------

export const PromotionKindEnum = z
  .enum(['prompt', 'model', 'corpus'])
  .openapi('PromotionKind');

export const PromotionRowSchema = z
  .object({
    id: z.string(),
    kind: PromotionKindEnum,
    subject: z.string(),
    fromVersion: z.string().nullable(),
    toVersion: z.string(),
    promotedAt: z.string().datetime(),
    promotedBy: z.string().nullable(),
    revertedAt: z.string().datetime().nullable(),
    revertedBy: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .passthrough()
  .openapi('PromotionRow');

export const PromotionQuerySchema = z
  .object({
    kind: PromotionKindEnum.optional(),
    subject: z.string().min(1).max(200).optional(),
    since: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .openapi('PromotionQuery');

// ---------------------------------------------------------------------------
// regulator-pipeline
// ---------------------------------------------------------------------------

export const RegulatorSourceEnum = z
  .enum(['gazette', 'nemc', 'bot', 'tra', 'tumemadini'])
  .openapi('RegulatorSource');

export const RegulatorStageEnum = z
  .enum(['incoming', 'reviewing', 'approved', 'pushed'])
  .openapi('RegulatorStage');

export const RegulatorEntrySchema = z
  .object({
    id: z.string(),
    source: RegulatorSourceEnum,
    title: z.string().nullable(),
    capturedAt: z.string().datetime(),
    status: RegulatorStageEnum,
    reviewedAt: z.string().datetime().nullable(),
    reviewedByUserId: z.string().nullable(),
    pushedToCorpusAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime().nullable(),
  })
  .passthrough()
  .openapi('RegulatorPipelineEntry');

export const RegulatorListQuerySchema = z
  .object({
    source: RegulatorSourceEnum.optional(),
    status: RegulatorStageEnum.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .openapi('RegulatorListQuery');

export const RegulatorMoveSchema = z
  .object({ stage: RegulatorStageEnum })
  .openapi('RegulatorMoveRequest');

// ---------------------------------------------------------------------------
// citations
// ---------------------------------------------------------------------------

export const CitationSourceEnum = z
  .enum(['gazette', 'nemc', 'bot', 'tra', 'tumemadini', 'tmaa'])
  .openapi('CitationSource');

export const CitationRowSchema = z
  .object({
    id: z.string(),
    sourceFile: z.string().nullable(),
    section: z.string().nullable(),
    page: z.number().int().nullable(),
    text: z.string(),
    url: z.string().nullable(),
    language: z.string(),
    metadata: z.record(z.unknown()),
    ingestedAt: z.string().datetime(),
  })
  .openapi('CitationRow');

export const CitationQuerySchema = z
  .object({
    source: CitationSourceEnum.optional(),
    q: z.string().min(1).max(200).optional(),
    language: z.enum(['en', 'sw', 'fr', 'zh', 'pt']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .openapi('CitationQuery');
