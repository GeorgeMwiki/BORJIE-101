/**
 * Production-tenure (asset-utilisation) domain model
 * Represents the active operating tenure of a counterparty / operator
 * on a mining unit — from mobilisation through to close-out. Tracks
 * the onboarding checklist, production-handover meter readings, and
 * site-access handover.
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { CustomerId, LeaseId } from '../payments/payment-intent';
import type { MiningUnitId } from '../property/unit';
import {
  OccupancyStatus,
  OccupancyStatusSchema,
  OnboardingState,
  OnboardingStateSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type ProductionTenureId = Brand<string, 'ProductionTenureId'>;

/** @deprecated Use {@link ProductionTenureId}. Transitional alias (W-E phase). */
export type OccupancyId = ProductionTenureId;

export function asProductionTenureId(id: string): ProductionTenureId {
  return id as ProductionTenureId;
}

/** @deprecated Use {@link asProductionTenureId}. */
export const asOccupancyId = asProductionTenureId;

// ============================================================================
// Nested Types
// ============================================================================

/** Additional operator / crew member on the production tenure. */
export interface AdditionalOperator {
  readonly name: string;
  readonly relationship: string;
  readonly dateOfBirth: ISOTimestamp | null;
  readonly idNumber: string | null;
  readonly isAdult: boolean;
  readonly phone: string | null;
  readonly email: string | null;
}

export const AdditionalOperatorSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  dateOfBirth: z.string().datetime().nullable(),
  idNumber: z.string().nullable(),
  isAdult: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

/** Meter reading captured at mobilisation / close-out. */
export interface MeterReading {
  readonly meterType: 'electricity' | 'water' | 'fuel' | 'other';
  readonly meterNumber: string;
  readonly reading: number;
  readonly unit: string;
  readonly readingDate: ISOTimestamp;
  readonly photoUrl: string | null;
}

export const MeterReadingSchema = z.object({
  meterType: z.enum(['electricity', 'water', 'fuel', 'other']),
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
// Production-tenure Zod Schema
// ============================================================================

export const ProductionTenureSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  offtakeId: z.string(),
  unitId: z.string(),
  counterpartyId: z.string(),

  status: OccupancyStatusSchema,
  onboardingState: OnboardingStateSchema,

  // Dates
  mobilisationDate: z.string().datetime(),
  closeoutDate: z.string().datetime().nullable(),
  expectedCloseoutDate: z.string().datetime().nullable(),
  noticeGivenDate: z.string().datetime().nullable(),

  // Mobilisation
  mobilisationCompletedAt: z.string().datetime().nullable(),
  mobilisationInspectionId: z.string().nullable(),
  mobilisationMeterReadings: z.array(MeterReadingSchema),
  accessGranted: z.boolean(),
  accessGrantDate: z.string().datetime().nullable(),

  // Close-out
  closeoutCompletedAt: z.string().datetime().nullable(),
  closeoutInspectionId: z.string().nullable(),
  closeoutMeterReadings: z.array(MeterReadingSchema),
  accessRevoked: z.boolean(),
  accessRevokeDate: z.string().datetime().nullable(),

  // Onboarding
  onboardingChecklist: z.array(OnboardingChecklistItemSchema),

  // Additional operators
  additionalOperators: z.array(AdditionalOperatorSchema),

  notes: z.string().nullable(),
});

export type ProductionTenureData = z.infer<typeof ProductionTenureSchema>;

// ============================================================================
// Production-tenure Interface
// ============================================================================

export interface ProductionTenure extends EntityMetadata {
  readonly id: ProductionTenureId;
  readonly tenantId: TenantId;
  readonly offtakeId: LeaseId;
  readonly unitId: MiningUnitId;
  readonly counterpartyId: CustomerId;

  readonly status: OccupancyStatus;
  readonly onboardingState: OnboardingState;

  // Dates
  readonly mobilisationDate: ISOTimestamp;
  readonly closeoutDate: ISOTimestamp | null;
  readonly expectedCloseoutDate: ISOTimestamp | null;
  readonly noticeGivenDate: ISOTimestamp | null;

  // Mobilisation
  readonly mobilisationCompletedAt: ISOTimestamp | null;
  readonly mobilisationInspectionId: string | null;
  readonly mobilisationMeterReadings: readonly MeterReading[];
  readonly accessGranted: boolean;
  readonly accessGrantDate: ISOTimestamp | null;

  // Close-out
  readonly closeoutCompletedAt: ISOTimestamp | null;
  readonly closeoutInspectionId: string | null;
  readonly closeoutMeterReadings: readonly MeterReading[];
  readonly accessRevoked: boolean;
  readonly accessRevokeDate: ISOTimestamp | null;

  // Onboarding
  readonly onboardingChecklist: readonly OnboardingChecklistItem[];

  // Additional operators
  readonly additionalOperators: readonly AdditionalOperator[];

