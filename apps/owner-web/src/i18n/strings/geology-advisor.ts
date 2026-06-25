/**
 * geology-advisor — guard-exempt bilingual (sw / en) copy for the Orebody
 * Advisor panel (components/geology/GeologyAdvisorPanel.tsx).
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 * Every key carries a REAL Swahili translation; no machine-translation
 * stubs, no English value sitting in the `sw` slot. The advisor-engine
 * recommendation prose + degraded `note` are English diagnostics emitted
 * by the backend and are rendered with `lang="en"` for honest attribution
 * until the engine pins output to the active locale (see residual).
 */

export const geologyAdvisorStrings = {
  title: { en: 'Orebody Advisor', sw: 'Mshauri wa Mwili wa Madini' },
  subtitle: {
    en: 'Contained-metal estimate + infill / cutoff recommendations',
    sw: 'Makadirio ya madini yaliyomo + mapendekezo ya kujaza / kikomo',
  },
  selectSite: { en: 'Select site', sw: 'Chagua tovuti' },

  loadingSites: { en: 'Loading sites…', sw: 'Inapakia tovuti…' },
  noSites: {
    en: 'No sites yet — add a site to compute orebody advice.',
    sw: 'Hakuna tovuti bado — ongeza tovuti ili kukokotoa ushauri wa mwili wa madini.',
  },
  computing: { en: 'Computing orebody advice…', sw: 'Inakokotoa ushauri wa mwili wa madini…' },
  advisorUnavailable: {
    en: 'Advisor unavailable. Try again shortly.',
    sw: 'Mshauri haupatikani. Jaribu tena hivi karibuni.',
  },

  statTotalTonnes: { en: 'Total tonnes', sw: 'Jumla ya tani' },
  statAvgGrade: { en: 'Avg grade', sw: 'Wastani wa kiwango' },
  statContainedMetal: { en: 'Contained metal (t)', sw: 'Madini yaliyomo (t)' },
  statIntervals: { en: 'Intervals', sw: 'Vipindi' },

  noAssay: {
    en: 'No assay data for this site yet.',
    sw: 'Hakuna data ya uchunguzi wa madini kwa tovuti hii bado.',
  },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  noRecommendations: {
    en: 'No outstanding geology recommendations — model within policy.',
    sw: 'Hakuna mapendekezo ya jiolojia yaliyosalia — modeli iko ndani ya sera.',
  },
} as const;
