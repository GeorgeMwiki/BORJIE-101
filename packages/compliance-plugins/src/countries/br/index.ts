/**
 * Brazil (BR) — IRPF withholding on mineral proceeds + CFEM royalty.
 *
 * Source: Lei 7.713/88 — proceeds paid to non-residents are withheld at
 * 15% (or 25% in tax-haven scenarios). CFEM (Compensação Financeira pela
 * Exploração de Recursos Minerais) is a separate mineral royalty collected
 * by the ANM. Plugin defaults to 15% withholding for non-resident operators
 * and flags operator configuration for residents.
 */

import { buildPhoneNormalizer } from '../../core/phone.js';
import type { CountryPlugin } from '../../core/types.js';
import {
  buildFlatWithholding,
  buildMiningLawPort,
  buildPaymentRailsPort,
  buildStubScreeningPort,
} from '../_shared.js';
import type { ExtendedCountryProfile } from '../types.js';

const brazilCore: CountryPlugin = {
  countryCode: 'BR',
  countryName: 'Brazil',
  currencyCode: 'BRL',
  currencySymbol: 'R$',
  phoneCountryCode: '55',
  normalizePhone: buildPhoneNormalizer({ dialingCode: '55', trunkPrefix: '0' }),
  kycProviders: [
    {
      id: 'cpf',
      name: 'CPF (Cadastro de Pessoas Físicas)',
      kind: 'national-id',
      envPrefix: 'BR_CPF',
      idFormat: /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/,
    },
    {
      id: 'cnpj',
      name: 'CNPJ (Cadastro Nacional da Pessoa Jurídica)',
      kind: 'business-registry',
      envPrefix: 'BR_CNPJ',
      idFormat: /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/,
    },
    {
      id: 'receita_federal',
      name: 'Receita Federal',
      kind: 'tax-authority',
      envPrefix: 'RECEITA_FEDERAL',
    },
    {
      id: 'serasa',
      name: 'Serasa Experian',
      kind: 'credit-bureau',
      envPrefix: 'SERASA',
    },
  ],
  paymentGateways: [
    { id: 'pix', name: 'Pix', kind: 'bank-rail', envPrefix: 'PIX' },
    { id: 'stripe', name: 'Stripe', kind: 'card', envPrefix: 'STRIPE' },
    {
      id: 'mercadopago',
      name: 'Mercado Pago',
      kind: 'card',
      envPrefix: 'MERCADOPAGO',
    },
  ],
  compliance: {
    minBondMonths: 0,
    maxBondMonths: 3, // Lei 8.245/91 § 38
    noticePeriodDays: 30,
    minimumTermMonths: 12,
    subSupplyConsent: 'consent-required',
    lateFeeCapRate: 0.1,
    bondReturnDays: 30,
  },
  documentTemplates: [
    {
      id: 'offtake-agreement',
      name: 'Contrato de Fornecimento Mineral (BR Mineral Offtake)',
      templatePath: 'br/offtake-agreement.hbs',
      locale: 'pt-BR',
    },
  ],
};

/** CPF check-digit validation. */
function cpfValid(raw: string): boolean {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 111.111.111-11 etc.
  const calcDigit = (slice: string, start: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (start - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  const d1 = calcDigit(digits.slice(0, 9), 10);
  const d2 = calcDigit(digits.slice(0, 10), 11);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

export const brazilProfile: ExtendedCountryProfile = {
  plugin: brazilCore,
  languages: ['pt', 'en'],
  dateFormat: 'DD/MM/YYYY',
  minorUnitDivisor: 100,
  nationalIdValidator: {
    id: 'br-cpf',
    label: 'CPF',
    validate(raw) {
      if (!raw || raw.trim().length === 0) {
        return { status: 'invalid', ruleId: 'br-cpf', note: 'CPF is empty' };
      }
      if (!/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(raw.trim())) {
        return {
          status: 'invalid',
          ruleId: 'br-cpf',
          note: 'CPF must be 11 digits (formatted 123.456.789-10).',
          piiSensitive: true,
        };
      }
      if (!cpfValid(raw)) {
        return {
          status: 'invalid',
          ruleId: 'br-cpf-checkdigit',
          note: 'CPF failed check-digit validation.',
          piiSensitive: true,
        };
      }
      return {
        status: 'valid',
        ruleId: 'br-cpf-checkdigit',
        piiSensitive: true,
      };
    },
  },
  taxRegime: buildFlatWithholding(
    15,
    'BR-RFB-Lei-7713',
    'IRPF withholding on non-resident mineral proceeds: 15% (Lei 7.713/88). CFEM royalty (ANM) applies separately — configure per operator.'
  ),
  paymentRails: buildPaymentRailsPort([
    {
      id: 'pix',
      label: 'Pix (BACEN)',
      kind: 'bank-transfer',
      currency: 'BRL',
      minAmountMinorUnits: 1,
      settlementLagHours: 0,
      integrationAdapterHint: 'PIX',
      supportsCollection: true,
      supportsDisbursement: true,
    },
    {
      id: 'stripe',
      label: 'Stripe (Card)',
      kind: 'card',
      currency: 'BRL',
      minAmountMinorUnits: 50,
      settlementLagHours: 48,
      integrationAdapterHint: 'STRIPE',
      supportsCollection: true,
      supportsDisbursement: false,
    },
    {
      id: 'mercadopago',
      label: 'Mercado Pago',
      kind: 'wallet',
      currency: 'BRL',
      minAmountMinorUnits: 100,
      settlementLagHours: 48,
      integrationAdapterHint: 'MERCADOPAGO',
      supportsCollection: true,
      supportsDisbursement: false,
    },
  ]),
  miningLaw: buildMiningLawPort({
    requiredClauses: [
      {
        id: 'br-codigo-mineracao',
        label: 'Supply governed by the Código de Mineração (Decreto-Lei 227/1967)',
        mandatory: true,
        citation: 'Decreto-Lei 227/1967; CFEM (Lei 8.001/90)',
      },
    ],
    noticeWindowDaysByReason: {
      'licence-expiry': 30,
      'royalty-default': 15,
    },
    bondCapByRegime: {
      'artisanal-standard': {
        maxMonthsOfRoyalty: 3,
        citation: 'Código de Mineração — garantia (≈ 3 months royalty)',
      },
    },
    royaltyEscalationCapByRegime: {
      'artisanal-standard': {
        indexedTo: 'LOCAL_INDEX',
        citation: 'IGP-M / IPCA indexation annually (agreement-defined).',
      },
    },
    defaultNoticeWindowDays: 30,
  }),
  counterpartyScreening: buildStubScreeningPort('SERASA_BR'),
};
