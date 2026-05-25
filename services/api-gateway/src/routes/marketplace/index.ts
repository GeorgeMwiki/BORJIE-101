/**
 * Public surface for the universal-marketplace router family.
 *
 * The api-gateway `index.ts` should mount this at
 * `/marketplace-universal` (the legacy org-side `marketplaceRouter`
 * already occupies `/marketplace`).
 *
 *   GET  /v1/marketplace-universal/orgs
 *   GET  /v1/marketplace-universal/orgs/:orgId
 *   GET  /v1/marketplace-universal/listings
 *   GET  /v1/marketplace-universal/listings/:listingId
 *   GET  /v1/marketplace-universal/tenders
 *   POST /v1/marketplace-universal/listings/:listingId/inquiries
 *   POST /v1/marketplace-universal/listings/:listingId/applications
 *   POST /v1/marketplace-universal/join-org
 *   GET  /v1/marketplace-universal/me/orgs
 */

export {
  universalMarketplaceRouter,
  createMarketplaceRouter,
  __defaultStoreForTests,
  type MarketplaceRouterDeps,
} from './marketplace.router.js';
export type {
  ApiEnvelope,
  ApplicationRecord,
  InquiryRecord,
  JoinCodeRedemption,
  ListingsFilters,
  ListingsPage,
  MarketplaceDataPort,
  MarketplaceListing,
  MarketplaceListingDetail,
  OrgMembership,
  OrgProfile,
  OrgSummary,
  TenderSummary,
} from './types.js';
export {
  createSeededStore,
  inMemoryDataPort,
  listMembershipsForUser,
  type InMemoryStore,
} from './in-memory-data-port.js';
