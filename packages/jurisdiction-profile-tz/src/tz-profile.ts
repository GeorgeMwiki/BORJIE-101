/**
 * Tanzania jurisdiction profile — launch beachhead (Wave UNIV-1).
 *
 * Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md §1, §7
 * Lock: Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md
 *
 * Every field carries a primary citation; the `profile_source_*` triple
 * pins the snapshot of TZ law captured here.
 *
 * Quiet hours default 18:00–06:00 — matches the FOUNDER_LOCKED platform
 * default and overrides nothing. Future jurisdictions may narrow this
 * window (Ramadan / Iftar profiles, etc.) by setting a different value.
 */

import {
  type JurisdictionProfile,
  type RegulatorDefinition,
  linkRegistryRow,
} from '@borjie/jurisdiction-profiles';

// ---------------------------------------------------------------------------
// TZ profile
// ---------------------------------------------------------------------------

export const tzProfile: JurisdictionProfile = {
  id: 'tz',
  iso_country: 'TZ',
  display_name: 'United Republic of Tanzania',
  data_protection_laws: ['tz_dpa_2022'],
  data_residency_kind: 'strict-in-country',
  breach_deadline_hours: 72,
  rtbf_cascade_scope: 'tz-dpa-broad',
  currency_code: 'TZS',
  phone_e164_cc: '255',
  // E.164 §5.5 — TZ national significant number = 9 digits after country code
  phone_e164_pattern: '^[67]\\d{8}$',
  address_format: {
    lines: [
      'street_or_po_box',
      'ward',
      'district',
      'region',
      'postal_code',
      'country',
    ],
    required: ['region', 'district', 'ward'],
    postal_code_pattern: '^\\d{5}$',
  },
  holiday_calendar_key: 'TZ',
  // Working week — Monday (ISO 1) through Friday (ISO 5)
  working_week: [1, 2, 3, 4, 5],
  timezone_default: 'Africa/Dar_es_Salaam',
  // FOUNDER_LOCKED quiet-hours default 18:00–06:00
  quiet_hours_default: { start: '18:00', end: '06:00' },
  tax_matrix: {
    vat_standard_rate: 0.18,
    vat_zero_rated: ['exports', 'mining-exports'],
    paye_brackets: [
      { from: 0, to: 270000, rate: 0 },
      { from: 270000, to: 520000, rate: 0.08 },
      { from: 520000, to: 760000, rate: 0.20 },
      { from: 760000, to: 1000000, rate: 0.25 },
      { from: 1000000, to: null, rate: 0.30 },
    ],
    // Mining royalty headline rate by commodity class — full schedule
    // lives in the Mining Act 2010 + Tumemadini royalty page (cited in
    // tz-tumemadini below). These are headline rates only.
    mining_royalties: {
      gold: 0.06,
      diamond: 0.05,
      gemstones: 0.06,
      industrial_minerals: 0.03,
      coal: 0.03,
    },
  },
  language_pack_codes: ['sw', 'en'],
  vertical_profile_codes: ['mining-tz'],
  profile_source_url: 'https://www.pdpc.go.tz/media/media/THE_PERSONAL_DATA_PROTECTION_ACT.pdf',
  profile_source_title: 'The Personal Data Protection Act 2022 — Personal Data Protection Commission (TZ)',
  profile_source_date: '2022-11-04',
  audit_hash: linkRegistryRow({ kind: 'profile', id: 'tz' }),
};

// ---------------------------------------------------------------------------
// TZ Regulators — TRA + Tumemadini + NEMC + BoT
// ---------------------------------------------------------------------------

export const tzTra: RegulatorDefinition = {
  id: 'tz-tra',
  jurisdiction_id: 'tz',
  display_name: 'Tanzania Revenue Authority (TRA)',
  domain: 'tax',
  filing_kinds: [
    {
      kind: 'vat-return',
      cadence: 'monthly',
      due_day_of_month: 20,
      late_penalty: 'TZS 75,000 + 2% per month on tax due (TRA VAT)',
      source_url: 'https://www.tra.go.tz/index.php/value-added-tax-vat/98-vat-returns',
    },
    {
      kind: 'paye-return',
      cadence: 'monthly',
      due_day_of_month: 7,
      late_penalty: 'TZS 75,000 + 1.5% per month (Income Tax Act)',
      source_url: 'https://www.tra.go.tz/index.php/pay-as-you-earn-paye',
    },
    {
      kind: 'corporate-income-tax-return',
      cadence: 'annual',
      due_pattern: '6 months after year-end',
      late_penalty: '5% of tax due + 2% per month interest',
      source_url: 'https://www.tra.go.tz/index.php/corporate-tax-cit',
    },
    {
      kind: 'digital-services-tax',
      cadence: 'monthly',
      due_day_of_month: 20,
      source_url: 'https://www.tra.go.tz/index.php/digital-service-tax',
    },
  ],
  due_pattern: {
    working_week_aware: true,
    holiday_shift_rule: 'next-working-day',
  },
  api_endpoint: 'https://efiling.tra.go.tz/',
  audit_hash: linkRegistryRow({ kind: 'regulator', id: 'tz-tra' }),
};

