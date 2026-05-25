/**
 * Domain Model Extensions for Payments-Ledger Service
 *
 * Provides types, interfaces, and utility functions that the payments-ledger
 * service requires but are not yet available in @borjie/domain-models.
 *
 * Also augments the Money class with convenience methods used throughout
 * the service layer.
 */
import { Money, CurrencyCode, TenantId } from '@borjie/domain-models';

// =============================================================================
// Missing Branded Types
// =============================================================================

/** Reconciliation run identifier */
export type ReconciliationId = string & { __brand: 'ReconciliationId' };

// =============================================================================
// Missing Domain Types
// =============================================================================

/** Reconciliation match status */
export type ReconciliationStatus = 'MATCHED' | 'UNMATCHED' | 'EXCEPTION';

/** Serialised Money value (return type of Money.toData()) */
export type MoneyData = { amount: number; currency: CurrencyCode };

/**
 * TenantAggregate – minimal interface used by payment orchestration.
 *
 * In production this would come from the tenant service; here we declare
 * just enough surface for the payments module to calculate fees and route
 * payments to connected accounts.
 */
export interface TenantAggregate {
  id: TenantId;
  /** Platform fee as a percentage (e.g. 5.0 for 5%) */
  getPlatformFeePercent(): number;
  paymentSettings: {
    stripeAccountId?: string;
    mpesaShortCode?: string;
  };
}

// =============================================================================
// Missing Utility Functions
// =============================================================================

/**
 * Calculate the platform fee for a given amount.
 *
 * @param amount  The gross payment amount
 * @param feePercent  Fee percentage (e.g. 5.0 for 5%)
 * @returns  The fee as a Money value in the same currency
 */
export function calculatePlatformFee(amount: Money, feePercent: number): Money {
  const feeMinorUnits = Math.round(amount.amountMinorUnits * feePercent / 100);
  return Money.fromMinorUnits(feeMinorUnits, amount.currency);
}

/**
 * Create a typed branded ID from a string value.
 *
 * Usage: `createId<LedgerEntryId>(\`le_\${uuidv4()}\`)`
 */
export function createId<T extends string>(value: string): T {
  return value as T;
}

// =============================================================================
// Money Class Augmentation
// =============================================================================

// --- TypeScript declaration merging ---
declare module '@borjie/domain-models' {
  interface Money {
    /** True when amount is exactly 0 */
    isZero(): boolean;
    /** True when amount < 0 */
    isNegative(): boolean;
    /** Human-readable representation, e.g. "KES 100.00" */
    toString(): string;
    /** Amount expressed in major currency units (e.g. shillings, dollars) */
    readonly amountMajorUnits: number;
  }
}

// --- Runtime prototype patching ---
const MoneyProto = Money.prototype as unknown as Record<string, unknown>;

if (typeof MoneyProto.isZero !== 'function') {
  MoneyProto.isZero = function (this: Money): boolean {
    return this.amountMinorUnits === 0;
  };
}

if (typeof MoneyProto.isNegative !== 'function') {
  MoneyProto.isNegative = function (this: Money): boolean {
    return this.amountMinorUnits < 0;
  };
}

// Override default Object.prototype.toString with a useful representation
MoneyProto.toString = function (this: Money): string {
  return `${this.currency} ${(this.amountMinorUnits / 100).toFixed(2)}`;
};

if (!Object.getOwnPropertyDescriptor(Money.prototype, 'amountMajorUnits')) {
  Object.defineProperty(Money.prototype, 'amountMajorUnits', {
    get(this: Money): number {
      return this.amountMinorUnits / 100;
    },
    configurable: true,
    enumerable: false,
  });
}
