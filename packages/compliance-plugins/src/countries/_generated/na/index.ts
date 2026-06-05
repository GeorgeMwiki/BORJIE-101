/**
 * Namibia (NA) — AUTO-GENERATED scaffold plugin.
 *
 * Generated on 2026-04-21 by `scripts/generate-country-scaffolds.ts`.
 * Do not hand-edit — rerun the generator. To promote this country to a
 * full-fidelity plugin, COPY this file to `../na/index.ts`,
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

const namibiaCore: CountryPlugin = {
  countryCode: 'NA',
  countryName: 'Namibia',
  currencyCode: 'NAD',
  currencySymbol: '$',
  phoneCountryCode: '264',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '264', trunkPrefix: '0' }),
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

export const namibiaScaffoldProfile: ExtendedCountryProfile = {
  plugin: namibiaCore,
  languages: ['en'],
  dateFormat: 'DD/MM/YYYY' as ExtendedCountryProfile['dateFormat'],
  minorUnitDivisor: 100,
  nationalIdValidator: null,
  taxRegime: stubWithholding(
    'NA-MANUAL-CONFIG',
    'CONFIGURE_FOR_YOUR_JURISDICTION: Namibia has no programmed mineral-royalty / withholding rate. Consult local mining-tax counsel and promote this scaffold (see countries/_generated/README.md).'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'stripe',
      label: 'Stripe',
      kind: 'card',
      currency: 'NAD',
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
      currency: 'NAD',
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
      currency: 'NAD',
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

export const namibiaScaffoldMetadata = Object.freeze({
  status: 'scaffold' as const,
  generatedAt: '2026-04-21',
  promotionGuide:
    'To replace this scaffold with full-fidelity data, copy to ../na/index.ts and implement real royalty rates + mining-law from local sources. See _generated/README.md.',
});
