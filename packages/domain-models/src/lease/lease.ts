/**
 * Lease domain model
 * Represents a rental agreement between property and customer
 */

import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import { Money } from '../common/money';
import type { CustomerId, LeaseId } from '../payments/payment-intent';
import type { PropertyId } from '../property/property';
import type { UnitId } from '../property/unit';

export type { LeaseId } from '../payments/payment-intent';
export { asLeaseId } from '../payments/payment-intent';

/** Lease status */
export type LeaseStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'expiring_soon' // Within 60 days of end
  | 'expired'
  | 'terminated'
  | 'renewed';

/** Lease type */
export type LeaseType = 'fixed_term' | 'month_to_month' | 'periodic';

/** Rent frequency */
export type RentFrequency = 'monthly' | 'quarterly' | 'annual';

/** Occupant (additional person on lease) */
export interface LeaseOccupant {
  readonly name: string;
  readonly relationship: string;
  readonly isAdult: boolean;
}

/**
 * Lease entity
 */
export interface Lease extends EntityMetadata {
  readonly id: LeaseId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly customerId: CustomerId;
  readonly leaseNumber: string; // e.g., "LSE-2024-0001"
  readonly status: LeaseStatus;
  readonly type: LeaseType;
  readonly startDate: ISOTimestamp;
  readonly endDate: ISOTimestamp | null; // Null for month-to-month
  readonly moveInDate: ISOTimestamp;
  readonly moveOutDate: ISOTimestamp | null;
  readonly rentAmount: Money;
  readonly rentFrequency: RentFrequency;
  readonly rentDueDay: number; // Day of month (1-28)
  readonly securityDeposit: Money;
  readonly depositPaid: boolean;
  readonly lateFeePercentage: number; // e.g., 5 for 5%
  readonly lateFeeGraceDays: number; // Days after due date before late fee applies
  readonly additionalOccupants: readonly LeaseOccupant[];
  readonly specialTerms: string | null;
  readonly documentIds: readonly string[]; // Signed document references
  readonly signedAt: ISOTimestamp | null;
  readonly terminatedAt: ISOTimestamp | null;
  readonly terminationReason: string | null;
  readonly renewedFromLeaseId: LeaseId | null;
  readonly renewedToLeaseId: LeaseId | null;
}

/** Create a new lease */
export function createLease(
  id: LeaseId,
  data: {
    tenantId: TenantId;
    propertyId: PropertyId;
    unitId: UnitId;
    customerId: CustomerId;
    leaseNumber: string;
    type: LeaseType;
    startDate: ISOTimestamp;
    endDate?: ISOTimestamp;
    moveInDate: ISOTimestamp;
    rentAmount: Money;
    rentFrequency?: RentFrequency;
    rentDueDay?: number;
    securityDeposit: Money;
    lateFeePercentage?: number;
    lateFeeGraceDays?: number;
    additionalOccupants?: LeaseOccupant[];
    specialTerms?: string;
  },
  createdBy: UserId
): Lease {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId,
    unitId: data.unitId,
    customerId: data.customerId,
    leaseNumber: data.leaseNumber,
    status: 'draft',
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    moveInDate: data.moveInDate,
    moveOutDate: null,
    rentAmount: data.rentAmount,
    rentFrequency: data.rentFrequency ?? 'monthly',
    rentDueDay: data.rentDueDay ?? 1,
    securityDeposit: data.securityDeposit,
    depositPaid: false,
    lateFeePercentage: data.lateFeePercentage ?? 5,
    lateFeeGraceDays: data.lateFeeGraceDays ?? 5,
    additionalOccupants: data.additionalOccupants ?? [],
    specialTerms: data.specialTerms ?? null,
    documentIds: [],
    signedAt: null,
    terminatedAt: null,
    terminationReason: null,
    renewedFromLeaseId: null,
    renewedToLeaseId: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Activate lease after signing */
export function activateLease(
  lease: Lease,
  documentIds: string[],
  updatedBy: UserId
): Lease {
  const now = new Date().toISOString();
  return {
    ...lease,
    status: 'active',
    documentIds,
    signedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

/** Terminate lease */
export function terminateLease(
  lease: Lease,
  reason: string,
  moveOutDate: ISOTimestamp,
  updatedBy: UserId
): Lease {
  const now = new Date().toISOString();
  return {
    ...lease,
    status: 'terminated',
    terminatedAt: now,
    terminationReason: reason,
    moveOutDate,
    updatedAt: now,
    updatedBy,
  };
}

/** Check if lease is expiring soon (within days) */
export function isExpiringSoon(lease: Lease, daysThreshold: number = 60): boolean {
  if (!lease.endDate || lease.status !== 'active') return false;
  const endDate = new Date(lease.endDate);
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
  return endDate <= thresholdDate && endDate > new Date();
}

/** Check if lease is expired */
export function isExpired(lease: Lease): boolean {
  if (!lease.endDate || lease.status === 'terminated') return false;
  return new Date(lease.endDate) < new Date();
}

/** Calculate late fee */
export function calculateLateFee(lease: Lease): Money {
  const feeAmount = Math.round(lease.rentAmount.amount * (lease.lateFeePercentage / 100));
  return Money.fromMinorUnits(feeAmount, lease.rentAmount.currency);
}

/** Generate lease number */
export function generateLeaseNumber(year: number, sequence: number): string {
  return `LSE-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Get days until rent due for current period */
/**
 * Clamp a requested day-of-month to the actual last day of that month.
 * Prevents the Date constructor's silent rollover: new Date(2026, 1, 31)
 * would otherwise become March 3 instead of "as late as possible in Feb".
 */
function clampDayToMonth(year: number, month: number, day: number): number {
  // Day 0 of (month+1) is the last day of `month`.
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), lastDay);
}

export function getDaysUntilRentDue(lease: Lease): number {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Handle months with fewer days than rentDueDay (Feb with rentDueDay=31).
  // Without this clamp, a lease rentDueDay=31 on Feb 15 would compute a due
  // date of March 3 (a rollover artifact), inflating "days until due".
  let dueDate = new Date(
    currentYear,
    currentMonth,
    clampDayToMonth(currentYear, currentMonth, lease.rentDueDay)
  );

  // If due date has passed this month, get next month's due date
  if (dueDate < now) {
    const nextMonth = currentMonth + 1;
    dueDate = new Date(
      currentYear,
      nextMonth,
      clampDayToMonth(currentYear, nextMonth, lease.rentDueDay)
    );
  }

  const diffTime = dueDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
