/**
 * Regional Estate Learning — country/district-specific estate patterns.
 *
 * Port of LitFin's regional-credit-learning to property management:
 * - Tanzania: TRA district quirks, Swahili tenant comms conventions, GePG
 *   reconciliation edge cases.
 * - Kenya: M-Pesa settlement windows, KRA withholding, rent deposit
 *   handling expectations.
 *
 * Pluggable per country via @borjie/compliance-plugins. The shape here
 * is deliberately data-driven so new countries slot in without code change.
 *
 * @module intelligence-orchestrator/regional-estate-learning
 */

export type CountryCode = 'TZ' | 'KE' | 'UG' | 'RW' | 'BI';

export interface RegionalEstateProfile {
  readonly country: CountryCode;
  readonly regionCode: string; // e.g. "TZ-DAR-KINONDONI"
  readonly commonArrearsCauses: readonly string[];
  readonly preferredCommsChannels: readonly ('sms' | 'whatsapp' | 'email' | 'call')[];
  readonly languageDefaults: readonly string[];
  readonly regulatoryQuirks: readonly string[];
  readonly paymentRailGotchas: readonly string[];
  readonly seasonalPatterns: readonly {
    readonly period: string;
    readonly expectedArrearsMultiplier: number;
  }[];
}

const PROFILES: Readonly<Record<string, RegionalEstateProfile>> = Object.freeze({
  'TZ-DEFAULT': {
    country: 'TZ',
    regionCode: 'TZ-DEFAULT',
    commonArrearsCauses: [
      'school-fees quarter (Jan, May, Sep)',
      'Ramadan expenditure peak',
      'year-end settlement',
    ],
    preferredCommsChannels: ['whatsapp', 'sms', 'call'],
    languageDefaults: ['sw', 'en'],
    regulatoryQuirks: [
      'GePG receipt required for government tenants',
      'TRA VAT on agency fees',
      'Land-office consent for assignment of lease',
    ],
    paymentRailGotchas: [
      'GePG control-number 24h settlement window',
      'M-Pesa Tanzania (Vodacom) daily limit',
      'bank standing-order posts next-day',
    ],
    seasonalPatterns: [
      { period: 'school-fees-Q1', expectedArrearsMultiplier: 1.3 },
      { period: 'Ramadan', expectedArrearsMultiplier: 1.2 },
    ],
  },
  'TZ-DAR-KINONDONI': {
    country: 'TZ',
    regionCode: 'TZ-DAR-KINONDONI',
    commonArrearsCauses: [
      'school-fees quarter',
      'traffic-impact on agents reaching property',
    ],
    preferredCommsChannels: ['whatsapp', 'sms'],
    languageDefaults: ['sw', 'en'],
    regulatoryQuirks: [
      'Kinondonini-specific waste management levy',
      'GePG receipt required for government tenants',
    ],
    paymentRailGotchas: [
      'GePG control-number 24h settlement window',
    ],
    seasonalPatterns: [
      { period: 'school-fees-Q1', expectedArrearsMultiplier: 1.4 },
    ],
  },
  'KE-DEFAULT': {
    country: 'KE',
    regionCode: 'KE-DEFAULT',
    commonArrearsCauses: [
      'school-fees terms (Jan, May, Sep)',
      'fuel-price shocks',
      'election-year uncertainty',
    ],
    preferredCommsChannels: ['sms', 'whatsapp', 'call'],
    languageDefaults: ['en', 'sw'],
    regulatoryQuirks: [
      'KRA rental-income monthly return',
      'deposit held separately per Rent Restriction Act',
      'KRA withholding at 10% on commercial rent',
    ],
    paymentRailGotchas: [
      'M-Pesa paybill 24h settlement',
      'bank RTGS cut-off 3:30pm',
    ],
    seasonalPatterns: [
      { period: 'school-fees-Q1', expectedArrearsMultiplier: 1.3 },
    ],
  },
});

export interface RegionalCreditContext {
  readonly profile: RegionalEstateProfile;
  readonly currentSeasonalMultiplier: number;
  readonly suggestedCommsChannel: RegionalEstateProfile['preferredCommsChannels'][number];
  readonly suggestedLanguage: string;
}

export function getRegionalEstateProfile(
  regionCode: string,
): RegionalEstateProfile | null {
  return PROFILES[regionCode] ?? PROFILES[`${regionCode.split('-')[0]}-DEFAULT`] ?? null;
}

export function getRegionalEstateContext(
  regionCode: string,
  currentMonth: number = new Date().getUTCMonth() + 1,
): RegionalCreditContext | null {
  const profile = getRegionalEstateProfile(regionCode);
  if (!profile) return null;

  let multiplier = 1;
  for (const p of profile.seasonalPatterns) {
    if (isSeasonActive(p.period, currentMonth)) {
      multiplier = Math.max(multiplier, p.expectedArrearsMultiplier);
    }
  }
  return {
    profile,
    currentSeasonalMultiplier: multiplier,
    suggestedCommsChannel: profile.preferredCommsChannels[0] ?? 'sms',
    suggestedLanguage: profile.languageDefaults[0] ?? 'en',
  };
}

function isSeasonActive(period: string, month: number): boolean {
  const p = period.toLowerCase();
  if (p.includes('school-fees-q1')) return month === 1;
  if (p.includes('ramadan')) {
    // ramadan shifts — broad band of +/- 1 month around a rolling window
    return month >= 3 && month <= 5;
  }
  return false;
}

export interface EstateOutcomeRecord {
  readonly tenantId: string;
  readonly regionCode: string;
  readonly outcome: 'paid_on_time' | 'late' | 'defaulted' | 'cured';
  readonly monthsLate: number;
  readonly recordedAt: string;
}

export interface RegionalOutcomeRepository {
  insert(record: EstateOutcomeRecord): Promise<void>;
}

/** Record a lease-outcome so future reasoning can refine the regional profile. */
export async function recordEstateOutcome(
  repo: RegionalOutcomeRepository,
  record: EstateOutcomeRecord,
): Promise<void> {
  if (!record.tenantId) {
    throw new Error('regional-estate-learning: tenantId required');
  }
  await repo.insert(record);
}
