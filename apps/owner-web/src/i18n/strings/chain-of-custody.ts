/**
 * Chain-of-custody surface (O-W-25) — per-file {en, sw} module.
 * One language per active locale; real Swahili, no mixing.
 */

export const chainOfCustodyStrings = {
  parcelPlaceholder: { en: 'Parcel id (ore_parcels.id)', sw: 'Kitambulisho cha shehena (ore_parcels.id)' },
  trace: { en: 'Trace', sw: 'Fuatilia' },
  promptTitle: { en: 'Trace a parcel', sw: 'Fuatilia shehena' },
  promptBody: {
    en: 'Enter a parcel id to replay its custody chain.',
    sw: 'Ingiza kitambulisho cha shehena ili kuona mnyororo wake wa uhifadhi.',
  },
  emptyTitle: { en: 'No custody steps yet', sw: 'Hakuna hatua za uhifadhi bado' },
  emptyBody: {
    en: 'No custody steps have been logged for this parcel yet.',
    sw: 'Hakuna hatua za uhifadhi zilizorekodiwa kwa shehena hii bado.',
  },
  chainVerified: {
    en: 'Chain integrity verified: every step links to the previous hash.',
    sw: 'Uadilifu wa mnyororo umethibitishwa: kila hatua inaunganishwa na hash iliyotangulia.',
  },
  chainBrokenBefore: { en: 'Chain broken at step ', sw: 'Mnyororo umevunjika kwenye hatua ' },
  chainBrokenAfter: {
    en: '. Investigate before trusting any downstream filing.',
    sw: '. Chunguza kabla ya kuamini wasilisho lolote linalofuata.',
  },
  locationUnrecorded: { en: 'Location unrecorded', sw: 'Eneo halikurekodiwa' },
  seal: { en: 'seal', sw: 'lakiri' },
  loadFailedTitle: { en: 'Could not load custody chain', sw: 'Imeshindwa kupakia mnyororo wa uhifadhi' },
  loadFailedBody: {
    en: 'The custody feed did not respond. Check your connection and try again.',
    sw: 'Mlisho wa uhifadhi haukujibu. Angalia muunganisho wako kisha jaribu tena.',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
} as const;

/**
 * Chain-of-custody action labels (mineral_chain_of_custody.action). One
 * canonical Swahili term per concept; mirrors CHAIN_OF_CUSTODY_ACTIONS.
 */
export const chainActionLabels: Record<
  string,
  { readonly en: string; readonly sw: string }
> = {
  extract: { en: 'Extract', sw: 'Chimba' },
  transport: { en: 'Transport', sw: 'Safirisha' },
  process: { en: 'Process', sw: 'Sindika' },
  smelt: { en: 'Smelt', sw: 'Yeyusha' },
  refine: { en: 'Refine', sw: 'Safisha' },
  assay: { en: 'Assay', sw: 'Pima madini' },
  export: { en: 'Export', sw: 'Safirisha nje' },
  sell: { en: 'Sell', sw: 'Uza' },
  store: { en: 'Store', sw: 'Hifadhi' },
  transfer: { en: 'Transfer', sw: 'Hamisha' },
  split: { en: 'Split', sw: 'Gawanya' },
  merge: { en: 'Merge', sw: 'Unganisha' },
};