export const tzTumemadini: RegulatorDefinition = {
  id: 'tz-tumemadini',
  jurisdiction_id: 'tz',
  display_name: 'Mining Commission (Tume ya Madini)',
  domain: 'mining',
  filing_kinds: [
    {
      kind: 'royalty-payment',
      cadence: 'per-transaction',
      due_pattern: 'before-clearance',
      late_penalty: 'Mining Act §87 — interest at prevailing T-bill rate + penalty',
      source_url: 'https://www.tumemadini.go.tz/mineral-trade/mineral-royalties-and-inspection-fees-rates/',
    },
    {
      kind: 'annual-mining-report',
      cadence: 'annual',
      due_pattern: 'Q1-of-following-year',
      source_url: 'https://www.tumemadini.go.tz/mining/annual-reports/',
    },
    {
      kind: 'mineral-trading-licence-renewal',
      cadence: 'annual',
      due_pattern: 'anniversary-of-issue',
      source_url: 'https://www.tumemadini.go.tz/licensing/',
    },
    {
      kind: 'inspection-fee',
      cadence: 'per-transaction',
      due_pattern: 'pre-export-inspection',
      source_url: 'https://www.tumemadini.go.tz/mineral-trade/mineral-royalties-and-inspection-fees-rates/',
    },
  ],
  due_pattern: {
    working_week_aware: true,
    holiday_shift_rule: 'next-working-day',
  },
  audit_hash: linkRegistryRow({ kind: 'regulator', id: 'tz-tumemadini' }),
};

export const tzNemc: RegulatorDefinition = {
  id: 'tz-nemc',
  jurisdiction_id: 'tz',
  display_name: 'National Environment Management Council (NEMC)',
  domain: 'environment',
  filing_kinds: [
    {
      kind: 'eia-certificate-application',
      cadence: 'pre-project',
      due_pattern: 'before-construction-start',
      source_url: 'https://www.nemc.or.tz/services/eia',
    },
    {
      kind: 'annual-environmental-audit',
      cadence: 'annual',
      due_pattern: '12-months-from-eia-issue',
      source_url: 'https://www.nemc.or.tz/services/eia/audit',
    },
    {
      kind: 'non-compliance-notice-response',
      cadence: 'event-driven',
      due_pattern: 'within-14-calendar-days',
      late_penalty: 'EMA 2004 §191 — escalation to remediation order',
      source_url: 'https://www.nemc.or.tz/',
    },
  ],
  due_pattern: {
    working_week_aware: true,
    holiday_shift_rule: 'next-working-day',
  },
  audit_hash: linkRegistryRow({ kind: 'regulator', id: 'tz-nemc' }),
};

export const tzBot: RegulatorDefinition = {
  id: 'tz-bot',
  jurisdiction_id: 'tz',
  display_name: 'Bank of Tanzania (BoT)',
  domain: 'central-bank',
  filing_kinds: [
    {
      kind: 'forex-transaction-report',
      cadence: 'per-transaction',
      due_pattern: 'threshold-triggered',
      source_url: 'https://www.bot.go.tz/Pages/ForeignExchange.aspx',
    },
    {
      kind: 'national-gold-gemstone-reserve-deposit',
      cadence: 'event-driven',
      due_pattern: 'on-acquisition-per-mining-act',
      source_url: 'https://www.tumemadini.go.tz/media/uploads/publications/2025/06/29/The_Mining_Act.pdf',
    },
    {
      kind: 'cross-border-payment-notification',
      cadence: 'per-transaction',
      due_pattern: 'within-7-days-of-payment',
      source_url: 'https://www.bot.go.tz/',
    },
  ],
  due_pattern: {
    working_week_aware: true,
    holiday_shift_rule: 'next-working-day',
  },
  audit_hash: linkRegistryRow({ kind: 'regulator', id: 'tz-bot' }),
};

// ---------------------------------------------------------------------------
// Full TZ regulators array
// ---------------------------------------------------------------------------

export const tzRegulators: ReadonlyArray<RegulatorDefinition> = [
  tzTra,
  tzTumemadini,
  tzNemc,
  tzBot,
];
