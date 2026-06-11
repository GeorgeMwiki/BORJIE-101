/**
 * jurisdiction-settings — guard-exempt Swahili+English string table for
 * the owner-web jurisdiction settings client component
 * (`app/(routes)/settings/jurisdiction/jurisdiction-settings.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the Swahili literals still inlined in the component
 * (the load-error caption, the three section headings, and the
 * seeded-jurisdictions footnote) live here rather than inline — keeping
 * the component source free of hardcoded Swahili tokens while preserving
 * the symmetric `pickByLocale(locale, S.key)` call-site shape it already
 * uses for the rest of its copy (the bulk of which lives in
 * `i18n/strings/routes-b.ts` under `jurisdictionSettings`).
 *
 * SHAPE
 * A flat record. Static leaves are `{ en, sw }`. Interpolated leaves are
 * arrow functions returning `{ en, sw }`. The EN and SW text is the exact
 * copy previously inlined in the component — preserved verbatim.
 */

export const jurisdictionSettingsStrings = {
  loadError: (message: string) => ({
    en: `Could not load jurisdiction. ${message}`,
    sw: `Imeshindwa kupakia eneo la sheria. ${message}`,
  }),
  currentHeading: {
    en: 'Current jurisdiction',
    sw: 'Eneo la sasa la sheria',
  },
  lockedHeading: {
    en: 'Jurisdiction is locked',
    sw: 'Eneo la sheria limefungwa',
  },
  overrideHeading: {
    en: 'Ask about another jurisdiction',
    sw: 'Uliza kuhusu eneo lingine la sheria',
  },
  seededFootnote: {
    en: 'Seeded jurisdictions: TZ, KE, UG, NG, ZA, AU, CL, ID. Anything else routes through the on-demand jurisdiction discovery service — Mr. Mwikila will research the regulators live, cite his sources, and offer to seed the jurisdiction permanently (requires a Borjie internal admin approval).',
    sw: 'Maeneo yaliyopandwa: TZ, KE, UG, NG, ZA, AU, CL, ID. Mengine yanaelekezwa kupitia huduma ya ugunduzi wa eneo la sheria — Bw. Mwikila atachunguza wadhibiti moja kwa moja, atataja vyanzo vyake, na atatoa kupanda eneo kwa kudumu (inahitaji idhini ya msimamizi wa ndani wa Borjie).',
  },
} as const;
