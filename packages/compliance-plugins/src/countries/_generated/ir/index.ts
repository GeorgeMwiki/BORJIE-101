/**
 * Iran, Islamic Republic of (IR) — AUTO-GENERATED scaffold plugin.
 *
 * Generated on 2026-04-21 by `scripts/generate-country-scaffolds.ts`.
 * Do not hand-edit — rerun the generator. To promote this country to a
 * full-fidelity plugin, COPY this file to `../ir/index.ts`,
 * delete this scaffold, and wire the real tax + lease-law sources.
 *
 * Scaffold behaviour:
 *   - Currency + language + dateFormat from public ISO sources.
 *   - TaxRegimePort: zero-rate stub flagged `requiresManualConfiguration`.
 *   - PaymentRailPort: generic Stripe + bank + manual.
 *   - LeaseLawPort: DEFAULT_LEASE_LAW.
 *   - TenantScreeningPort: DEFAULT_TENANT_SCREENING.
 *   - TaxFilingPort: DEFAULT_TAX_FILING.
 */

import { buildPhoneNormalizer } from '../../../core/phone.js';
import type { CountryPlugin } from '../../../core/types.js';
import {
  DEFAULT_LEASE_LAW,
  DEFAULT_TENANT_SCREENING,
} from '../../../ports/index.js';
import {
  buildPaymentRailsPort,
  stubWithholding,
} from '../../_shared.js';
import type { ExtendedCountryProfile } from '../../types.js';

const iranIslamicRepublicOfCore: CountryPlugin = {
  countryCode: 'IR',
  countryName: 'Iran, Islamic Republic of',
  currencyCode: 'IRR',
  currencySymbol: '﷼',
  phoneCountryCode: '98',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '98', trunkPrefix: '0' }),
  kycProviders: [],
  paymentGateways: [
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    { id: 'bank_transfer', name: 'Bank transfer', kind: 'bank-rail', envPrefix: 'BANK_TRANSFER' },
    { id: 'manual', name: 'Manual reconciliation', kind: 'bank-rail', envPrefix: 'MANUAL' },
  ],
  compliance: {
    minDepositMonths: 0,
    maxDepositMonths: 2,
    noticePeriodDays: 30,
    minimumLeaseMonths: 1,
    subleaseConsent: 'consent-required',
    lateFeeCapRate: null,
    depositReturnDays: 30,
  },
  documentTemplates: [],
};

export const iranIslamicRepublicOfScaffoldProfile: ExtendedCountryProfile = {
  plugin: iranIslamicRepublicOfCore,
  languages: ['fa'],
  dateFormat: 'YYYY/MM/DD' as ExtendedCountryProfile['dateFormat'],
  minorUnitDivisor: 100,
  nationalIdValidator: null,
  taxRegime: stubWithholding(
    'IR-MANUAL-CONFIG',
    'CONFIGURE_FOR_YOUR_JURISDICTION: Iran, Islamic Republic of has no programmed withholding rate. Consult local tax counsel and promote this scaffold (see countries/_generated/README.md).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'stripe',
      label: 'Stripe',
      kind: 'card',
      currency: 'IRR',
      minAmountMinorUnits: 50,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'bank_transfer',
      label: 'Bank transfer',
      kind: 'bank-transfer',
      currency: 'IRR',
      minAmountMinorUnits: 1,
      settlementLagHours: 24,
      integrationAdapterHint: 'GENERIC',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'manual',
      label: 'Manual reconciliation',
      kind: 'manual',
      currency: 'IRR',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: null,
      supportsCollection: true,
      supportsDisbursement: true,
    },
  ]),
  leaseLaw: DEFAULT_LEASE_LAW,
  tenantScreening: DEFAULT_TENANT_SCREENING,
};

export const iranIslamicRepublicOfScaffoldMetadata = Object.freeze({
  status: 'scaffold' as const,
  generatedAt: '2026-04-21',
  promotionGuide:
    'To replace this scaffold with full-fidelity data, copy to ../ir/index.ts and implement real tax rates + lease-law from local sources. See _generated/README.md.',
});
