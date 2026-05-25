/**
 * Shared helpers used across every country plugin in `countries/`.
 *
 * - `buildFlatWithholding` wires a country to `flatRateWithholding` once.
 * - `stubWithholding` gives plugins a zero-rate port whose `rateNote`
 *   makes it clear the rate is operator-configurable.
 * - `buildPaymentRailsPort` accepts a pre-frozen list and returns the port.
 * - `buildLeaseLawPort` accepts a snapshot and returns the port.
 */

import {
  flatRateWithholding,
  type TaxRegimePort,
} from '../ports/tax-regime.port.js';
import type {
  PaymentRail,
  PaymentRailPort,
} from '../ports/payment-rail.port.js';
import type {
  ClauseSpec,
  DepositCap,
  DepositCapRegime,
  LeaseKind,
  LeaseLawPort,
  NoticeReason,
  RentIncreaseCap,
} from '../ports/lease-law.port.js';
import {
  buildStubBureauResult,
  type TenantScreeningPort,
} from '../ports/tenant-screening.port.js';

export function buildFlatWithholding(
  ratePct: number,
  regulatorRef: string,
  rateNote: string
): TaxRegimePort {
  return {
    calculateWithholding(grossRentMinorUnits) {
      return flatRateWithholding(
        grossRentMinorUnits,
        ratePct,
        regulatorRef,
        rateNote
      );
    },
  };
}

/** Zero-rate port flagged for manual configuration. */
export function stubWithholding(
  regulatorRef: string,
  rateNote: string
): TaxRegimePort {
  return {
    calculateWithholding() {
      return {
        withholdingMinorUnits: 0,
        regulatorRef,
        rateNote,
        requiresManualConfiguration: true,
      };
    },
  };
}

export function buildPaymentRailsPort(
  rails: readonly PaymentRail[]
): PaymentRailPort {
  const frozen = Object.freeze([...rails]);
  return {
    listRails() {
      return frozen;
    },
  };
}

export interface LeaseLawSpec {
  readonly requiredClauses: readonly ClauseSpec[];
  readonly noticeWindowDaysByReason: Readonly<
    Partial<Record<NoticeReason, number>>
  >;
  readonly depositCapByRegime: Readonly<
    Partial<Record<DepositCapRegime, DepositCap>>
  >;
  readonly rentIncreaseCapByRegime: Readonly<
    Partial<Record<DepositCapRegime, RentIncreaseCap>>
  >;
  readonly defaultNoticeWindowDays?: number;
  readonly defaultDepositCap?: DepositCap;
  readonly defaultRentIncreaseCap?: RentIncreaseCap;
}

export function buildLeaseLawPort(spec: LeaseLawSpec): LeaseLawPort {
  const universalClauses: readonly ClauseSpec[] = Object.freeze([
    ...spec.requiredClauses.map((c) => Object.freeze({ ...c })),
  ]);
  return {
    requiredClauses(_leaseKind: LeaseKind) {
      return universalClauses;
    },
    noticeWindowDays(reason: NoticeReason): number | null {
      const byReason = spec.noticeWindowDaysByReason[reason];
      if (typeof byReason === 'number') return byReason;
      return spec.defaultNoticeWindowDays ?? null;
    },
    depositCapMultiple(regime: DepositCapRegime): DepositCap {
      const cap = spec.depositCapByRegime[regime];
      if (cap) return Object.freeze({ ...cap });
      if (spec.defaultDepositCap) {
        return Object.freeze({ ...spec.defaultDepositCap });
      }
      return {
        citation:
          'CONFIGURE_FOR_YOUR_JURISDICTION: deposit cap not configured for regime.',
      };
    },
    rentIncreaseCap(regime: DepositCapRegime): RentIncreaseCap {
      const cap = spec.rentIncreaseCapByRegime[regime];
      if (cap) return Object.freeze({ ...cap });
      if (spec.defaultRentIncreaseCap) {
        return Object.freeze({ ...spec.defaultRentIncreaseCap });
      }
      return {
        citation:
          'CONFIGURE_FOR_YOUR_JURISDICTION: rent-increase cap not configured.',
      };
    },
  };
}

/**
 * Tenant-screening port for plugins that reference a bureau but have no
 * live adapter configured — returns a stubbed result.
 */
export function buildStubScreeningPort(
  bureauId: string
): TenantScreeningPort {
  return {
    async lookupBureau(_identityDocument, _country, _consentToken) {
      return buildStubBureauResult(bureauId);
    },
  };
}
