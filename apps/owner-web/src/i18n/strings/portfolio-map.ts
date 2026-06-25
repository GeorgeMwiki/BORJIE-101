/**
 * Portfolio map surface (O-W-05) per-file {en, sw} string module.
 * One language per active locale; real Swahili, no stubs.
 *
 * Feature-kind labels are the canonical localized group headers shared by
 * the tile-free fallback. No env-var names leak into owner copy.
 */

import type { FeatureKind } from '@/lib/types/portfolio-map';

export const portfolioMapStrings = {
  fallbackNote: {
    en: 'The interactive basemap is unavailable right now. Showing your portfolio features as a tile-free list.',
    sw: 'Ramani msingi inayoshirikiana haipatikani kwa sasa. Inaonyesha vipengele vya jalada lako kama orodha isiyo na vigae.',
  },
  noFeatures: { en: 'No features', sw: 'Hakuna vipengele' },
  loadingMap: { en: 'Loading map…', sw: 'Inapakia ramani…' },
  layersHeader: { en: 'Layers', sw: 'Tabaka' },
  // ── FeatureDetail panel ──────────────────────────────────────────────
  detailEmpty: {
    en: 'Click a feature to drill in.',
    sw: 'Bofya kipengele ili kuona zaidi.',
  },
  detailClose: { en: 'Close', sw: 'Funga' },
  openSiteCockpit: { en: 'Open site cockpit', sw: 'Fungua chumba cha eneo' },
} as const;

export const featureKindLabels: Record<
  FeatureKind,
  { readonly en: string; readonly sw: string }
> = {
  licence: { en: 'Licence', sw: 'Leseni' },
  site: { en: 'Site', sw: 'Eneo' },
  settlement: { en: 'Settlement', sw: 'Makazi' },
  water: { en: 'Water', sw: 'Maji' },
  protected: { en: 'Protected area', sw: 'Eneo lililohifadhiwa' },
  road: { en: 'Road', sw: 'Barabara' },
};

/**
 * Plural layer-toggle labels for the map's layer panel. Each kind toggles a
 * GROUP of features, so the toggle list reads in the plural; the singular
 * `featureKindLabels` above stay the fallback group headers. Full en+sw parity.
 */
export const layerToggleLabels: Record<
  FeatureKind,
  { readonly en: string; readonly sw: string }
> = {
  licence: { en: 'Licences', sw: 'Leseni' },
  site: { en: 'Sites', sw: 'Maeneo' },
  settlement: { en: 'Settlements', sw: 'Makazi' },
  water: { en: 'Water', sw: 'Maji' },
  protected: { en: 'Protected areas', sw: 'Maeneo yaliyohifadhiwa' },
  road: { en: 'Roads', sw: 'Barabara' },
};
