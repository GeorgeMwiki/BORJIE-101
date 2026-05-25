/**
 * Property domain model
 * Represents a physical property in the system
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { GeoNodeId } from '../geo';

export type PropertyId = Brand<string, 'PropertyId'>;
export type OwnerId = Brand<string, 'OwnerId'>;

export function asPropertyId(id: string): PropertyId {
  return id as PropertyId;
}

export function asOwnerId(id: string): OwnerId {
  return id as OwnerId;
}

/** Property type */
export type PropertyType =
  | 'residential_apartment'
  | 'residential_house'
  | 'commercial_office'
  | 'commercial_retail'
  | 'mixed_use'
  | 'land';

/** Property status */
export type PropertyStatus = 'active' | 'inactive' | 'under_construction' | 'sold';

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
 * Property entity
 */
export interface Property extends EntityMetadata, SoftDeletable {
  readonly id: PropertyId;
  readonly tenantId: TenantId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly code: string; // Internal reference code
  readonly type: PropertyType;
  readonly status: PropertyStatus;
  readonly address: Address;
  readonly totalUnits: number;
  readonly occupiedUnits: number;
  readonly vacantUnits: number;
  readonly yearBuilt: number | null;
  readonly totalArea: number | null; // In square meters
  readonly amenities: readonly string[];
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly managerId: UserId | null; // Assigned estate manager
  /** Deepest node in the per-org elastic geo-hierarchy this property belongs to.
   *  Optional; `undefined` until an admin classifies the property. See
   *  `packages/domain-models/src/geo/geo-node.ts`. */
  readonly geoNodeId?: GeoNodeId;
  /** Canonical street-level pin (GPS). Takes precedence over `address.lat/lng`
   *  for map rendering and point-in-polygon classification. */
  readonly pin?: { readonly lat: number; readonly lng: number };
}

/** Create a new property */
export function createProperty(
  id: PropertyId,
  data: {
    tenantId: TenantId;
    ownerId: OwnerId;
    name: string;
    code: string;
    type: PropertyType;
    address: Address;
    totalUnits?: number;
    yearBuilt?: number;
    totalArea?: number;
    amenities?: string[];
    description?: string;
    managerId?: UserId;
  },
  createdBy: UserId
): Property {
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
    occupiedUnits: 0,
    vacantUnits: data.totalUnits ?? 0,
    yearBuilt: data.yearBuilt ?? null,
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

/** Calculate occupancy rate */
export function calculateOccupancyRate(property: Property): number {
  if (property.totalUnits === 0) return 0;
  return (property.occupiedUnits / property.totalUnits) * 100;
}

/** Update unit counts */
export function updateUnitCounts(
  property: Property,
  occupiedUnits: number,
  updatedBy: UserId
): Property {
  return {
    ...property,
    occupiedUnits,
    vacantUnits: property.totalUnits - occupiedUnits,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Assign manager to property */
export function assignManager(
  property: Property,
  managerId: UserId,
  updatedBy: UserId
): Property {
  return {
    ...property,
    managerId,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}
