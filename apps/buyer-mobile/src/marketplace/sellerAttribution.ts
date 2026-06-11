import type { Listing } from '@/types/listing'

/**
 * Resolve the owning-mine display name for a listing.
 *
 * Prefers the real gateway attribution (`sellerName`, joined from
 * `tenants.name`); falls back to the rich `seller.name` carried by chat /
 * fixture payloads; finally to a caller-supplied placeholder so the buyer
 * surface never renders an empty "from " label. Pure + immutable.
 */
export function resolveSellerName(
  listing: Pick<Listing, 'sellerName' | 'seller'>,
  fallback: string
): string {
  if (listing.sellerName && listing.sellerName.length > 0) {
    return listing.sellerName
  }
  if (listing.seller?.name && listing.seller.name.length > 0) {
    return listing.seller.name
  }
  return fallback
}
