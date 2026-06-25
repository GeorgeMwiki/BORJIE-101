/**
 * marketplace-page — per-surface {en, sw} string module for the owner
 * cockpit Marketplace index (O-W-20) hero CTAs.
 *
 * WHY THIS FILE EXISTS
 * The hero strip previously rendered an inline Swahili literal that mixed
 * English into the SW string ("Tangaza parcel mpya"). The zero-mix canon
 * is absolute: one language per active locale. These keys carry CLEAN,
 * single-language EN/SW pairs picked via `pickByLocale`. A NEW per-surface
 * file (not the shared routes bundles) keeps this stream conflict-free.
 */

export const marketplacePageStrings = {
  listParcel: {
    en: 'List new ore parcel',
    sw: 'Orodhesha shehena mpya ya madini',
  },
  comparePrices: {
    en: 'Compare prices',
    sw: 'Linganisha bei',
  },
} as const;
