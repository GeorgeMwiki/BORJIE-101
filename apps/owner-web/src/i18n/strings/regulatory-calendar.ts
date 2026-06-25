/**
 * regulatory-calendar — guard-exempt bilingual (sw / en) copy + localized
 * enum label tables for `components/regulatory-calendar/RegulatoryCalendarShell.tsx`.
 *
 * TWO JOBS, both required by the zero-mix canon:
 *
 *   1. LOCALIZED ENUM LABEL TABLES. The `/api/v1/ops/regulatory-filings`
 *      feed hands the cockpit raw English status tokens (`scheduled` /
 *      `drafting` / `submitted` / `accepted` / `rejected` / `overdue`) and
 *      regulator slugs (`mining_commission`, `tra`, …). Rendering those
 *      verbatim shows English under a Swahili surface (mixing) AND leaks an
 *      implementation token to the owner. `filingStatusLabel` /
 *      `regulatorLabel` resolve a token through the active locale and fall
 *      back to a humanized form for any value not yet in the table — never
 *      the raw token, never a cross-language fallback.
 *
 *   2. PER-SURFACE COPY. The MetricStrip labels, the filter dropdown
 *      options, the loading / empty captions, and the day-countdown copy.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

import type { Locale } from '@/lib/locale-shared';

type Pair = { readonly en: string; readonly sw: string };
type LabelTable = Readonly<Record<string, Pair>>;

/**
 * Regulator labels. The acronyms (TRA, NEMC, BoT, …) are proper-noun
 * institution names — identical across both locales — so each pair carries
 * the same display string; the empty-value pair is the "All regulators"
 * filter option, which DOES differ per locale.
 */
export const REGULATOR_LABELS: LabelTable = {
  '': { en: 'All regulators', sw: 'Wadhibiti wote' },
  mining_commission: { en: 'Mining Commission', sw: 'Tume ya Madini' },
  tra: { en: 'TRA', sw: 'TRA' },
  nemc: { en: 'NEMC', sw: 'NEMC' },
  bot: { en: 'BoT', sw: 'BoT' },
  brela: { en: 'BRELA', sw: 'BRELA' },
  osha: { en: 'OSHA', sw: 'OSHA' },
  tbs: { en: 'TBS', sw: 'TBS' },
  tcra: { en: 'TCRA', sw: 'TCRA' },
  lhrc: { en: 'LHRC', sw: 'LHRC' },
};

/** Filing lifecycle status tokens from the live filings feed. */
const FILING_STATUS_LABELS: LabelTable = {
  scheduled: { en: 'Scheduled', sw: 'Imepangwa' },
  drafting: { en: 'Drafting', sw: 'Inaandaliwa' },
  submitted: { en: 'Submitted', sw: 'Imewasilishwa' },
  accepted: { en: 'Accepted', sw: 'Imekubaliwa' },
  rejected: { en: 'Rejected', sw: 'Imekataliwa' },
  overdue: { en: 'Overdue', sw: 'Imepitwa na wakati' },
};

function resolve(
  table: LabelTable,
  token: string | null | undefined,
  locale: Locale,
): string {
  if (token === '') {
    const hit = table[''];
    if (hit) return locale === 'sw' ? hit.sw : hit.en;
  }
  if (!token) return locale === 'sw' ? 'Haijabainishwa' : 'Unspecified';
  const hit = table[token];
  if (hit) return locale === 'sw' ? hit.sw : hit.en;
  return token
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Resolve a raw filing-status token to its active-locale label. */
export function filingStatusLabel(
  token: string | null | undefined,
  locale: Locale,
): string {
  return resolve(FILING_STATUS_LABELS, token, locale);
}

/** Resolve a raw regulator slug to its active-locale label. */
export function regulatorLabel(
  token: string | null | undefined,
  locale: Locale,
): string {
  return resolve(REGULATOR_LABELS, token, locale);
}

/** Ordered regulator filter options (value + token to localize at render). */
export const REGULATOR_OPTION_VALUES: ReadonlyArray<string> = [
  '',
  'mining_commission',
  'tra',
  'nemc',
  'bot',
  'brela',
  'osha',
  'tbs',
  'tcra',
  'lhrc',
];

/** Ordered status filter options ('' = all, then each lifecycle token). */
export const STATUS_OPTION_VALUES: ReadonlyArray<string> = [
  '',
  'scheduled',
  'drafting',
  'submitted',
  'accepted',
  'rejected',
  'overdue',
];

export const regulatoryCalendarStrings = {
  allStatuses: { en: 'All statuses', sw: 'Hali zote' },
  metricFilings: { en: 'Filings', sw: 'Mawasilisho' },
  metricOverdue: { en: 'Overdue', sw: 'Yaliyopitwa na wakati' },
  metricSubmitted: { en: 'Submitted', sw: 'Yaliyowasilishwa' },
  metricScheduled: { en: 'Scheduled', sw: 'Yaliyopangwa' },
  loading: { en: 'Loading filings…', sw: 'Inapakia mawasilisho…' },
  empty: {
    en: 'No filings calendared yet. Ask the brain to add the next one.',
    sw: 'Hakuna wasilisho lililopangwa bado. Mwambie Bw. Mwikila aweke linalofuata.',
  },
  due: { en: 'Due', sw: 'Inahitajika' },
  ref: { en: 'ref', sw: 'kumb' },
  daysRemaining: (n: number): Pair => ({
    en: `${n} days`,
    sw: `siku ${n}`,
  }),
  dueToday: { en: 'today', sw: 'leo' },
  daysLate: (n: number): Pair => ({
    en: `${n} days late`,
    sw: `siku ${n} zilizopita`,
  }),
} as const;
