/**
 * market-page — guard-exempt Swahili+English string table for the
 * owner market intelligence route (`app/(routes)/market/page.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the bilingual header copy for the market surface
 * lives here rather than inline in the page component — keeping the
 * route source free of hardcoded Swahili tokens while preserving the
 * symmetric `isSw ? M.key.sw : M.key.en` call-site shape used across
 * owner-web.
 *
 * SHAPE
 * Each leaf is `{ sw, en }`, copied verbatim from the original inline
 * ternaries (no re-translation).
 */

export const marketPageStrings = {
  title: { sw: 'Akili ya soko', en: 'Market intelligence' },
  subtitle: {
    sw: 'Bei ya bidhaa moja kwa moja, ishara za nunua/uza/shikilia, utabiri wa mahitaji na vikwazo vya soko — vyote vikiwa na ushahidi.',
    en: 'Live commodity prices, buy/sell/hold signals, demand forecasts and market disruptions — all evidence-backed.',
  },
} as const;
