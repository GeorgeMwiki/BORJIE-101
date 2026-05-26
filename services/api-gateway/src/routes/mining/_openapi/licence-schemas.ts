/**
 * Zod-OpenAPI schemas for `/api/v1/mining/licences` — TZ mining
 * licences and licence-events.
 *
 * Mirrors the inline schemas in `licences.hono.ts`. Status / kind
 * enums match the database `licence_kind` and `licence_status` enums.
 */
import { z } from '@hono/zod-openapi';

export const LicenceKindEnum = z
  .enum([
    'PL',
    'PML',
    'ML',
    'SML',
    'DEALER',
    'BROKER',
    'PROCESSING',
    'SMELTING',
    'REFINING',
  ])
  .openapi('LicenceKind');

export const LicenceStatusEnum = z
  .enum(['active', 'expired', 'revoked', 'pending', 'suspended'])
  .openapi('LicenceStatus');

export const LicenceSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    companyId: z.string(),
    kind: LicenceKindEnum,
    number: z.string(),
    mineral: z.string(),
    holderUserId: z.string().nullable(),
    grantDate: z.string().nullable(),
    expiryDate: z.string().nullable(),
    areaHa: z.string().nullable(),
    polygon: z.string().nullable(),
    status: LicenceStatusEnum,
    dormancyScore: z.number().int().nullable().optional(),
    fees: z.record(z.unknown()),
    obligations: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Licence');

export const LicenceEventSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    licenceId: z.string().uuid(),
    kind: z.string(),
    summary: z.string().nullable(),
    dueDate: z.string().nullable(),
    status: z.string(),
    payload: z.record(z.unknown()).nullable(),
    evidenceIds: z.array(z.string()),
    createdAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
  })
  .openapi('LicenceEvent');

export const CreateLicenceSchema = z
  .object({
    companyId: z.string().min(1),
    kind: LicenceKindEnum,
    number: z.string().min(1).max(120),
    mineral: z.string().min(1).max(80),
    holderUserId: z.string().optional(),
    grantDate: z.string().optional(),
    expiryDate: z.string().optional(),
    areaHa: z.string().optional(),
    polygon: z.string().optional(),
    fees: z.record(z.unknown()).optional(),
    obligations: z.record(z.unknown()).optional(),
  })
  .openapi('CreateLicenceRequest');

export const RenewLicenceSchema = z
  .object({
    newExpiryDate: z.string().min(8),
    feePaidTzs: z.number().int().nonnegative().optional(),
    referenceNo: z.string().optional(),
    evidenceIds: z.array(z.string()).optional(),
    summary: z.string().max(2000).optional(),
  })
  .openapi('RenewLicenceRequest');

export const ListLicencesQuerySchema = z
  .object({
    kind: LicenceKindEnum.optional(),
    status: LicenceStatusEnum.optional(),
    mineral: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListLicencesQuery');

export const LicenceIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('LicenceIdParam');
