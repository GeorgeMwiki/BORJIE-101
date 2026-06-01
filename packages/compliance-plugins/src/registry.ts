/**
 * Port-aware plugin resolver.
 *
 * `resolvePlugin(countryCode)` guarantees a plugin with EVERY port
 * populated — either the country's own implementation or a safe DEFAULT_*
 * fallback. Callers may therefore access `plugin.taxRegime.foo(...)`
 * without null checks.
 *
 * `DEFAULT_PLUGIN` is the synthetic fallback used when an operator has no
 * country set. It carries USD / English / 0% withholding and a "manual"
 * payment rail.
 */

import { getCountryPlugin, countryPluginRegistry } from './index.js';
import type { CountryPlugin, PhoneNormalizer } from './core/types.js';
import {
  DEFAULT_TAX_REGIME,
  DEFAULT_TAX_FILING,
  DEFAULT_PAYMENT_RAIL_PORT,
  DEFAULT_COUNTERPARTY_SCREENING,
  DEFAULT_MINING_LAW,
  type TaxRegimePort,
  type TaxFilingPort,
  type PaymentRailPort,
  type CounterpartyScreeningPort,
  type MiningLawPort,
} from './ports/index.js';

/** A `CountryPlugin` with every port guaranteed non-optional. */
export interface ResolvedCountryPlugin extends CountryPlugin {
  readonly taxRegime: TaxRegimePort;
  readonly taxFiling: TaxFilingPort;
  readonly paymentRails: PaymentRailPort;
  readonly counterpartyScreening: CounterpartyScreeningPort;
  readonly miningLaw: MiningLawPort;
}

/**
 * Synthetic default used when the operator has no country selected.
 *  - Currency: USD
 *  - Language: English
 *  - Withholding: 0% (generic note)
 *  - Rails: Stripe + manual
 */
const defaultNormalizePhone: PhoneNormalizer = (raw: string) => {
  if (!raw || raw.trim().length === 0) {
    throw new Error('normalizePhone: phone is empty');
  }
  const digits = raw.replace(/\D+/g, '');
  return `+${digits}`;
};

export const DEFAULT_PLUGIN: ResolvedCountryPlugin = Object.freeze({
  countryCode: 'XX',
  countryName: 'Unknown (default)',
  currencyCode: 'USD',
  currencySymbol: '$',
  phoneCountryCode: '',
  normalizePhone: defaultNormalizePhone,
  kycProviders: Object.freeze([]),
  paymentGateways: Object.freeze([]),
  compliance: Object.freeze({
    minBondMonths: 1,
    maxBondMonths: 2,
    noticePeriodDays: 30,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required' as const,
    lateFeeCapRate: null,
    bondReturnDays: 30,
  }),
  documentTemplates: Object.freeze([]),
  taxRegime: DEFAULT_TAX_REGIME,
  taxFiling: DEFAULT_TAX_FILING,
  paymentRails: DEFAULT_PAYMENT_RAIL_PORT,
  counterpartyScreening: DEFAULT_COUNTERPARTY_SCREENING,
  miningLaw: DEFAULT_MINING_LAW,
}) as ResolvedCountryPlugin;

/**
 * Resolve a plugin by country code, backfilling missing ports with their
 * DEFAULT_* implementations. Never throws; returns DEFAULT_PLUGIN for
 * null / empty / unknown input.
 */
export function resolvePlugin(
  countryCode: string | null | undefined
): ResolvedCountryPlugin {
  if (!countryCode || !countryCode.trim()) return DEFAULT_PLUGIN;
  const upper = countryCode.trim().toUpperCase();
  if (!countryPluginRegistry.has(upper)) {
    return DEFAULT_PLUGIN;
  }
  const base = getCountryPlugin(upper);
  return Object.freeze({
    ...base,
    taxRegime: base.taxRegime ?? DEFAULT_TAX_REGIME,
    taxFiling: base.taxFiling ?? DEFAULT_TAX_FILING,
    paymentRails: base.paymentRails ?? DEFAULT_PAYMENT_RAIL_PORT,
    counterpartyScreening: base.counterpartyScreening ?? DEFAULT_COUNTERPARTY_SCREENING,
    miningLaw: base.miningLaw ?? DEFAULT_MINING_LAW,
  }) as ResolvedCountryPlugin;
}

/** Country-port coverage snapshot — one row per country, one cell per port. */
export interface PortCoverageRow {
  readonly countryCode: string;
  readonly taxRegime: boolean;
  readonly taxFiling: boolean;
  readonly paymentRails: boolean;
  readonly counterpartyScreening: boolean;
  readonly miningLaw: boolean;
}

/** Produce the coverage matrix used by the compliance dashboard + tests. */
export function getPortCoverageMatrix(): readonly PortCoverageRow[] {
  return Object.freeze(
    countryPluginRegistry.all().map((plugin) =>
      Object.freeze({
        countryCode: plugin.countryCode,
        taxRegime: Boolean(plugin.taxRegime),
        taxFiling: Boolean(plugin.taxFiling),
        paymentRails: Boolean(plugin.paymentRails),
        counterpartyScreening: Boolean(plugin.counterpartyScreening),
        miningLaw: Boolean(plugin.miningLaw),
      })
    )
  );
}
