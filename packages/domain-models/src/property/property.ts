/**
 * Mining-site domain model
 * Represents a physical mining site / estate location in the system
 * (e.g. a Geita pit, a Lake-Zone alluvial block, a Nachingwea graphite
 * concession). A site groups the blocks, units (sub-tenements), and
 * assets that make up an owner's operating footprint.
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { GeoNodeId } from '../geo';

export type MiningSiteId = Brand<string, 'MiningSiteId'>;
export type OwnerId = Brand<string, 'OwnerId'>;

/**
 * @deprecated Use {@link MiningSiteId}. Retained as a transitional alias
 * while downstream importers migrate (W-E phase).
 */
export type PropertyId = MiningSiteId;

export function asMiningSiteId(id: string): MiningSiteId {
  return id as MiningSiteId;
}

/**
 * @deprecated Use {@link asMiningSiteId}.
 */
export const asPropertyId = asMiningSiteId;

export function asOwnerId(id: string): OwnerId {
  return id as OwnerId;
}

/** Mining-site type — what kind of operating footprint the site is. */
export type MiningSiteType =
  | 'open_pit'
  | 'underground'
  | 'alluvial_placer'
  | 'processing_plant'
  | 'tailings_storage'
  | 'exploration';

/** @deprecated Use {@link MiningSiteType}. */
export type PropertyType = MiningSiteType;

/** Mining-site status */
export type MiningSiteStatus = 'active' | 'inactive' | 'under_development' | 'closed_out';

/** @deprecated Use {@link MiningSiteStatus}. */
export type PropertyStatus = MiningSiteStatus;

/** Address structure */
export interface Address {
  readonly street: string;
  readonly city: string;
  readonly county: string;
  readonly postalCode: string | null;
  readonly country: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/**
 * Mining-site entity
 */
export interface MiningSite extends EntityMetadata, SoftDeletable {
  readonly id: MiningSiteId;
  readonly tenantId: TenantId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly code: string; // Internal reference code
  readonly type: MiningSiteType;
  readonly status: MiningSiteStatus;
  readonly address: Address;
  /** Total sub-tenements / operating units registered against the site. */
  readonly totalUnits: number;
  /** Units currently in production. */
  readonly activeUnits: number;
  /** Units with spare capacity not yet in production. */
  readonly idleUnits: number;
  readonly yearEstablished: number | null;
  readonly totalArea: number | null; // In square meters (concession footprint)
  readonly amenities: readonly string[];
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly managerId: UserId | null; // Assigned site / estate manager
  /** Deepest node in the per-org elastic geo-hierarchy this site belongs to.
   *  Optional; `undefined` until an admin classifies the site. See
   *  `packages/domain-models/src/geo/geo-node.ts`. */
  readonly geoNodeId?: GeoNodeId;
  /** Canonical pin (GPS). Takes precedence over `address.lat/lng`
   *  for map rendering and point-in-polygon classification. */
  readonly pin?: { readonly lat: number; readonly lng: number };
}

/** @deprecated Use {@link MiningSite}. */
export type Property = MiningSite;

/** Create a new mining site */
export function createMiningSite(
  id: MiningSiteId,
  data: {
    tenantId: TenantId;
    ownerId: OwnerId;
    name: string;
    code: string;
    type: MiningSiteType;
    address: Address;
    totalUnits?: number;
    yearEstablished?: number;
    totalArea?: number;
    amenities?: string[];
    description?: string;
    managerId?: UserId;
  },
  createdBy: UserId
): MiningSite {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    ownerId: data.ownerId,
    name: data.name,
    code: data.code,
    type: data.type,
    status: 'active',
    address: data.address,
    totalUnits: data.totalUnits ?? 0,
    activeUnits: 0,
    idleUnits: data.totalUnits ?? 0,
    yearEstablished: data.yearEstablished ?? null,
    totalArea: data.totalArea ?? null,
    amenities: data.amenities ?? [],
    description: data.description ?? null,
    imageUrls: [],
    managerId: data.managerId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** @deprecated Use {@link createMiningSite}. */
export const createProperty = createMiningSite;

/** Calculate production / asset-utilisation rate (% of units in production). */
export function calculateUtilisationRate(site: MiningSite): number {
  if (site.totalUnits === 0) return 0;
  return (site.activeUnits / site.totalUnits) * 100;
}

/** @deprecated Use {@link calculateUtilisationRate}. */
export const calculateOccupancyRate = calculateUtilisationRate;

/** Update unit counts (active units in production vs idle capacity). */
export function updateUnitCounts(
  site: MiningSite,
  activeUnits: number,
  updatedBy: UserId
): MiningSite {
  return {
    ...site,
    activeUnits,
    idleUnits: site.totalUnits - activeUnits,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Assign manager to mining site */
export function assignManager(
  site: MiningSite,
  managerId: UserId,
  updatedBy: UserId
): MiningSite {
  return {
    ...site,
    managerId,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}
