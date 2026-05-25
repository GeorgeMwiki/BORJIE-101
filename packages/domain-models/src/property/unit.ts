/**
 * Unit domain model
 * Represents a rentable unit within a property
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { Money } from '../common/money';
import type { PropertyId } from './property';

export type UnitId = Brand<string, 'UnitId'>;

export function asUnitId(id: string): UnitId {
  return id as UnitId;
}

/** Unit type */
export type UnitType =
  | 'studio'
  | 'one_bedroom'
  | 'two_bedroom'
  | 'three_bedroom'
  | 'four_bedroom_plus'
  | 'penthouse'
  | 'office'
  | 'retail'
  | 'warehouse';

/** Unit status */
export type UnitStatus =
  | 'vacant'
  | 'occupied'
  | 'reserved'
  | 'under_maintenance'
  | 'not_available';

/**
 * Unit entity
 */
export interface Unit extends EntityMetadata, SoftDeletable {
  readonly id: UnitId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitNumber: string; // e.g., "A101"
  readonly floor: number;
  readonly type: UnitType;
  readonly status: UnitStatus;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly area: number | null; // Square meters
  readonly monthlyRent: Money;
  readonly depositAmount: Money;
  readonly amenities: readonly string[];
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly lastInspectionDate: ISOTimestamp | null;
  readonly nextInspectionDue: ISOTimestamp | null;
}

/** Create a new unit */
export function createUnit(
  id: UnitId,
  data: {
    tenantId: TenantId;
    propertyId: PropertyId;
    unitNumber: string;
    floor: number;
    type: UnitType;
    bedrooms: number;
    bathrooms: number;
    monthlyRent: Money;
    depositAmount: Money;
    area?: number;
    amenities?: string[];
    description?: string;
  },
  createdBy: UserId
): Unit {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId,
    unitNumber: data.unitNumber,
    floor: data.floor,
    type: data.type,
    status: 'vacant',
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    area: data.area ?? null,
    monthlyRent: data.monthlyRent,
    depositAmount: data.depositAmount,
    amenities: data.amenities ?? [],
    description: data.description ?? null,
    imageUrls: [],
    lastInspectionDate: null,
    nextInspectionDue: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Update unit status */
export function updateUnitStatus(
  unit: Unit,
  status: UnitStatus,
  updatedBy: UserId
): Unit {
  return {
    ...unit,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Record inspection */
export function recordInspection(
  unit: Unit,
  inspectionDate: ISOTimestamp,
  nextDueDate: ISOTimestamp,
  updatedBy: UserId
): Unit {
  return {
    ...unit,
    lastInspectionDate: inspectionDate,
    nextInspectionDue: nextDueDate,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Check if inspection is overdue */
export function isInspectionOverdue(unit: Unit): boolean {
  if (!unit.nextInspectionDue) return false;
  return new Date(unit.nextInspectionDue) < new Date();
}

/** Update rent amount */
export function updateRent(
  unit: Unit,
  newRent: Money,
  updatedBy: UserId
): Unit {
  return {
    ...unit,
    monthlyRent: newRent,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}
