/**
 * TaxRegimePort — rental-income withholding tax contract.
 *
 * Every country plugin declares how withholding is calculated for rent
 * received, independent of currency. Rates MUST come from well-known
 * public sources; unknown jurisdictions MUST return a structured
 * "CONFIGURE_FOR_YOUR_JURISDICTION" stub — NEVER invent a rate.
 *
 * All money is expressed in minor units (e.g. cents) to avoid float drift.
 * The returned `withholdingMinorUnits` is a non-negative integer.
 */

import type { CurrencyCode } from '../core/types.js';

/**
 * Canonical billing period descriptor. `kind` distinguishes monthly from
 * annual regimes because some jurisdictions prorate quarterly.
 */
export interface TaxPeriod {
  /** 'month' | 'quarter' | 'year' — selects prorating behaviour. */
  readonly kind: 'month' | 'quarter' | 'year';
  /** Four-digit calendar year. */
  readonly year: number;
  /** 1-indexed month (1-12). Required for kind='month'. */
  readonly month?: number;
  /** 1-indexed quarter (1-4). Required for kind='quarter'. */
  readonly quarter?: number;
}

export interface WithholdingResult {
  /** Amount to withhold in minor units, non-negative integer. */
  readonly withholdingMinorUnits: number;
  /** Regulator reference / code (e.g. 'KRA-MRI', 'HMRC-NRL', 'IRS-1099'). */
  readonly regulatorRef: string;
  /**
   * Human-readable note about the rate applied — always emitted so downstream
   * UI can surface why the number looks the way it does.
   */
  readonly rateNote: string;
  /**
   * Set to `true` when this jurisdiction has no programmed rate. Callers
   * SHOULD block auto-disbursement and ask the landlord to configure.
   */
  readonly requiresManualConfiguration?: boolean;
}

export interface TaxRegimePort {
  /**
   * Compute withholding for gross rent received during `period`.
   *
   * Contract:
   *  - `grossRentMinorUnits` must be a non-negative integer.
   *  - Rounding is half-away-from-zero to a whole minor unit.
   *  - Returning `withholdingMinorUnits: 0` is valid (e.g. US federal).
   *  - Implementations MUST NOT throw on unknown inputs — return a stub
   *    with `requiresManualConfiguration: true` instead.
   */
  calculateWithholding(
    grossRentMinorUnits: number,
    currency: CurrencyCode,
    period: TaxPeriod
  ): WithholdingResult;
}

/**
 * Default implementation — used when a country plugin does not ship its own.
 * Returns a zero-withholding result with an explicit "configure" note so no
 * hot-path ever crashes on an unimplemented jurisdiction.
 */
export const DEFAULT_TAX_REGIME: TaxRegimePort = {
  calculateWithholding(grossRentMinorUnits, _currency, _period) {
    if (!Number.isInteger(grossRentMinorUnits) || grossRentMinorUnits < 0) {
      return {
        withholdingMinorUnits: 0,
        regulatorRef: 'GENERIC',
        rateNote: 'Invalid gross rent input — no withholding computed.',
        requiresManualConfiguration: true,
      };
    }
    return {
      withholdingMinorUnits: 0,
      regulatorRef: 'GENERIC',
      rateNote:
        'CONFIGURE_FOR_YOUR_JURISDICTION: no withholding regime is configured ' +
        'for this country. Consult a tax advisor and register a TaxRegimePort.',
      requiresManualConfiguration: true,
    };
  },
};

/**
 * Helper used by country plugins that apply a single flat rate on gross
 * rent. Kept in the port file so every plugin uses the same rounding.
 */
export function flatRateWithholding(
  grossRentMinorUnits: number,
  ratePct: number,
  regulatorRef: string,
  rateNote: string
): WithholdingResult {
  const safeGross = Number.isInteger(grossRentMinorUnits)
    ? Math.max(0, grossRentMinorUnits)
    : 0;
  const raw = (safeGross * ratePct) / 100;
  const rounded = Math.round(raw);
  return {
    withholdingMinorUnits: rounded,
    regulatorRef,
    rateNote,
  };
}