  readonly notes: string | null;

  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

/** @deprecated Use {@link ProductionTenure}. */
export type Occupancy = ProductionTenure;

// ============================================================================
// Factory Functions
// ============================================================================

export function createProductionTenure(
  id: ProductionTenureId,
  data: {
    tenantId: TenantId;
    offtakeId: LeaseId;
    unitId: MiningUnitId;
    counterpartyId: CustomerId;
    mobilisationDate: ISOTimestamp;
    expectedCloseoutDate?: ISOTimestamp;
    additionalOperators?: AdditionalOperator[];
  },
  createdBy: UserId
): ProductionTenure {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    offtakeId: data.offtakeId,
    unitId: data.unitId,
    counterpartyId: data.counterpartyId,

    status: 'pending_move_in',
    onboardingState: 'a0_pre_move_in',

    mobilisationDate: data.mobilisationDate,
    closeoutDate: null,
    expectedCloseoutDate: data.expectedCloseoutDate ?? null,
    noticeGivenDate: null,

    mobilisationCompletedAt: null,
    mobilisationInspectionId: null,
    mobilisationMeterReadings: [],
    accessGranted: false,
    accessGrantDate: null,

    closeoutCompletedAt: null,
    closeoutInspectionId: null,
    closeoutMeterReadings: [],
    accessRevoked: false,
    accessRevokeDate: null,

    onboardingChecklist: [],
    additionalOperators: data.additionalOperators ?? [],

    notes: null,

    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,

    deletedAt: null,
    deletedBy: null,
  };
}

/** @deprecated Use {@link createProductionTenure}. */
export const createOccupancy = createProductionTenure;

// ============================================================================
// Business Logic Functions
// ============================================================================

export function startMobilisation(tenure: ProductionTenure, updatedBy: UserId): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'active',
    onboardingState: 'a1_welcome_setup',
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link startMobilisation}. */
export const startMoveIn = startMobilisation;

export function completeMobilisation(
  tenure: ProductionTenure,
  inspectionId: string,
  meterReadings: MeterReading[],
  updatedBy: UserId
): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    mobilisationCompletedAt: now,
    mobilisationInspectionId: inspectionId,
    mobilisationMeterReadings: meterReadings,
    accessGranted: true,
    accessGrantDate: now,
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link completeMobilisation}. */
export const completeMoveIn = completeMobilisation;

export function advanceOnboarding(
  tenure: ProductionTenure,
  nextState: OnboardingState,
  updatedBy: UserId
): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    onboardingState: nextState,
    updatedAt: now,
    updatedBy,
  };
}

export function giveNotice(
  tenure: ProductionTenure,
  expectedCloseoutDate: ISOTimestamp,
  updatedBy: UserId
): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'notice_given',
    noticeGivenDate: now,
    expectedCloseoutDate,
    updatedAt: now,
    updatedBy,
  };
}

export function startCloseout(tenure: ProductionTenure, updatedBy: UserId): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'pending_move_out',
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link startCloseout}. */
export const startMoveOut = startCloseout;

export function completeCloseout(
  tenure: ProductionTenure,
  inspectionId: string,
  meterReadings: MeterReading[],
  updatedBy: UserId
): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'moved_out',
    closeoutDate: now,
    closeoutCompletedAt: now,
    closeoutInspectionId: inspectionId,
    closeoutMeterReadings: meterReadings,
    accessRevoked: true,
    accessRevokeDate: now,
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link completeCloseout}. */
export const completeMoveOut = completeCloseout;

/**
 * Mark the tenure as terminated by a licence-suspension / incursion
 * response (the mining-domain analogue of a forced removal).
 */
export function markSuspended(tenure: ProductionTenure, updatedBy: UserId): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'evicted',
    closeoutDate: now,
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link markSuspended}. */
export const markEvicted = markSuspended;

export function markAbandoned(tenure: ProductionTenure, updatedBy: UserId): ProductionTenure {
  const now = new Date().toISOString();
  return {
    ...tenure,
    status: 'abandoned',
    closeoutDate: now,
    updatedAt: now,
    updatedBy,
  };
}

export function isOnboardingComplete(tenure: ProductionTenure): boolean {
  return tenure.onboardingState === 'a6_complete';
}

export function isActive(tenure: ProductionTenure): boolean {
  return tenure.status === 'active';
}

export function hasGivenNotice(tenure: ProductionTenure): boolean {
  return tenure.status === 'notice_given' || tenure.noticeGivenDate !== null;
}

export function getDaysUntilCloseout(tenure: ProductionTenure): number | null {
  if (!tenure.expectedCloseoutDate) return null;
  const now = new Date();
  const closeout = new Date(tenure.expectedCloseoutDate);
  const diffTime = closeout.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/** @deprecated Use {@link getDaysUntilCloseout}. */
export const getDaysUntilMoveOut = getDaysUntilCloseout;
