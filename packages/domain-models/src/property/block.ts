/**
 * Block domain model
 * Logical grouping of units within a mining site (e.g., "Block A",
 * "North Pit", "Plant 1"). A block aggregates the production /
 * capacity counts of the units it contains.
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable } from '../common/types';

export type BlockId = Brand<string, 'BlockId'>;

export function asBlockId(id: string): BlockId {
  return id as BlockId;
}

/** Block status */
export type BlockStatus = 'active' | 'inactive' | 'under_development' | 'rehabilitating' | 'closed_out';

/**
 * Block entity
 * Represents a logical grouping of units within a mining site
 */
export interface Block extends EntityMetadata, SoftDeletable {
  readonly id: BlockId;
  readonly tenantId: TenantId;
  readonly siteId: string;

  // Identity
  readonly blockCode: string;
  readonly name: string;
  readonly description: string | null;

  // Status
  readonly status: BlockStatus;

  // Location
  readonly level: number | null;
  readonly zone: string | null;

  // Capacity
  readonly totalUnits: number;
  readonly activeUnits: number;
  readonly idleUnits: number;

  // Features
  readonly amenities: readonly string[];
  readonly features: Record<string, unknown>;
  readonly hasHaulRoad: boolean;
  readonly hasWeighbridge: boolean;
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
    siteId: string;
    blockCode: string;
    name: string;
    description?: string;
    level?: number;
    zone?: string;
    amenities?: string[];
    features?: Record<string, unknown>;
    hasHaulRoad?: boolean;
    hasWeighbridge?: boolean;
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
    siteId: data.siteId,
    blockCode: data.blockCode,
    name: data.name,
    description: data.description ?? null,
    status: 'active',
    level: data.level ?? null,
    zone: data.zone ?? null,
    totalUnits: 0,
    activeUnits: 0,
    idleUnits: 0,
    amenities: data.amenities ?? [],
    features: data.features ?? {},
    hasHaulRoad: data.hasHaulRoad ?? false,
    hasWeighbridge: data.hasWeighbridge ?? false,
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
  activeUnits: number,
  updatedBy: UserId
): Block {
  return {
    ...block,
    totalUnits,
    activeUnits,
    idleUnits: totalUnits - activeUnits,
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
export function generateBlockCode(siteCode: string, sequence: number): string {
  return `${siteCode}-BLK-${String(sequence).padStart(2, '0')}`;
}

/** Calculate block production / asset-utilisation rate. */
export function calculateUtilisationRate(block: Block): number {
  if (block.totalUnits === 0) return 0;
  return Math.round((block.activeUnits / block.totalUnits) * 100);
}

/** @deprecated Use {@link calculateUtilisationRate}. */
export const calculateOccupancyRate = calculateUtilisationRate;
