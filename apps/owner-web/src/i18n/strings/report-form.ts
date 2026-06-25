/**
 * report-form — per-surface {en, sw} string module for the owner cockpit
 * ReportForm (O-W-18) report-generation form.
 *
 * WHY THIS FILE EXISTS
 * The form previously hardcoded English for every label, the error line,
 * the submit caption, and the queued-toast — inside a localized cockpit.
 * The zero-mix canon requires one language per active locale, so these
 * keys carry clean EN/SW pairs picked via `pickByLocale`. A NEW
 * per-surface file (not the shared bundles) keeps this stream
 * conflict-free.
 *
 * `generateCta` is a function so the selected report title interpolates
 * into a SINGLE-language sentence (never an EN frame around an SW title).
 */

export const reportFormStrings = {
  reportTypeLegend: {
    en: 'Report type',
    sw: 'Aina ya ripoti',
  },
  rangeStart: {
    en: 'Range start',
    sw: 'Mwanzo wa kipindi',
  },
  rangeEnd: {
    en: 'Range end',
    sw: 'Mwisho wa kipindi',
  },
  errorPrefix: {
    en: 'Failed to generate report:',
    sw: 'Imeshindwa kutengeneza ripoti:',
  },
  errorUnknown: {
    en: 'unknown',
    sw: 'haijulikani',
  },
  reportFallback: {
    en: 'report',
    sw: 'ripoti',
  },
  generateCta: {
    en: (title: string): string => `Generate ${title}`,
    sw: (title: string): string => `Tengeneza ${title}`,
  },
  queuedToast: {
    en: 'Report queued. It will appear in your generated reports when the renderer finishes.',
    sw: 'Ripoti imepangwa. Itaonekana kwenye ripoti zako zilizotengenezwa pindi kitengenezaji kitakapomaliza.',
  },
} as const;
