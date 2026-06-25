/**
 * LMBM graph surface (O-W) per-file {en, sw} string module.
 * One language per active locale; real Swahili, no stubs.
 */

export const lmbmStrings = {
  selectNode: {
    en: 'Select a node to see its attributes and evidence chain.',
    sw: 'Chagua nodi ili kuona sifa zake na mnyororo wa ushahidi.',
  },
  close: { en: 'Close', sw: 'Funga' },
  validity: { en: 'Validity', sw: 'Uhalali' },
  validityOpen: { en: 'open', sw: 'wazi' },
  attributes: { en: 'Attributes', sw: 'Sifa' },
  evidenceChain: { en: 'Evidence chain', sw: 'Mnyororo wa ushahidi' },
  confidence: (pct: string) => ({
    en: `confidence ${pct}%`,
    sw: `uhakika ${pct}%`,
  }),
} as const;
