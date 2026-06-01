/**
 * Offtake (supply-agreement) domain model
 * Represents a mineral offtake / supply agreement between a mining
 * owner (seller) and a buyer / off-taker counterparty. Defines the
 * term, delivery cadence, pricing / royalty-bearing payment, and the
 * performance bond securing the agreement.
 */

import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import { Money } from '../common/money';
import type { CustomerId, LeaseId } from '../payments/payment-intent';
import type { MiningSiteId } from '../property/property';
import type { MiningUnitId } from '../property/unit';

// The persisted brand id is still `LeaseId` (sourced from the payments
// domain). `OfftakeId` is the canonical mining-domain name; the legacy
// `LeaseId` re-export is retained for downstream importers (W-E phase).
export type OfftakeId = LeaseId;
/** @deprecated Use {@link OfftakeId}. */
export type { LeaseId } from '../payments/payment-intent';
export { asLeaseId } from '../payments/payment-intent';
export { asLeaseId as asOfftakeId } from '../payments/payment-intent';

/** Offtake-agreement status */
export type OfftakeStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'expiring_soon' // Within 60 days of end
  | 'expired'
  | 'terminated'
  | 'renewed';

/** @deprecated Use {@link OfftakeStatus}. */
export type LeaseStatus = OfftakeStatus;

/** Offtake-agreement type */
export type OfftakeType = 'fixed_term' | 'spot' | 'evergreen';

/** @deprecated Use {@link OfftakeType}. */
export type LeaseType = OfftakeType;

/** Payment / pricing frequency */
export type PaymentFrequency = 'per_shipment' | 'monthly' | 'quarterly' | 'annual';

/** @deprecated Use {@link PaymentFrequency}. */
export type RentFrequency = PaymentFrequency;

/** Additional party named on the offtake agreement. */
export interface OfftakeParty {
  readonly name: string;
  readonly relationship: string;
  readonly isAuthorisedSignatory: boolean;
}

/**
 * Offtake-agreement entity
 */
export interface Offtake extends EntityMetadata {
  readonly id: OfftakeId;
  readonly tenantId: TenantId;
  readonly siteId: MiningSiteId;
  readonly unitId: MiningUnitId;
  /** The buyer / off-taker counterparty. */
  readonly counterpartyId: CustomerId;
  readonly offtakeNumber: string; // e.g., "OFT-2026-0001"
  readonly status: OfftakeStatus;
  readonly type: OfftakeType;
  readonly startDate: ISOTimestamp;
  readonly endDate: ISOTimestamp | null; // Null for evergreen
  /** First-delivery / mobilisation date. */
  readonly mobilisationDate: ISOTimestamp;
  /** Final-delivery / close-out date. */
  readonly closeoutDate: ISOTimestamp | null;
  /** Contracted payment per cycle (price / royalty-bearing consideration). */
  readonly paymentAmount: Money;
  readonly paymentFrequency: PaymentFrequency;
  readonly paymentDueDay: number; // Day of month (1-28)
  /** Performance / delivery bond securing the agreement. */
  readonly performanceBond: Money;
  readonly bondPosted: boolean;
  readonly latePaymentPercentage: number; // e.g., 5 for 5%
  readonly latePaymentGraceDays: number; // Days after due date before fee applies
  readonly additionalParties: readonly OfftakeParty[];
  readonly specialTerms: string | null;
  readonly documentIds: readonly string[]; // Signed document references
  readonly signedAt: ISOTimestamp | null;
  readonly terminatedAt: ISOTimestamp | null;
  readonly terminationReason: string | null;
  readonly renewedFromOfftakeId: OfftakeId | null;
  readonly renewedToOfftakeId: OfftakeId | null;
}

/** @deprecated Use {@link Offtake}. */
export type Lease = Offtake;

