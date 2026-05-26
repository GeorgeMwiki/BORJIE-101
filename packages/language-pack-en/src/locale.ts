/**
 * English locale resources (UNIV-2).
 *
 * 5 region variants — en-GB, en-US, en-TZ, en-KE, en-AU. Each block
 * derives from CLDR's canonical locale data:
 *   - Unicode CLDR Project
 *     https://cldr.unicode.org/ (accessed 2026-05-26)
 *   - Unicode LDML TR-35 for date pattern syntax
 *     https://www.unicode.org/reports/tr35/ (accessed 2026-05-26)
 *   - CLDR territory currencies (Bank of Tanzania for TZS, CBK for KES)
 *
 * Frozen-at-construction (immutability rule).
 */

import type { Citation } from '@borjie/language-packs';
import type { LocaleResources } from './types.js';

const ACCESSED = '2026-05-26';

const CLDR_CITATION: Citation = Object.freeze({
  url: 'https://cldr.unicode.org/',
  title: 'Unicode CLDR Project',
  accessedAt: ACCESSED,
});

const LDML_CITATION: Citation = Object.freeze({
  url: 'https://www.unicode.org/reports/tr35/',
  title: 'Unicode LDML Technical Report TR-35',
  accessedAt: ACCESSED,
});

const BOT_CITATION: Citation = Object.freeze({
  url: 'https://www.bot.go.tz/',
  title: 'Bank of Tanzania — TZS currency reference',
  accessedAt: ACCESSED,
});

const CBK_CITATION: Citation = Object.freeze({
  url: 'https://www.centralbank.go.ke/',
  title: 'Central Bank of Kenya — KES currency reference',
  accessedAt: ACCESSED,
});

// ---------------------------------------------------------------------------
// en-GB — British English
// ---------------------------------------------------------------------------

export const EN_GB: LocaleResources = Object.freeze({
  bcp47: 'en-GB',
  dateFormat: Object.freeze({
    short: 'dd/MM/yyyy',
    medium: 'd MMM yyyy',
    long: 'd MMMM yyyy',
    full: 'EEEE, d MMMM yyyy',
  }),
  numberFormat: Object.freeze({
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
  }),
  currency: Object.freeze({
    code: 'GBP',
    symbol: '£',
    position: 'prefix',
  }),
  firstDayOfWeek: 1,
  weekendDays: Object.freeze([6, 0] as const),
  collation: 'standard',
  citation: CLDR_CITATION,
});

// ---------------------------------------------------------------------------
// en-US — American English
// ---------------------------------------------------------------------------

export const EN_US: LocaleResources = Object.freeze({
  bcp47: 'en-US',
  dateFormat: Object.freeze({
    short: 'M/d/yyyy',
    medium: 'MMM d, yyyy',
    long: 'MMMM d, yyyy',
    full: 'EEEE, MMMM d, yyyy',
  }),
  numberFormat: Object.freeze({
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
  }),
  currency: Object.freeze({
    code: 'USD',
    symbol: '$',
    position: 'prefix',
  }),
  firstDayOfWeek: 0,
  weekendDays: Object.freeze([6, 0] as const),
  collation: 'standard',
  citation: LDML_CITATION,
});

// ---------------------------------------------------------------------------
// en-TZ — Tanzanian English (launch beachhead)
// ---------------------------------------------------------------------------

export const EN_TZ: LocaleResources = Object.freeze({
  bcp47: 'en-TZ',
  dateFormat: Object.freeze({
    short: 'dd/MM/yyyy',
    medium: 'd MMM yyyy',
    long: 'd MMMM yyyy',
    full: 'EEEE, d MMMM yyyy',
  }),
  numberFormat: Object.freeze({
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
  }),
  currency: Object.freeze({
    code: 'TZS',
    symbol: 'TSh',
    position: 'prefix',
  }),
  firstDayOfWeek: 1,
  weekendDays: Object.freeze([6, 0] as const),
  collation: 'standard',
  citation: BOT_CITATION,
});

// ---------------------------------------------------------------------------
// en-KE — Kenyan English
// ---------------------------------------------------------------------------

export const EN_KE: LocaleResources = Object.freeze({
  bcp47: 'en-KE',
  dateFormat: Object.freeze({
    short: 'dd/MM/yyyy',
    medium: 'd MMM yyyy',
    long: 'd MMMM yyyy',
    full: 'EEEE, d MMMM yyyy',
  }),
  numberFormat: Object.freeze({
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
  }),
  currency: Object.freeze({
    code: 'KES',
    symbol: 'KSh',
    position: 'prefix',
  }),
  firstDayOfWeek: 1,
  weekendDays: Object.freeze([6, 0] as const),
  collation: 'standard',
  citation: CBK_CITATION,
});

// ---------------------------------------------------------------------------
// en-AU — Australian English
// ---------------------------------------------------------------------------

export const EN_AU: LocaleResources = Object.freeze({
  bcp47: 'en-AU',
  dateFormat: Object.freeze({
    short: 'd/M/yyyy',
    medium: 'd MMM yyyy',
    long: 'd MMMM yyyy',
    full: 'EEEE, d MMMM yyyy',
  }),
  numberFormat: Object.freeze({
    decimalSeparator: '.',
    groupSeparator: ',',
    fractionDigits: 2,
  }),
  currency: Object.freeze({
    code: 'AUD',
    symbol: 'A$',
    position: 'prefix',
  }),
  firstDayOfWeek: 1,
  weekendDays: Object.freeze([6, 0] as const),
  collation: 'standard',
  citation: CLDR_CITATION,
});

// ---------------------------------------------------------------------------
// Region map
// ---------------------------------------------------------------------------

export const EN_LOCALES: Readonly<Record<string, LocaleResources>> =
  Object.freeze({
    'en-GB': EN_GB,
    'en-US': EN_US,
    'en-TZ': EN_TZ,
    'en-KE': EN_KE,
    'en-AU': EN_AU,
  });

/**
 * Resolve a region variant. Returns null if the requested BCP-47 tag
 * is not one of the 5 supported variants. Caller falls back to en-GB
 * if needed (CLDR convention for unmarked English).
 */
export function resolveEnLocale(bcp47: string): LocaleResources | null {
  return EN_LOCALES[bcp47] ?? null;
}
