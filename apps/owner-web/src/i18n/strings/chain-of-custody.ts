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
    en: 'Chain integrity verified — every step links to the previous hash.',
    sw: 'Uadilifu wa mnyororo umethibitishwa — kila hatua inaunganishwa na hash iliyotangulia.',
  },
  chainBrokenBefore: { en: 'Chain broken at step ', sw: 'Mnyororo umevunjika kwenye hatua ' },
  chainBrokenAfter: {
    en: '. Investigate before trusting any downstream filing.',
    sw: '. Chunguza kabla ya kuamini wasilisho lolote linalofuata.',
  },
  locationUnrecorded: { en: 'Location unrecorded', sw: 'Eneo halikurekodiwa' },
  seal: { en: 'seal', sw: 'lakiri' },
} as const;
