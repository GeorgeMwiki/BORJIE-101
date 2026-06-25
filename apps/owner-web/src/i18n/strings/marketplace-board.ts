/**
 * marketplace-board — per-surface {en, sw} string module for the owner
 * cockpit MarketplaceBoard inbound column.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard skips the entire `i18n/` tree, so the Swahili
 * literals the board needs live here rather than inline in the component.
 * A NEW per-surface file (not the shared data-b.ts) keeps this stream's
 * additions free of cross-stream conflicts.
 *
 * The keys below back the HONEST empty state shown when the owner's site
 * has no resolved geo-coordinate: the inbound buyer-RFB column is a
 * geo-radius query, so without a real centroid we render a truthful
 * "location not configured" note rather than a fabricated geofence.
 */

export const marketplaceBoardStrings = {
  inboundNoLocationTitle: {
    en: 'Site location not set',
    sw: 'Eneo la tovuti halijawekwa',
  },
  inboundNoLocationBody: {
    en: 'Inbound buyer requests are matched to your site’s coordinates. Set your active site’s location to see nearby demand.',
    sw: 'Maombi ya wanunuzi yanaoanishwa na viwianishi vya tovuti yako. Weka eneo la tovuti yako inayotumika ili kuona mahitaji ya karibu.',
  },
} as const;
