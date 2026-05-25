/**
 * Block domain model
 * Logical grouping of units within a property (e.g., "Block A", "Building 1")
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';

export type BlockId = Brand<string, 'BlockId'>;

export function asBlockId(id: string): BlockId {
  return id as BlockId;
}

/** Block status */
export type BlockStatus = 'active' | 'inactive' | 'under_construction' | 'under_renovation' | 'demolished';

/**
 * Block entity
 * Represents a logical grouping of units within a property
 */
export interface Block extends EntityMetadata, SoftDeletable {
  readonly id: BlockId;
  readonly tenantId: TenantId;
  readonly propertyId: string;
  
  // Identity
  readonly blockCode: string;
  readonly name: string;
  readonly description: string | null;
  
  // Status
  readonly status: BlockStatus;
  
  // Location
  readonly floor: number | null;
  readonly wing: string | null;
  
  // Capacity
  readonly totalUnits: number;
  readonly occupiedUnits: number;
  readonly vacantUnits: number;
  
  // Features
  readonly amenities: readonly string[];
  readonly features: Record<string, unknown>;
  readonly hasElevator: boolean;
  readonly hasParking: boolean;
  readonly hasSecurity: boolean;
  
  // Management
  readonly managerId: string | null;
  
  // Media
  readonly images: readonly string[];
  
  // Display
  readonly sortOrder: number;
}

/** Create a new block */
export function createBlock(
  id: BlockId,
  data: {
    tenantId: TenantId;
    propertyId: string;
    blockCode: string;
    name: string;
    description?: string;
    floor?: number;
    wing?: string;
    amenities?: string[];
    features?: Record<string, unknown>;
    hasElevator?: boolean;
    hasParking?: boolean;
    hasSecurity?: boolean;
    managerId?: string;
    sortOrder?: number;
  },
  createdBy: UserId
): Block {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId,
    blockCode: data.blockCode,
    name: data.name,
    description: data.description ?? null,
    status: 'active',
    floor: data.floor ?? null,
    wing: data.wing ?? null,
    totalUnits: 0,
    occupiedUnits: 0,
    vacantUnits: 0,
    amenities: data.amenities ?? [],
    features: data.features ?? {},
    hasElevator: data.hasElevator ?? false,
    hasParking: data.hasParking ?? false,
    hasSecurity: data.hasSecurity ?? false,
    managerId: data.managerId ?? null,
    images: [],
    sortOrder: data.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Update block unit counts */
export function updateBlockUnitCounts(
  block: Block,
  totalUnits: number,
  occupiedUnits: number,
  updatedBy: UserId
): Block {
  return {
    ...block,
    totalUnits,
    occupiedUnits,
    vacantUnits: totalUnits - occupiedUnits,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Change block status */
export function changeBlockStatus(
  block: Block,
  status: BlockStatus,
  updatedBy: UserId
): Block {
  return {
    ...block,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Generate block code */
export function generateBlockCode(propertyCode: string, sequence: number): string {
  return `${propertyCode}-BLK-${String(sequence).padStart(2, '0')}`;
}

/** Calculate block occupancy rate */
export function calculateOccupancyRate(block: Block): number {
  if (block.totalUnits === 0) return 0;
  return Math.round((block.occupiedUnits / block.totalUnits) * 100);
}
