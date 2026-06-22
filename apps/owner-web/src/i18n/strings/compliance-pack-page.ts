/**
 * compliance-pack-page — guard-exempt bilingual (sw / en) copy for the
 * monthly compliance-pack route (`compliance/pack/page.tsx`), which
 * previously rendered entirely in hardcoded English under the localized
 * cockpit chrome (the split-brain class). Lives under `i18n/` so the
 * locale-purity scanner exempts the Swahili.
 *
 * Regulator NAMES are proper nouns / official agency names and stay as-is
 * (consistent with the obligation tracker) — only the UI chrome is here.
 */

export const compliancePackPageStrings = {
  backToCompliance: { en: 'Back to Compliance', sw: 'Rudi kwa Uzingatiaji' },
  eyebrow: { en: 'Compliance · Monthly pack', sw: 'Uzingatiaji · Kifurushi cha mwezi' },
  title: { en: 'Draft monthly pack', sw: 'Andaa kifurushi cha mwezi' },
  subtitle: {
    en: 'Generate a compliance export bundle for one or more regulators. The pack is assembled by the consolidation worker and becomes available for download within minutes.',
    sw: 'Tengeneza kifurushi cha uzingatiaji kwa wadhibiti mmoja au zaidi. Kifurushi huandaliwa na mfanyakazi wa muunganisho na hupatikana kwa kupakua ndani ya dakika chache.',
  },

  // Form
  scheduleNewPack: { en: 'Schedule a new pack', sw: 'Panga kifurushi kipya' },
  periodLabel: { en: 'Period (YYYY-MM)', sw: 'Kipindi (MWAKA-MWEZI)' },
  labelLabel: { en: 'Label', sw: 'Lebo' },
  optional: { en: '(optional)', sw: '(si lazima)' },
  defaultPackLabel: (period: string) => ({
    en: `${period} compliance pack`,
    sw: `kifurushi cha uzingatiaji cha ${period}`,
  }),
  includeRegulators: { en: 'Include regulators', sw: 'Jumuisha wadhibiti' },
  selectAtLeastOne: {
    en: 'Select at least one regulator.',
    sw: 'Chagua angalau mdhibiti mmoja.',
  },
  invalidInput: { en: 'Invalid input', sw: 'Taarifa si sahihi' },
  scheduleFailed: {
    en: 'Could not schedule the pack. Please retry.',
    sw: 'Imeshindwa kupanga kifurushi. Tafadhali jaribu tena.',
  },
  packQueued: {
    en: 'Pack queued. It will appear in the list below once generated.',
    sw: 'Kifurushi kimepangwa. Kitaonekana kwenye orodha hapa chini kitakapotengenezwa.',
  },
  schedulePack: { en: 'Schedule pack', sw: 'Panga kifurushi' },
  askCta: { en: 'Ask Mr. Mwikila', sw: 'Uliza Mr. Mwikila' },

  // Previous packs
  previousPacks: { en: 'Previous packs', sw: 'Vifurushi vya awali' },
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  loadFailed: {
    en: 'Could not load previous packs.',
    sw: 'Imeshindwa kupakia vifurushi vya awali.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  noPacksYet: {
    en: 'No packs yet. Schedule the first one above.',
    sw: 'Hakuna vifurushi bado. Panga cha kwanza hapo juu.',
  },
  defaultRowLabel: { en: 'Compliance pack', sw: 'Kifurushi cha uzingatiaji' },
  download: { en: 'Download', sw: 'Pakua' },

  // Status lifecycle labels
  statusQueued: { en: 'Queued', sw: 'Kwenye foleni' },
  statusGenerating: { en: 'Generating…', sw: 'Inatengenezwa…' },
  statusReady: { en: 'Ready', sw: 'Tayari' },
  statusFailed: { en: 'Failed', sw: 'Imeshindwa' },
} as const;
