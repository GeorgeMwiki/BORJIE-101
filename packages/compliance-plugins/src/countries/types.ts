/**
 * Extended country-plugin shape consumed by the `countries/` subtree.
 *
 * The original `CountryPlugin` (in `../core/types.ts`) is unchanged — it
 * ships currency, phone, KYC, gateways, compliance, and document templates.
 * This file adds the extra facets the global-coverage wave needs without
 * touching the canonical CountryPlugin contract PhZ-GLOBAL owns:
 *
 *   - `languages`     — BCP-47 list (first = primary)
 *   - `dateFormat`    — locale-appropriate format string
 *   - `minorUnitDivisor` — currencies where minor units are 1 (JPY, KRW) vs 100
 *   - `nationalIdValidator` — per-country ID pattern matcher
 *   - `taxRegime`     — TaxRegimePort implementation
 *   - `paymentRails`  — PaymentRailPort implementation
 *   - `leaseLaw`      — LeaseLawPort implementation
 *   - `tenantScreening` — TenantScreeningPort implementation
 *
 * Every field has a sensible default on the GLOBAL fallback in `index.ts`,
 * so unlisted jurisdictions still work end-to-end.
 */

import type { CountryPlugin } from '../core/types.js';
import type { LeaseLawPort } from '../ports/lease-law.port.js';
import type { PaymentRailPort } from '../ports/payment-rail.port.js';
import type { TaxRegimePort } from '../ports/tax-regime.port.js';
import type { TenantScreeningPort } from '../ports/tenant-screening.port.js';

/** Validation verdict for a national ID value. */
export type IdValidationStatus =
  | 'valid'
  | 'invalid'
  | 'validation-unavailable';

export interface IdValidationResult {
  readonly status: IdValidationStatus;
  /** The pattern / rule that matched, if any — useful for audit. */
  readonly ruleId?: string;
  /** Free-text note surfaced to the landlord when status != 'valid'. */
  readonly note?: string;
  /**
   * True when the value is PII-sensitive under local law and MUST NOT be
   * logged or cached in plaintext. Korea RRN, Nigerian NIN, and US SSN are
   * good examples.
   */
  readonly piiSensitive?: boolean;
}

export interface NationalIdValidator {
  /** Stable validator ID (e.g. 'de-personalausweis', 'kr-rrn'). */
  readonly id: string;
  /** Human-readable name. */
  readonly label: string;
  /** Pure — no I/O, no throw. */
  validate(raw: string): IdValidationResult;
}

/** Subset of ISO-8601 date shapes supported for display. */
export type DateFormat =
  | 'YYYY-MM-DD'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'DD.MM.YYYY'
  | 'YYYY/MM/DD';

export interface ExtendedCountryProfile {
  /** The canonical plugin — shared with the core registry. */
  readonly plugin: CountryPlugin;
  /** BCP-47 tags, first = primary (e.g. ['de', 'en']). */
  readonly languages: readonly string[];
  /** Display date format for the primary locale. */
  readonly dateFormat: DateFormat;
  /** 1 for zero-decimal currencies (JPY, KRW), 100 otherwise. */
  readonly minorUnitDivisor: 1 | 100 | 1000;
  /** Optional ID validator. `null` when the country has no public format. */
  readonly nationalIdValidator: NationalIdValidator | null;
  /** Port implementations. */
  readonly taxRegime: TaxRegimePort;
  readonly paymentRails: PaymentRailPort;
  readonly leaseLaw: LeaseLawPort;
  readonly tenantScreening: TenantScreeningPort;
}

/** Build a validator that dispatches through a simple RegExp. */
export function buildRegexIdValidator(params: {
  id: string;
  label: string;
  pattern: RegExp;
  piiSensitive?: boolean;
  failureNote?: string;
}): NationalIdValidator {
  return {
    id: params.id,
    label: params.label,
    validate(raw: string): IdValidationResult {
      const withPii = <T extends object>(r: T): T =>
        params.piiSensitive === undefined
          ? r
          : ({ ...r, piiSensitive: params.piiSensitive } as T);
      if (!raw || raw.trim().length === 0) {
        return withPii({
          status: 'invalid',
          ruleId: params.id,
          note: 'ID value is empty',
        });
      }
      const trimmed = raw.trim();
      if (params.pattern.test(trimmed)) {
        return withPii({ status: 'valid', ruleId: params.id });
      }
      return withPii({
        status: 'invalid',
        ruleId: params.id,
        note:
          params.failureNote ??
          `Value does not match expected format for ${params.label}.`,
      });
    },
  };
}
