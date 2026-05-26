/**
 * Zod-OpenAPI schemas for `/api/v1/mining/marketplace` — public
 * listings discovery.
 *
 * Listing rows are intentionally loose (`passthrough()`) because the
 * attributes JSON column is open-ended per category (gold-doré,
 * gemstones, services, etc).
 */
import { z } from '@hono/zod-openapi';

export const MarketplaceVisibilityEnum = z
  .enum(['private', 'tanzania', 'regional', 'global'])
  .openapi('MarketplaceVisibility');

export const MarketplaceCategoryEnum = z
  .enum(['ore', 'concentrate', 'service', 'equipment', 'other'])
  .openapi('MarketplaceCategory');

export const MarketplaceListingSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    title: z.string(),
    category: MarketplaceCategoryEnum,
    visibility: MarketplaceVisibilityEnum,
    status: z.string(),
    attributes: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .passthrough()
  .openapi('MarketplaceListing');

export const ListListingsQuerySchema = z
  .object({
    mineral: z.string().optional(),
    region: z.string().optional(),
    grade: z.string().optional(),
    category: MarketplaceCategoryEnum.optional(),
    visibility: MarketplaceVisibilityEnum.optional(),
    limit: z.coerce.number().int().positive().max(200).default(50).optional(),
  })
  .openapi('ListListingsQuery');

export const ListingIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('ListingIdParam');
