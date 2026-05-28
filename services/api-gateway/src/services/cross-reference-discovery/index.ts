/**
 * Cross-Reference Discovery — barrel export.
 *
 * Companion to:
 *   - packages/database/src/migrations/0115_entity_index.sql
 *   - services/api-gateway/src/workers/entity-indexer-worker.ts
 *   - Docs/DESIGN/ENTITY_LEGIBILITY_INDEX.md §4
 *
 * Pure-function discoverers per entity_kind. The worker dispatches an
 * upsert into `entity_cross_references` for every edge returned.
 */

export type { DiscoveredEdge, Discoverer, DiscovererDb } from './types';
export {
  DISCOVERERS,
  discoverEdges,
  discoverForRoyaltyDraft,
  discoverForLicence,
  discoverForSite,
  discoverForIncident,
  discoverForReminder,
  discoverForDrillHole,
  discoverForParcel,
  discoverForBid,
  discoverForCertification,
} from './discoverer';
