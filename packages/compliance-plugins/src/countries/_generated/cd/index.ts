/**
 * Congo, Democratic Republic of the (CD) — AUTO-GENERATED scaffold plugin.
 *
 * Generated on 2026-04-21 by `scripts/generate-country-scaffolds.ts`.
 * Do not hand-edit — rerun the generator. To promote this country to a
 * full-fidelity plugin, COPY this file to `../cd/index.ts`,
 * delete this scaffold, and wire the real royalty + mining-law sources.
 *
 * Scaffold behaviour:
 *   - Currency + language + dateFormat from public ISO sources.
 *   - TaxRegimePort: zero-rate stub flagged `requiresManualConfiguration`.
 *   - PaymentRailPort: generic Stripe + bank + manual.
 *   - MiningLawPort: DEFAULT_MINING_LAW.
 *   - CounterpartyScreeningPort: DEFAULT_COUNTERPARTY_SCREENING.
 *   - TaxFilingPort: DEFAULT_TAX_FILING.
 */

import { buildPhoneNormalizer } from '../../../core/phone.js';
import type { CountryPlugin } from '../../../core/types.js';
import {
  DEFAULT_MINING_LAW,
  DEFAULT_COUNTERPARTY_SCREENING,
} from '../../../ports/index.js';
import {
  buildPaymentRailsPort,
  stubWithholding,
} from '../../_shared.js';
import type { ExtendedCountryProfile } from '../../types.js';

const congoDemocraticRepublicOfTheCore: CountryPlugin = {
  countryCode: 'CD',
  countryName: 'Congo, Democratic Republic of the',
  currencyCode: 'CDF',
  currencySymbol: 'FC',
  phoneCountryCode: '243',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '243', trunkPrefix: '0' }),
  kycProviders: [],
  paymentGateways: [
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    { id: 'bank_transfer', name: 'Bank transfer', kind: 'bank-rail', envPrefix: 'BANK_TRANSFER' },
    { id: 'manual', name: 'Manual reconciliation', kind: 'bank-rail', envPrefix: 'MANUAL' },
  ],
  compliance: {
    minBondMonths: 0,
    maxBondMonths: 2,
    noticePeriodDays: 30,
    minimumTermMonths: 1,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: null,
    bondReturnDays: 30,
  },
  documentTemplates: [],
};

export const congoDemocraticRepublicOfTheScaffoldProfile: ExtendedCountryProfile = {
  plugin: congoDemocraticRepublicOfTheCore,
  languages: ['fr'],
  dateFormat: 'DD/MM/YYYY' as ExtendedCountryProfile['dateFormat'],
  minorUnitDivisor: 100,
  nationalIdValidator: null,
  taxRegime: stubWithholding(
    'CD-MANUAL-CONFIG',
    'CONFIGURE_FOR_YOUR_JURISDICTION: Congo, Democratic Republic of the has no programmed mineral-royalty / withholding rate. Consult local mining-tax counsel and promote this scaffold (see countries/_generated/README.md).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'stripe',
      label: 'Stripe',
      kind: 'card',
      currency: 'CDF',
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
      currency: 'CDF',
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
      currency: 'CDF',
      minAmountMinorUnits: 1,
      settlementLagHours: 72,
      integrationAdapterHint: null,
      supportsCollection: true,
      supportsDisbursement: true,
    },
  ]),
  miningLaw: DEFAULT_MINING_LAW,
  counterpartyScreening: DEFAULT_COUNTERPARTY_SCREENING,
};

export const congoDemocraticRepublicOfTheScaffoldMetadata = Object.freeze({
  status: 'scaffold' as const,
  generatedAt: '2026-04-21',
  promotionGuide:
    'To replace this scaffold with full-fidelity data, copy to ../cd/index.ts and implement real royalty rates + mining-law from local sources. See _generated/README.md.',
});
