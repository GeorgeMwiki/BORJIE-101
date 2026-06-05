/**
 * Mining-unit domain model
 * Represents an operating unit / sub-tenement within a mining site
 * (e.g. a pit bench, an alluvial claim, a processing line). Units are
 * the granular footprint a site's production is tracked against.
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { Money } from '../common/money';
import type { MiningSiteId } from './property';

export type MiningUnitId = Brand<string, 'MiningUnitId'>;

/** @deprecated Use {@link MiningUnitId}. Transitional alias for the W-E migration. */
export type UnitId = MiningUnitId;

export function asMiningUnitId(id: string): MiningUnitId {
  return id as MiningUnitId;
}

/** @deprecated Use {@link asMiningUnitId}. */
export const asUnitId = asMiningUnitId;

/** Mining-unit type — the kind of operating unit within the site. */
export type MiningUnitType =
  | 'open_pit_bench'
  | 'underground_stope'
  | 'alluvial_claim'
  | 'processing_line'
  | 'cil_circuit'
  | 'cip_circuit'
  | 'gold_room'
  | 'weighbridge'
  | 'tailings_cell';

/** @deprecated Use {@link MiningUnitType}. */
export type UnitType = MiningUnitType;

/** Mining-unit status (production / capacity state). */
export type MiningUnitStatus =
  | 'idle'
  | 'in_production'
  | 'reserved'
  | 'under_maintenance'
  | 'not_available';

/** @deprecated Use {@link MiningUnitStatus}. */
export type UnitStatus = MiningUnitStatus;

/**
 * Mining-unit entity
 */
export interface MiningUnit extends EntityMetadata, SoftDeletable {
  readonly id: MiningUnitId;
  readonly tenantId: TenantId;
  readonly siteId: MiningSiteId;
  readonly unitNumber: string; // e.g., "PIT-A101"
  readonly level: number; // bench / stope level
  readonly type: MiningUnitType;
  readonly status: MiningUnitStatus;
  /** Estimated ore grade in grams per tonne (g/t). */
  readonly oreGradeGramsPerTonne: number;
  /** Expected metallurgical recovery, as a percentage. */
  readonly recoveryPct: number;
  readonly area: number | null; // Square meters
  /** Periodic operating levy assessed on the unit (e.g. cooperative levy). */
  readonly operatingLevy: Money;
  /** Performance / rehabilitation bond held against the unit. */
  readonly bondAmount: Money;
  readonly amenities: readonly string[];
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly lastInspectionDate: ISOTimestamp | null;
  readonly nextInspectionDue: ISOTimestamp | null;
}

/** @deprecated Use {@link MiningUnit}. */
export type Unit = MiningUnit;

/** Create a new mining unit */
export function createMiningUnit(
  id: MiningUnitId,
  data: {
    tenantId: TenantId;
    siteId: MiningSiteId;
    unitNumber: string;
    level: number;
    type: MiningUnitType;
    oreGradeGramsPerTonne: number;
    recoveryPct: number;
    operatingLevy: Money;
    bondAmount: Money;
    area?: number;
    amenities?: string[];
    description?: string;
  },
  createdBy: UserId
): MiningUnit {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    siteId: data.siteId,
    unitNumber: data.unitNumber,
    level: data.level,
    type: data.type,
    status: 'idle',
    oreGradeGramsPerTonne: data.oreGradeGramsPerTonne,
    recoveryPct: data.recoveryPct,
    area: data.area ?? null,
    operatingLevy: data.operatingLevy,
    bondAmount: data.bondAmount,
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

/** @deprecated Use {@link createMiningUnit}. */
export const createUnit = createMiningUnit;

/** Update mining-unit status */
export function updateUnitStatus(
  unit: MiningUnit,
  status: MiningUnitStatus,
  updatedBy: UserId
): MiningUnit {
  return {
    ...unit,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Record inspection */
export function recordInspection(
  unit: MiningUnit,
  inspectionDate: ISOTimestamp,
  nextDueDate: ISOTimestamp,
  updatedBy: UserId
): MiningUnit {
  return {
    ...unit,
    lastInspectionDate: inspectionDate,
    nextInspectionDue: nextDueDate,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Check if inspection is overdue */
export function isInspectionOverdue(unit: MiningUnit): boolean {
  if (!unit.nextInspectionDue) return false;
  return new Date(unit.nextInspectionDue) < new Date();
}

/** Update the unit's operating levy. */
export function updateOperatingLevy(
  unit: MiningUnit,
  newLevy: Money,
  updatedBy: UserId
): MiningUnit {
  return {
    ...unit,
    operatingLevy: newLevy,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}
