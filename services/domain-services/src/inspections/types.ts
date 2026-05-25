/**
 * Inspections Domain Types
 * Property inspection workflow for move-in, move-out, periodic, maintenance, and pre-listing inspections
 */

import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  ISOTimestamp,
} from '@borjie/domain-models';

/** Branded ID for inspection */
export type InspectionId = string & { __brand: 'InspectionId' };
export function asInspectionId(id: string): InspectionId {
  return id as InspectionId;
}

/** Branded ID for room within inspection */
export type RoomId = string & { __brand: 'RoomId' };
export function asRoomId(id: string): RoomId {
  return id as RoomId;
}

/** Branded ID for inspection item */
export type InspectionItemId = string & { __brand: 'InspectionItemId' };
export function asInspectionItemId(id: string): InspectionItemId {
  return id as InspectionItemId;
}

// ============================================================================
// Inspection Types & Status
// ============================================================================

export const INSPECTION_TYPES = [
  'move_in',
  'move_out',
  'periodic',
  'maintenance',
  'pre_listing',
] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

// ============================================================================
// Condition Ratings
// ============================================================================

export const CONDITION_RATINGS = [
  'excellent',
  'good',
  'fair',
  'poor',
  'damaged',
] as const;
export type ConditionRating = (typeof CONDITION_RATINGS)[number];

// ============================================================================
// Inspection Item
// ============================================================================

/** Inspection item: room, item, condition, notes, photos */
export interface InspectionItem {
  readonly id: InspectionItemId;
  readonly room: string;
  readonly item: string;
  readonly condition: ConditionRating;
  readonly notes: string | null;
  readonly photos: readonly string[];
  readonly roomId: RoomId;
  readonly roomName: string; // alias for room
  readonly itemName: string; // alias for item
  readonly addedAt: ISOTimestamp;
  readonly addedBy: UserId;
}

// ============================================================================
// Inspection Room
// ============================================================================

export interface InspectionRoom {
  readonly id: RoomId;
  readonly name: string;
  readonly items: readonly InspectionItem[];
  readonly photoUrls: readonly string[];
  readonly notes: string | null;
}

// ============================================================================
// E-Signature
// ============================================================================

export interface ESignature {
  readonly signerRole: 'tenant' | 'inspector' | 'manager';
  readonly signerUserId: UserId;
  readonly signatureData: string; // Base64 or signed token
  readonly signedAt: ISOTimestamp;
  readonly ipAddress?: string | null;
}

// ============================================================================
// Inspection Report
// ============================================================================

export interface InspectionReport {
  readonly inspectionId: InspectionId;
  readonly rooms: readonly InspectionRoom[];
  readonly items: readonly InspectionItem[];
  readonly photos: readonly string[];
  readonly signatures: readonly ESignature[];
  readonly inspectorNotes: string | null;
  readonly overallCondition: ConditionRating | null;
  readonly completedAt: ISOTimestamp | null;
}

// ============================================================================
// Property Condition Snapshot
// ============================================================================

export interface PropertyConditionSnapshot {
  readonly inspectionId: InspectionId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly capturedAt: ISOTimestamp;
  readonly inspectionType: InspectionType;
  readonly rooms: readonly {
    readonly roomId: RoomId;
    readonly roomName: string;
    readonly items: readonly {
      readonly itemName: string;
      readonly condition: ConditionRating;
      readonly photoUrls: readonly string[];
    }[];
  }[];
  readonly overallCondition: ConditionRating;
}

/** Alias for PropertyConditionSnapshot - snapshot of property condition at inspection time */
export type PropertyCondition = PropertyConditionSnapshot;

// ============================================================================
// Inspection Entity
// ============================================================================

export interface Inspection {
  readonly id: InspectionId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly type: InspectionType;
  readonly status: InspectionStatus;
  readonly scheduledDate: ISOTimestamp;
  readonly scheduledTimeSlot: string | null;
  /** Inspector assigned to this inspection (same as assignedTo) */
  readonly inspector: UserId;
  readonly assignedTo: UserId;
  readonly startedAt: ISOTimestamp | null;
  readonly completedAt: ISOTimestamp | null;
  readonly report: InspectionReport | null;
  /** Items from report (convenience; empty when no report) */
  readonly items: readonly InspectionItem[];
  /** Signatures from report (convenience; empty when no report) */
  readonly signatures: readonly ESignature[];
  readonly linkedMoveInId: InspectionId | null;
  readonly linkedMoveOutId: InspectionId | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Inspection Comparison (for deposit reconciliation)
// ============================================================================

export interface InspectionComparison {
  readonly moveInId: InspectionId;
  readonly moveOutId: InspectionId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly damages: readonly DamageComparison[];
  readonly improvements: readonly string[];
  readonly summary: {
    readonly totalDamagedItems: number;
    readonly totalImprovedItems: number;
    readonly estimatedDeduction: number | null;
  };
}

export interface DamageComparison {
  readonly roomName: string;
  readonly itemName: string;
  readonly moveInCondition: ConditionRating;
  readonly moveOutCondition: ConditionRating;
  readonly delta: 'worse' | 'same' | 'improved';
  readonly notes: string | null;
  readonly photoUrls: readonly string[];
}

// ============================================================================
// List Filters
// ============================================================================

export interface InspectionListFilters {
  readonly tenantId: TenantId;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly type?: InspectionType;
  readonly status?: InspectionStatus;
  readonly fromDate?: ISOTimestamp;
  readonly toDate?: ISOTimestamp;
}
