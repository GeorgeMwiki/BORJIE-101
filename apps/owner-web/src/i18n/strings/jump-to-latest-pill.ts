/**
 * jump-to-latest-pill — guard-exempt Swahili+English string table for the
 * home-chat streaming `JumpToLatestPill` control.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so the single Swahili label the pill needs lives here
 * rather than inline in the component — keeping the component source free
 * of hardcoded Swahili tokens while preserving the symmetric
 * `pickByLocale(locale, S.key)` call-site shape.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the component — preserved verbatim.
 */

export const jumpToLatestPillStrings = {
  jumpToLatest: {
    en: 'Jump to latest',
    sw: 'Nenda kwa za hivi karibuni',
  },
} as const;
