/**
 * finance-capacity — guard-exempt Swahili+English string table for the
 * Finance → Capacity Expansion route
 * (`app/(routes)/finance/capacity/page.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the route needs (eyebrow,
 * heading, sub-copy) lives here rather than inline in the component —
 * keeping the page source free of hardcoded Swahili tokens while
 * preserving the symmetric `isSw ? M.key.sw : M.key.en` call-site shape.
 *
 * SHAPE
 * Flat namespace; each leaf is `{ sw, en }`, preserving the exact en/sw
 * text the route shipped with.
 */

export const financeCapacityStrings = {
  eyebrow: { sw: 'Upanuzi wa uwezo', en: 'Capacity expansion' },
  heading: { sw: 'Pima upanuzi kifedha', en: 'Weigh expansion financially' },
  subheading: {
    sw: 'NPV, IRR na marejesho — kwa kila hali ya upanuzi.',
    en: 'NPV, IRR and payback — for every expansion scenario.',
  },
  body: {
    sw: 'Tengeneza hali za upanuzi (shimo jipya, eneo jipya, au kuboresha usindikaji), kisha mshauri huzipanga kwa NPV na hutoa mapendekezo yenye ushahidi ili kuongoza mtaji wako.',
    en: 'Model expansion scenarios (new shaft, new site, or a processing upgrade), and the advisor ranks them by NPV and returns evidence-cited recommendations to guide your capital.',
  },
} as const;
