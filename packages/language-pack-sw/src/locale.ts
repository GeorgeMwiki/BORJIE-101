/**
 * Swahili locale resources (UNIV-2).
 *
 * 2 region variants — sw-TZ (Tanzanian standard / Kiswahili Sanifu),
 * sw-KE (Kenyan / faster-evolving urban). Currency, date and number
 * conventions derive from CLDR:
 *   - Unicode CLDR Project
 *     https://cldr.unicode.org/ (accessed 2026-05-26)
 *   - Bank of Tanzania (TZS)
 *     https://www.bot.go.tz/ (accessed 2026-05-26)
 *   - Central Bank of Kenya (KES)
 *     https://www.centralbank.go.ke/ (accessed 2026-05-26)
 *
 * Register differences between sw-TZ and sw-KE are NOT encoded in the
 * locale block (that's the dialect classifier's job — see dialect.ts).
 * The locale block is purely formatting.
 */

import type { Citation } from '@borjie/language-packs';
import type { LocaleResources } from './types.js';

const ACCESSED = '2026-05-26';

const BOT: Citation = Object.freeze({
  url: 'https://www.bot.go.tz/',
  title: 'Bank of Tanzania — TZS currency reference',
  accessedAt: ACCESSED,
});

const CBK: Citation = Object.freeze({
  url: 'https://www.centralbank.go.ke/',
  title: 'Central Bank of Kenya — KES currency reference',
  accessedAt: ACCESSED,
});

export const SW_TZ: LocaleResources = Object.freeze({
  bcp47: 'sw-TZ',
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
  citation: BOT,
});

export const SW_KE: LocaleResources = Object.freeze({
  bcp47: 'sw-KE',
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
  citation: CBK,
});

export const SW_LOCALES: Readonly<Record<string, LocaleResources>> =
  Object.freeze({
    'sw-TZ': SW_TZ,
    'sw-KE': SW_KE,
  });

export function resolveSwLocale(bcp47: string): LocaleResources | null {
  return SW_LOCALES[bcp47] ?? null;
}