/** Create a new offtake agreement */
export function createOfftake(
  id: OfftakeId,
  data: {
    tenantId: TenantId;
    siteId: MiningSiteId;
    unitId: MiningUnitId;
    counterpartyId: CustomerId;
    offtakeNumber: string;
    type: OfftakeType;
    startDate: ISOTimestamp;
    endDate?: ISOTimestamp;
    mobilisationDate: ISOTimestamp;
    paymentAmount: Money;
    paymentFrequency?: PaymentFrequency;
    paymentDueDay?: number;
    performanceBond: Money;
    latePaymentPercentage?: number;
    latePaymentGraceDays?: number;
    additionalParties?: OfftakeParty[];
    specialTerms?: string;
  },
  createdBy: UserId
): Offtake {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    siteId: data.siteId,
    unitId: data.unitId,
    counterpartyId: data.counterpartyId,
    offtakeNumber: data.offtakeNumber,
    status: 'draft',
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    mobilisationDate: data.mobilisationDate,
    closeoutDate: null,
    paymentAmount: data.paymentAmount,
    paymentFrequency: data.paymentFrequency ?? 'monthly',
    paymentDueDay: data.paymentDueDay ?? 1,
    performanceBond: data.performanceBond,
    bondPosted: false,
    latePaymentPercentage: data.latePaymentPercentage ?? 5,
    latePaymentGraceDays: data.latePaymentGraceDays ?? 5,
    additionalParties: data.additionalParties ?? [],
    specialTerms: data.specialTerms ?? null,
    documentIds: [],
    signedAt: null,
    terminatedAt: null,
    terminationReason: null,
    renewedFromOfftakeId: null,
    renewedToOfftakeId: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** @deprecated Use {@link createOfftake}. */
export const createLease = createOfftake;

/** Activate offtake agreement after signing */
export function activateOfftake(
  offtake: Offtake,
  documentIds: string[],
  updatedBy: UserId
): Offtake {
  const now = new Date().toISOString();
  return {
    ...offtake,
    status: 'active',
    documentIds,
    signedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link activateOfftake}. */
export const activateLease = activateOfftake;

/** Terminate offtake agreement */
export function terminateOfftake(
  offtake: Offtake,
  reason: string,
  closeoutDate: ISOTimestamp,
  updatedBy: UserId
): Offtake {
  const now = new Date().toISOString();
  return {
    ...offtake,
    status: 'terminated',
    terminatedAt: now,
    terminationReason: reason,
    closeoutDate,
    updatedAt: now,
    updatedBy,
  };
}

/** @deprecated Use {@link terminateOfftake}. */
export const terminateLease = terminateOfftake;

/** Check if offtake is expiring soon (within days) */
export function isExpiringSoon(offtake: Offtake, daysThreshold: number = 60): boolean {
  if (!offtake.endDate || offtake.status !== 'active') return false;
  const endDate = new Date(offtake.endDate);
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
  return endDate <= thresholdDate && endDate > new Date();
}

/** Check if offtake is expired */
export function isExpired(offtake: Offtake): boolean {
  if (!offtake.endDate || offtake.status === 'terminated') return false;
  return new Date(offtake.endDate) < new Date();
}

/** Calculate late-payment fee */
export function calculateLateFee(offtake: Offtake): Money {
  const feeAmount = Math.round(offtake.paymentAmount.amount * (offtake.latePaymentPercentage / 100));
  return Money.fromMinorUnits(feeAmount, offtake.paymentAmount.currency);
}

/** Generate offtake-agreement number */
export function generateOfftakeNumber(year: number, sequence: number): string {
  return `OFT-${year}-${String(sequence).padStart(4, '0')}`;
}

/** @deprecated Use {@link generateOfftakeNumber}. */
export const generateLeaseNumber = generateOfftakeNumber;

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

/** Get days until the next payment is due for the current period. */
export function getDaysUntilPaymentDue(offtake: Offtake): number {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Handle months with fewer days than paymentDueDay (Feb with day=31).
  // Without this clamp, a day=31 due date on Feb 15 would compute a due
  // date of March 3 (a rollover artifact), inflating "days until due".
  let dueDate = new Date(
    currentYear,
    currentMonth,
    clampDayToMonth(currentYear, currentMonth, offtake.paymentDueDay)
  );

  // If due date has passed this month, get next month's due date
  if (dueDate < now) {
    const nextMonth = currentMonth + 1;
    dueDate = new Date(
      currentYear,
      nextMonth,
      clampDayToMonth(currentYear, nextMonth, offtake.paymentDueDay)
    );
  }

  const diffTime = dueDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/** @deprecated Use {@link getDaysUntilPaymentDue}. */
export const getDaysUntilRentDue = getDaysUntilPaymentDue;
