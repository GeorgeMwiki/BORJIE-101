/**
 * shift-planner-page — guard-exempt Swahili+English string table for the
 * People → Shift Planner route header (`app/(routes)/people/shift-planner/
 * page.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the route's bilingual header copy lives here rather
 * than inline in the page component — keeping the page source free of
 * hardcoded Swahili tokens while preserving the symmetric
 * `isSw ? M.key.sw : M.key.en` call-site shape used across owner-web.
 *
 * SHAPE
 * Each leaf is `{ sw, en }`. Text is preserved verbatim from the
 * original inline ternaries — do not re-translate.
 */

export const shiftPlannerPageStrings = {
  eyebrow: { sw: 'Mpangaji wa zamu', en: 'Shift planner' },
  title: { sw: 'Panga zamu kwa usalama', en: 'Plan shifts safely' },
  subtitle: {
    sw: 'Vyeti, mitambo, uchovu na OSHA-TZ — vyote kwa pamoja.',
    en: 'Certifications, equipment, fatigue and OSHA-TZ — all at once.',
  },
  body: {
    sw: 'Mpangaji huchukua wafanyakazi, mitambo na maeneo yako halisi, kisha hutoa mgao unaozingatia vyeti, uchovu wa saa 72, na sheria za usalama za OSHA-TZ — pamoja na ripoti kamili ya ufuasi.',
    en: 'The planner pulls your real workers, equipment and sites, then produces an assignment that respects certifications, 72-hour fatigue, and OSHA-TZ safety rules — with a full compliance report as evidence.',
  },
} as const;
