/**
 * Port-aware plugin resolver.
 *
 * `resolvePlugin(countryCode)` guarantees a plugin with EVERY port
 * populated — either the country's own implementation or a safe DEFAULT_*
 * fallback. Callers may therefore access `plugin.taxRegime.foo(...)`
 * without null checks.
 *
 * `DEFAULT_PLUGIN` is the synthetic fallback used when a tenant has no
 * country set. It carries USD / English / 0% withholding and a "manual"
 * payment rail.
 */

import { getCountryPlugin, countryPluginRegistry } from './index.js';
import type { CountryPlugin, PhoneNormalizer } from './core/types.js';
import {
  DEFAULT_TAX_REGIME,
  DEFAULT_TAX_FILING,
  DEFAULT_PAYMENT_RAIL_PORT,
  DEFAULT_TENANT_SCREENING,
  DEFAULT_LEASE_LAW,
  type TaxRegimePort,
  type TaxFilingPort,
  type PaymentRailPort,
  type TenantScreeningPort,
  type LeaseLawPort,
} from './ports/index.js';

/** A `CountryPlugin` with every port guaranteed non-optional. */
export interface ResolvedCountryPlugin extends CountryPlugin {
  readonly taxRegime: TaxRegimePort;
  readonly taxFiling: TaxFilingPort;
  readonly paymentRails: PaymentRailPort;
  readonly tenantScreening: TenantScreeningPort;
  readonly leaseLaw: LeaseLawPort;
}

/**
 * Synthetic default used when the tenant has no country selected.
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
    minDepositMonths: 1,
    maxDepositMonths: 2,
    noticePeriodDays: 30,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required' as const,
    lateFeeCapRate: null,
    depositReturnDays: 30,
  }),
  documentTemplates: Object.freeze([]),
  taxRegime: DEFAULT_TAX_REGIME,
  taxFiling: DEFAULT_TAX_FILING,
  paymentRails: DEFAULT_PAYMENT_RAIL_PORT,
  tenantScreening: DEFAULT_TENANT_SCREENING,
  leaseLaw: DEFAULT_LEASE_LAW,
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
    tenantScreening: base.tenantScreening ?? DEFAULT_TENANT_SCREENING,
    leaseLaw: base.leaseLaw ?? DEFAULT_LEASE_LAW,
  }) as ResolvedCountryPlugin;
}

/** Country-port coverage snapshot — one row per country, one cell per port. */
export interface PortCoverageRow {
  readonly countryCode: string;
  readonly taxRegime: boolean;
  readonly taxFiling: boolean;
  readonly paymentRails: boolean;
  readonly tenantScreening: boolean;
  readonly leaseLaw: boolean;
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
        tenantScreening: Boolean(plugin.tenantScreening),
        leaseLaw: Boolean(plugin.leaseLaw),
      })
    )
  );
}
