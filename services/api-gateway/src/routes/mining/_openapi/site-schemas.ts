/**
 * Zod-OpenAPI schemas for `/api/v1/mining/sites` request + response shapes.
 *
 * Mirrors the runtime schemas declared inline in `sites.hono.ts`. Kept
 * separate so the generator can emit named components without coupling
 * the route handlers to OpenAPI machinery beyond the `createRoute` call.
 */
import { z } from '@hono/zod-openapi';

export const SitePhaseEnum = z
  .enum([
    'pre_licence',
    'exploration',
    'access_prep',
    'sampling',
    'trenching',
    'shafting',
    'vein_search',
    'confirmation',
    'expansion',
    'extraction',
    'sorting',
    'processing',
    'transport',
    'sale',
    'rehab',
    'renewal_conversion',
  ])
  .openapi('SitePhase');

export const SiteStatusEnum = z
  .enum(['active', 'paused', 'abandoned', 'under_rehab'])
  .openapi('SiteStatus');

export const SiteSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    licenceId: z.string().uuid(),
    name: z.string(),
    mineral: z.string(),
    location: z.string().nullable(),
    polygon: z.string().nullable(),
    phase: SitePhaseEnum,
    managerUserId: z.string().nullable(),
    status: SiteStatusEnum,
    geologyConfidence: z.string().nullable().optional(),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Site');

export const CreateSiteSchema = z
  .object({
    licenceId: z.string().min(1),
    name: z.string().min(1).max(200),
    mineral: z.string().min(1).max(80),
    location: z.string().optional(),
    polygon: z.string().optional(),
    phase: SitePhaseEnum.default('pre_licence'),
    managerUserId: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('CreateSiteRequest');

export const UpdateSiteSchema = z
  .object({
    name: z.string().optional(),
    mineral: z.string().optional(),
    location: z.string().optional(),
    polygon: z.string().optional(),
    phase: SitePhaseEnum.optional(),
    managerUserId: z.string().optional(),
    geologyConfidence: z.string().optional(),
    status: SiteStatusEnum.optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .openapi('UpdateSiteRequest');

export const ListSitesQuerySchema = z
  .object({
    licenceId: z.string().optional(),
    phase: SitePhaseEnum.optional(),
    status: SiteStatusEnum.optional(),
    limit: z.coerce.number().int().positive().max(500).default(100).optional(),
  })
  .openapi('ListSitesQuery');

export const SiteIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('SiteIdParam');
