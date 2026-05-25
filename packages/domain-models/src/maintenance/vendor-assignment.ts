/**
 * Vendor Assignment domain model
 * Vendor assignment to property/category for work orders
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import { WorkOrderCategory, WorkOrderCategorySchema } from '../common/enums';
import type { PropertyId } from '../property/property';
import type { VendorId } from './vendor';

// ============================================================================
// Type Aliases
// ============================================================================

export type VendorAssignmentId = Brand<string, 'VendorAssignmentId'>;

export function asVendorAssignmentId(id: string): VendorAssignmentId {
  return id as VendorAssignmentId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Available hours configuration */
export interface AvailableHours {
  readonly start: string; // e.g., "08:00"
  readonly end: string; // e.g., "18:00"
  readonly breakStart?: string;
  readonly breakEnd?: string;
}

export const AvailableHoursSchema = z.object({
  start: z.string(),
  end: z.string(),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
});

// ============================================================================
// Zod Schema
// ============================================================================

export const VendorAssignmentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  vendorId: z.string(),
  propertyId: z.string().nullable(),

  assignmentType: z.enum(['property', 'category', 'general']),
  category: WorkOrderCategorySchema.nullable(),

  isActive: z.boolean().default(true),
  priority: z.number().default(0),
  isPreferred: z.boolean().default(false),

  coverageArea: z.array(z.string()).default([]),

  agreedRate: z.number().nullable(),
  rateType: z.enum(['hourly', 'fixed', 'per_job', 'monthly']).nullable(),
  rateCurrency: z.string().default('USD'),

  availableDays: z.array(z.number().min(0).max(6)).default([]),
  availableHours: AvailableHoursSchema.nullable(),
  emergencyAvailable: z.boolean().default(false),

  contractStart: z.string().datetime().nullable(),
  contractEnd: z.string().datetime().nullable(),

  jobsCompleted: z.number().default(0),
  avgRating: z.number().nullable(),

  notes: z.string().nullable(),
});

