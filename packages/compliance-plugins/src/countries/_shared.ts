/**
 * Shared helpers used across every country plugin in `countries/`.
 *
 * - `buildFlatWithholding` wires a country to `flatRateWithholding` once.
 * - `stubWithholding` gives plugins a zero-rate port whose `rateNote`
 *   makes it clear the rate is operator-configurable.
 * - `buildPaymentRailsPort` accepts a pre-frozen list and returns the port.
 * - `buildMiningLawPort` accepts a snapshot and returns the port.
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
  BondCap,
  BondCapRegime,
  OperationKind,
  MiningLawPort,
  NoticeReason,
  RoyaltyEscalationCap,
} from '../ports/mining-law.port.js';
import {
  buildStubBureauResult,
  type CounterpartyScreeningPort,
} from '../ports/counterparty-screening.port.js';

export function buildFlatWithholding(
  ratePct: number,
  regulatorRef: string,
  rateNote: string
): TaxRegimePort {
  return {
    calculateWithholding(grossValueMinorUnits) {
      return flatRateWithholding(
        grossValueMinorUnits,
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

export interface MiningLawSpec {
  readonly requiredClauses: readonly ClauseSpec[];
  readonly noticeWindowDaysByReason: Readonly<
    Partial<Record<NoticeReason, number>>
  >;
  readonly bondCapByRegime: Readonly<
    Partial<Record<BondCapRegime, BondCap>>
  >;
  readonly royaltyEscalationCapByRegime: Readonly<
    Partial<Record<BondCapRegime, RoyaltyEscalationCap>>
  >;
  readonly defaultNoticeWindowDays?: number;
  readonly defaultBondCap?: BondCap;
  readonly defaultRoyaltyEscalationCap?: RoyaltyEscalationCap;
}

export function buildMiningLawPort(spec: MiningLawSpec): MiningLawPort {
  const universalClauses: readonly ClauseSpec[] = Object.freeze([
    ...spec.requiredClauses.map((c) => Object.freeze({ ...c })),
  ]);
  return {
    requiredClauses(_operationKind: OperationKind) {
      return universalClauses;
    },
    noticeWindowDays(reason: NoticeReason): number | null {
      const byReason = spec.noticeWindowDaysByReason[reason];
      if (typeof byReason === 'number') return byReason;
      return spec.defaultNoticeWindowDays ?? null;
    },
    bondCapMultiple(regime: BondCapRegime): BondCap {
      const cap = spec.bondCapByRegime[regime];
      if (cap) return Object.freeze({ ...cap });
      if (spec.defaultBondCap) {
        return Object.freeze({ ...spec.defaultBondCap });
      }
      return {
        citation:
          'CONFIGURE_FOR_YOUR_JURISDICTION: performance-bond cap not configured for regime.',
      };
    },
    royaltyEscalationCap(regime: BondCapRegime): RoyaltyEscalationCap {
      const cap = spec.royaltyEscalationCapByRegime[regime];
      if (cap) return Object.freeze({ ...cap });
      if (spec.defaultRoyaltyEscalationCap) {
        return Object.freeze({ ...spec.defaultRoyaltyEscalationCap });
      }
      return {
        citation:
          'CONFIGURE_FOR_YOUR_JURISDICTION: royalty-escalation cap not configured.',
      };
    },
  };
}

/**
 * Counterparty-screening port for plugins that reference a bureau but have no
 * live adapter configured — returns a stubbed result.
 */
export function buildStubScreeningPort(
  bureauId: string
): CounterpartyScreeningPort {
  return {
    async lookupBureau(_identityDocument, _country, _consentToken) {
      return buildStubBureauResult(bureauId);
    },
  };
}
