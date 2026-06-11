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
    /**
     * Seller-org attribution joined from `tenants`. The buyer surface
     * groups + labels listings by the owning mine ("from <name>").
     * Optional + nullable so older fixtures / non-joined reads still
     * validate under `.passthrough()`.
     */
    sellerTenantId: z.string().optional(),
    sellerName: z.string().nullable().optional(),
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
    /**
     * Owner-scoped browse — restrict results to one seller org's
     * buyer-visible active listings ("buy from this mine"). NEVER
     * bypasses the private rule: a private listing stays owner-only.
     */
    sellerTenantId: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(200).default(50).optional(),
  })
  .openapi('ListListingsQuery');

export const ListingIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' } }),
  })
  .openapi('ListingIdParam');

/**
 * One seller org that has at least one buyer-visible active listing —
 * the data a "browse by mine" surface needs. `listingCount` is the
 * number of those buyer-visible active listings.
 */
export const MarketplaceSellerSchema = z
  .object({
    sellerTenantId: z.string(),
    sellerName: z.string().nullable(),
    listingCount: z.number().int().nonnegative(),
  })
  .openapi('MarketplaceSeller');