export type VendorAssignmentData = z.infer<typeof VendorAssignmentSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface VendorAssignment extends EntityMetadata {
  readonly id: VendorAssignmentId;
  readonly tenantId: TenantId;
  readonly vendorId: VendorId;
  readonly propertyId: PropertyId | null;

  readonly assignmentType: 'property' | 'category' | 'general';
  readonly category: WorkOrderCategory | null;

  readonly isActive: boolean;
  readonly priority: number;
  readonly isPreferred: boolean;

  readonly coverageArea: readonly string[];

  readonly agreedRate: number | null;
  readonly rateType: 'hourly' | 'fixed' | 'per_job' | 'monthly' | null;
  readonly rateCurrency: string;

  readonly availableDays: readonly number[];
  readonly availableHours: AvailableHours | null;
  readonly emergencyAvailable: boolean;

  readonly contractStart: ISOTimestamp | null;
  readonly contractEnd: ISOTimestamp | null;

  readonly jobsCompleted: number;
  readonly avgRating: number | null;

  readonly notes: string | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createVendorAssignment(
  id: VendorAssignmentId,
  data: {
    tenantId: TenantId;
    vendorId: VendorId;
    assignmentType: 'property' | 'category' | 'general';
    propertyId?: PropertyId;
    category?: WorkOrderCategory;
    priority?: number;
    isPreferred?: boolean;
    agreedRate?: number;
    rateType?: 'hourly' | 'fixed' | 'per_job' | 'monthly';
    rateCurrency?: string;
    availableDays?: number[];
    availableHours?: AvailableHours;
    emergencyAvailable?: boolean;
    contractStart?: ISOTimestamp;
    contractEnd?: ISOTimestamp;
    coverageArea?: string[];
    notes?: string;
  },
  createdBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    vendorId: data.vendorId,
    propertyId: data.propertyId ?? null,

    assignmentType: data.assignmentType,
    category: data.category ?? null,

    isActive: true,
    priority: data.priority ?? 0,
    isPreferred: data.isPreferred ?? false,

    coverageArea: data.coverageArea ?? [],

    agreedRate: data.agreedRate ?? null,
    rateType: data.rateType ?? null,
    rateCurrency: data.rateCurrency ?? 'USD',

    availableDays: data.availableDays ?? [],
    availableHours: data.availableHours ?? null,
    emergencyAvailable: data.emergencyAvailable ?? false,

    contractStart: data.contractStart ?? null,
    contractEnd: data.contractEnd ?? null,

    jobsCompleted: 0,
    avgRating: null,

    notes: data.notes ?? null,

    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function activateAssignment(
  assignment: VendorAssignment,
  updatedBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();
  return {
    ...assignment,
    isActive: true,
    updatedAt: now,
    updatedBy,
  };
}

export function deactivateAssignment(
  assignment: VendorAssignment,
  updatedBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();
  return {
    ...assignment,
    isActive: false,
    updatedAt: now,
    updatedBy,
  };
}

export function setAsPreferred(
  assignment: VendorAssignment,
  updatedBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();
  return {
    ...assignment,
    isPreferred: true,
    updatedAt: now,
    updatedBy,
  };
}

export function updateRate(
  assignment: VendorAssignment,
  rate: number,
  rateType: 'hourly' | 'fixed' | 'per_job' | 'monthly',
  updatedBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();
  return {
    ...assignment,
    agreedRate: rate,
    rateType,
    updatedAt: now,
    updatedBy,
  };
}

export function recordJobCompletion(
  assignment: VendorAssignment,
  rating: number | null
): VendorAssignment {
  const now = new Date().toISOString();
  const newJobsCompleted = assignment.jobsCompleted + 1;

  // Calculate new average rating
  let newAvgRating: number | null = assignment.avgRating;
  if (rating !== null) {
    if (assignment.avgRating === null) {
      newAvgRating = rating;
    } else {
      // Running average
      newAvgRating =
        (assignment.avgRating * assignment.jobsCompleted + rating) / newJobsCompleted;
    }
  }

  return {
    ...assignment,
    jobsCompleted: newJobsCompleted,
    avgRating: newAvgRating !== null ? Math.round(newAvgRating * 100) / 100 : null,
    updatedAt: now,
    updatedBy: assignment.updatedBy,
  };
}

export function updateAvailability(
  assignment: VendorAssignment,
  availableDays: number[],
  availableHours: AvailableHours | null,
  emergencyAvailable: boolean,
  updatedBy: UserId
): VendorAssignment {
  const now = new Date().toISOString();
  return {
    ...assignment,
    availableDays,
    availableHours,
    emergencyAvailable,
    updatedAt: now,
    updatedBy,
  };
}

export function isAssignmentActive(assignment: VendorAssignment): boolean {
  if (!assignment.isActive) return false;
  if (assignment.contractEnd) {
    const endDate = new Date(assignment.contractEnd);
    if (endDate < new Date()) return false;
  }
  return true;
}

export function isContractExpiring(
  assignment: VendorAssignment,
  daysThreshold: number = 30
): boolean {
  if (!assignment.contractEnd) return false;
  const endDate = new Date(assignment.contractEnd);
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
  return endDate <= thresholdDate && endDate > new Date();
}

export function isAvailableToday(assignment: VendorAssignment): boolean {
  if (!assignment.isActive) return false;
  const today = new Date().getDay();
  return assignment.availableDays.includes(today);
}

export function isAvailableNow(assignment: VendorAssignment): boolean {
  if (!isAvailableToday(assignment)) return false;
  if (!assignment.availableHours) return true;

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const { start, end, breakStart, breakEnd } = assignment.availableHours;

  // Check if within working hours
  if (currentTime < start || currentTime > end) return false;

  // Check if during break
  if (breakStart && breakEnd) {
    if (currentTime >= breakStart && currentTime <= breakEnd) return false;
  }

  return true;
}

/** Day of week name helper */
export function getDayName(day: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[day] ?? 'Unknown';
}

/** Format available days for display */
export function formatAvailableDays(days: readonly number[]): string {
  if (days.length === 0) return 'No days set';
  if (days.length === 7) return 'Every day';

  // Check for weekdays only
  const weekdays = [1, 2, 3, 4, 5];
  if (
    days.length === 5 &&
    weekdays.every((d) => days.includes(d))
  ) {
    return 'Weekdays';
  }

  // Check for weekends only
  if (days.length === 2 && days.includes(0) && days.includes(6)) {
    return 'Weekends';
  }

  return days.map(getDayName).join(', ');
}
