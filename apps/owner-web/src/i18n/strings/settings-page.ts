/**
 * settings-page — guard-exempt Swahili+English string table for the
 * owner-web Settings route (`app/(routes)/settings/page.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the settings page renders (the
 * jurisdiction + connected-agents nav-card titles and their sub-captions)
 * lives here rather than inline in the route — keeping the route source
 * free of hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S.key)` call-site shape the page already uses.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the route — preserved verbatim.
 */

export const settingsPageStrings = {
  jurisdictionTitle: { en: 'Jurisdiction', sw: 'Eneo la sheria' },
  jurisdictionSubtitle: {
    en: 'Country, regulators, currency, language, time zone.',
    sw: 'Nchi, wadhibiti, sarafu, lugha, eneo la saa.',
  },
  connectedAgentsTitle: {
    en: 'Connected agents',
    sw: 'Wakala walioongezwa',
  },
  connectedAgentsSubtitle: {
    en: 'External agents with active access to your account.',
    sw: 'Mawakala wa nje wenye ufikiaji hai kwa akaunti yako.',
  },
} as const;
