/**
 * Occupancy domain model
 * Represents the active tenure of a customer in a unit
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { CustomerId, LeaseId } from '../payments/payment-intent';
import type { UnitId } from '../property/unit';
import {
  OccupancyStatus,
  OccupancyStatusSchema,
  OnboardingState,
  OnboardingStateSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type OccupancyId = Brand<string, 'OccupancyId'>;

export function asOccupancyId(id: string): OccupancyId {
  return id as OccupancyId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Additional occupant on the lease */
export interface AdditionalOccupant {
  readonly name: string;
  readonly relationship: string;
  readonly dateOfBirth: ISOTimestamp | null;
  readonly idNumber: string | null;
  readonly isAdult: boolean;
  readonly phone: string | null;
  readonly email: string | null;
}

export const AdditionalOccupantSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  dateOfBirth: z.string().datetime().nullable(),
  idNumber: z.string().nullable(),
  isAdult: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

/** Meter reading for move-in/move-out */
export interface MeterReading {
  readonly meterType: 'electricity' | 'water' | 'gas' | 'other';
  readonly meterNumber: string;
  readonly reading: number;
  readonly unit: string;
  readonly readingDate: ISOTimestamp;
  readonly photoUrl: string | null;
}

export const MeterReadingSchema = z.object({
  meterType: z.enum(['electricity', 'water', 'gas', 'other']),
  meterNumber: z.string(),
  reading: z.number(),
  unit: z.string(),
  readingDate: z.string().datetime(),
  photoUrl: z.string().nullable(),
});

/** Onboarding checklist item */
export interface OnboardingChecklistItem {
  readonly step: OnboardingState;
  readonly name: string;
  readonly completedAt: ISOTimestamp | null;
  readonly completedBy: UserId | null;
  readonly notes: string | null;
  readonly data: Record<string, unknown>;
}

export const OnboardingChecklistItemSchema = z.object({
  step: OnboardingStateSchema,
  name: z.string(),
  completedAt: z.string().datetime().nullable(),
  completedBy: z.string().nullable(),
  notes: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});

// ============================================================================
// Occupancy Zod Schema
// ============================================================================

export const OccupancySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  leaseId: z.string(),
  unitId: z.string(),
  customerId: z.string(),

  status: OccupancyStatusSchema,
  onboardingState: OnboardingStateSchema,

  // Dates
  moveInDate: z.string().datetime(),
  moveOutDate: z.string().datetime().nullable(),
  expectedMoveOutDate: z.string().datetime().nullable(),
  noticeGivenDate: z.string().datetime().nullable(),

  // Move-in
  moveInCompletedAt: z.string().datetime().nullable(),
  moveInInspectionId: z.string().nullable(),
  moveInMeterReadings: z.array(MeterReadingSchema),
  keysHandedOver: z.boolean(),
  keysHandoverDate: z.string().datetime().nullable(),

  // Move-out
  moveOutCompletedAt: z.string().datetime().nullable(),
  moveOutInspectionId: z.string().nullable(),
  moveOutMeterReadings: z.array(MeterReadingSchema),
  keysReturned: z.boolean(),
  keysReturnDate: z.string().datetime().nullable(),

  // Onboarding
  onboardingChecklist: z.array(OnboardingChecklistItemSchema),

  // Additional occupants
  additionalOccupants: z.array(AdditionalOccupantSchema),

  notes: z.string().nullable(),
});

export type OccupancyData = z.infer<typeof OccupancySchema>;

// ============================================================================
// Occupancy Interface
// ============================================================================

export interface Occupancy extends EntityMetadata {
  readonly id: OccupancyId;
  readonly tenantId: TenantId;
  readonly leaseId: LeaseId;
  readonly unitId: UnitId;
  readonly customerId: CustomerId;

  readonly status: OccupancyStatus;
  readonly onboardingState: OnboardingState;

  // Dates
  readonly moveInDate: ISOTimestamp;
  readonly moveOutDate: ISOTimestamp | null;
  readonly expectedMoveOutDate: ISOTimestamp | null;
  readonly noticeGivenDate: ISOTimestamp | null;

  // Move-in
  readonly moveInCompletedAt: ISOTimestamp | null;
  readonly moveInInspectionId: string | null;
  readonly moveInMeterReadings: readonly MeterReading[];
  readonly keysHandedOver: boolean;
  readonly keysHandoverDate: ISOTimestamp | null;

