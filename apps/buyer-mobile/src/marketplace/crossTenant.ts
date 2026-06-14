import type { Listing } from '@/types/listing'

/**
 * KI-006 — cross-tenant marketplace loop.
 *
 * The marketplace is PUBLIC-READ across tenants (a buyer browses every
 * org's active public listings), but `place-bid` is INTRA-tenant: the
 * gateway `POST /mining/bids` scopes the write to the buyer's own tenant,
 * so a bid on another org's listing 404s. The honest interim (option b) is
 * to HIDE the place-bid CTA on a cross-tenant listing and offer the built
 * cross-tenant mechanism instead — an inquiry ("Ask the seller").
 *
 * FAIL-CLOSED: we only treat a listing as biddable when we can POSITIVELY
 * confirm its seller tenant equals the buyer's own tenant. If either side
 * is unknown (older fixture without `sellerTenantId`, or a session whose
 * JWT carried no `tenant_id` claim) we DEFAULT to cross-tenant — that
 * routes the buyer to the inquiry path that always works, never to a bid
 * that would silently 404.
 *
 * Pure + immutable so it is unit-testable under the node vitest harness
 * (no react-native / expo imports).
 */
export function isCrossTenantListing(
  listing: Pick<Listing, 'sellerTenantId'>,
  buyerTenantId: string | null | undefined,
): boolean {
  const sellerTenantId = listing.sellerTenantId
  // Unknown on either side → fail-closed to cross-tenant (inquiry path).
  if (!sellerTenantId || sellerTenantId.length === 0) {
    return true
  }
  if (!buyerTenantId || buyerTenantId.length === 0) {
    return true
  }
  return sellerTenantId !== buyerTenantId
}
