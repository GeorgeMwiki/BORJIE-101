/**
 * estate-graph-panel — guard-exempt Swahili+English string table for
 * `components/estate/EstateGraphPanel.tsx`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal this panel needs (section
 * titles, subtitles, loading / error / empty captions, and the
 * interpolated aria-labels) lives here rather than inline in the
 * component — keeping the panel source free of hardcoded Swahili tokens
 * while preserving the symmetric `isSw ? T.key.sw : T.key.en` call-site
 * shape used across owner-web.
 *
 * SHAPE
 * Each leaf is `{ sw, en }`. The two aria-labels are interpolated at the
 * call site (a numeric count is spliced between the prefix and suffix),
 * so they are stored as `{ prefix, suffix }` pairs of `{ sw, en }`.
 */

export const estateGraphPanelStrings = {
  orgTitle: { en: 'Group structure graph', sw: 'Grafu ya muundo wa kundi' },
  orgSubtitle: {
    en: 'Holding & subsidiary ownership — directed by stake',
    sw: 'Umiliki wa kampuni mama na tanzu — kwa hisa',
  },
  flowTitle: { en: 'Capital movement flows', sw: 'Mitiririko ya mtaji' },
  flowSubtitle: {
    en: 'Inter-entity capital movements (Sankey)',
    sw: 'Mitiririko ya mtaji kati ya kampuni (Sankey)',
  },
  loading: { en: 'Loading group graph…', sw: 'Inapakia grafu ya kundi…' },
  loadError: {
    en: 'Group graph unavailable. Try again shortly.',
    sw: 'Grafu ya kundi haipatikani. Jaribu tena baadaye.',
  },
  noEntities: {
    en: 'No estate entities to graph yet.',
    sw: 'Hakuna kampuni za kuonyesha kwenye grafu bado.',
  },
  noFlows: {
    en: 'No inter-entity capital movements recorded yet.',
    sw: 'Hakuna mitiririko ya mtaji kati ya kampuni bado.',
  },
  // Interpolated aria-labels: `${prefix}${count}${suffix}`.
  orgGraphAria: {
    prefix: {
      en: 'Group structure graph, ',
      sw: 'Grafu ya muundo wa kundi, kampuni ',
    },
    suffix: { en: ' entities', sw: '' },
  },
  flowSankeyAria: {
    prefix: {
      en: 'Capital movement Sankey, ',
      sw: 'Sankey ya mitiririko ya mtaji, mitiririko ',
    },
    suffix: { en: ' flows', sw: '' },
  },
} as const;