  // Move-out
  readonly moveOutCompletedAt: ISOTimestamp | null;
  readonly moveOutInspectionId: string | null;
  readonly moveOutMeterReadings: readonly MeterReading[];
  readonly keysReturned: boolean;
  readonly keysReturnDate: ISOTimestamp | null;

  // Onboarding
  readonly onboardingChecklist: readonly OnboardingChecklistItem[];

  // Additional occupants
  readonly additionalOccupants: readonly AdditionalOccupant[];

  readonly notes: string | null;

  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createOccupancy(
  id: OccupancyId,
  data: {
    tenantId: TenantId;
    leaseId: LeaseId;
    unitId: UnitId;
    customerId: CustomerId;
    moveInDate: ISOTimestamp;
    expectedMoveOutDate?: ISOTimestamp;
    additionalOccupants?: AdditionalOccupant[];
  },
  createdBy: UserId
): Occupancy {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    leaseId: data.leaseId,
    unitId: data.unitId,
    customerId: data.customerId,

    status: 'pending_move_in',
    onboardingState: 'a0_pre_move_in',

    moveInDate: data.moveInDate,
    moveOutDate: null,
    expectedMoveOutDate: data.expectedMoveOutDate ?? null,
    noticeGivenDate: null,

    moveInCompletedAt: null,
    moveInInspectionId: null,
    moveInMeterReadings: [],
    keysHandedOver: false,
    keysHandoverDate: null,

    moveOutCompletedAt: null,
    moveOutInspectionId: null,
    moveOutMeterReadings: [],
    keysReturned: false,
    keysReturnDate: null,

    onboardingChecklist: [],
    additionalOccupants: data.additionalOccupants ?? [],

    notes: null,

    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,

    deletedAt: null,
    deletedBy: null,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function startMoveIn(occupancy: Occupancy, updatedBy: UserId): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'active',
    onboardingState: 'a1_welcome_setup',
    updatedAt: now,
    updatedBy,
  };
}

export function completeMoveIn(
  occupancy: Occupancy,
  inspectionId: string,
  meterReadings: MeterReading[],
  updatedBy: UserId
): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    moveInCompletedAt: now,
    moveInInspectionId: inspectionId,
    moveInMeterReadings: meterReadings,
    keysHandedOver: true,
    keysHandoverDate: now,
    updatedAt: now,
    updatedBy,
  };
}

export function advanceOnboarding(
  occupancy: Occupancy,
  nextState: OnboardingState,
  updatedBy: UserId
): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    onboardingState: nextState,
    updatedAt: now,
    updatedBy,
  };
}

export function giveNotice(
  occupancy: Occupancy,
  expectedMoveOutDate: ISOTimestamp,
  updatedBy: UserId
): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'notice_given',
    noticeGivenDate: now,
    expectedMoveOutDate,
    updatedAt: now,
    updatedBy,
  };
}

export function startMoveOut(occupancy: Occupancy, updatedBy: UserId): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'pending_move_out',
    updatedAt: now,
    updatedBy,
  };
}

export function completeMoveOut(
  occupancy: Occupancy,
  inspectionId: string,
  meterReadings: MeterReading[],
  updatedBy: UserId
): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'moved_out',
    moveOutDate: now,
    moveOutCompletedAt: now,
    moveOutInspectionId: inspectionId,
    moveOutMeterReadings: meterReadings,
    keysReturned: true,
    keysReturnDate: now,
    updatedAt: now,
    updatedBy,
  };
}

export function markEvicted(occupancy: Occupancy, updatedBy: UserId): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'evicted',
    moveOutDate: now,
    updatedAt: now,
    updatedBy,
  };
}

export function markAbandoned(occupancy: Occupancy, updatedBy: UserId): Occupancy {
  const now = new Date().toISOString();
  return {
    ...occupancy,
    status: 'abandoned',
    moveOutDate: now,
    updatedAt: now,
    updatedBy,
  };
}

export function isOnboardingComplete(occupancy: Occupancy): boolean {
  return occupancy.onboardingState === 'a6_complete';
}

export function isActive(occupancy: Occupancy): boolean {
  return occupancy.status === 'active';
}

export function hasGivenNotice(occupancy: Occupancy): boolean {
  return occupancy.status === 'notice_given' || occupancy.noticeGivenDate !== null;
}

export function getDaysUntilMoveOut(occupancy: Occupancy): number | null {
  if (!occupancy.expectedMoveOutDate) return null;
  const now = new Date();
  const moveOut = new Date(occupancy.expectedMoveOutDate);
  const diffTime = moveOut.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
