/**
 * Per-document chat (DocChatPane) per-file {en, sw} string module.
 * One language per active locale; real Swahili, no stubs.
 *
 * Interpolated templates are pure functions returning `{ en, sw }` so the
 * WHOLE localized sentence is selected per locale (never string-concatenated
 * across languages, which would mix the canon).
 */

export const docChatStrings = {
  intro: (title: string) => ({
    en: `Ask a question about ${title}. Every answer is grounded in evidence drawn only from this document.`,
    sw: `Uliza swali kuhusu ${title}. Kila jibu linategemea ushahidi unaotolewa kutoka kwenye hati hii pekee.`,
  }),
  roleOwner: { en: 'Owner', sw: 'Mmiliki' },
  roleAgent: { en: 'Document agent', sw: 'Wakala wa hati' },
  searching: { en: 'Searching this document…', sw: 'Inatafuta katika hati hii…' },
  agentUnreachable: (detail: string) => ({
    en: `Could not reach the document agent: ${detail}`,
    sw: `Imeshindwa kufikia wakala wa hati: ${detail}`,
  }),
  unknownError: { en: 'unknown error', sw: 'hitilafu isiyojulikana' },
  inputPlaceholder: {
    en: 'What does the licence say about the annual royalty?',
    sw: 'Leseni inasema nini kuhusu mrabaha wa mwaka?',
  },
  ask: { en: 'Ask', sw: 'Uliza' },
  evidenceTitle: { en: 'Evidence chunk', sw: 'Kipande cha ushahidi' },
  validationMin: {
    en: 'Type at least 2 chars.',
    sw: 'Andika herufi 2 au zaidi.',
  },
  pendingOne: (title: string) => ({
    en: `I found 1 relevant passage in ${title}. The written answer is being generated. Open a cited passage below to read the source.`,
    sw: `Nimepata kifungu 1 kinachohusiana katika ${title}. Jibu lililoandikwa linatengenezwa. Fungua kifungu kilichotajwa hapa chini kusoma chanzo.`,
  }),
  pendingMany: (title: string, count: number) => ({
    en: `I found ${count} relevant passages in ${title}. The written answer is being generated. Open a cited passage below to read the source.`,
    sw: `Nimepata vifungu ${count} vinavyohusiana katika ${title}. Jibu lililoandikwa linatengenezwa. Fungua kifungu kilichotajwa hapa chini kusoma chanzo.`,
  }),
  noEvidence: (title: string) => ({
    en: `I could not find evidence in ${title} for that question. Try rephrasing, or ask about a topic this document covers.`,
    sw: `Sikuweza kupata ushahidi katika ${title} kwa swali hilo. Jaribu kuliuliza kwa namna nyingine, au uliza kuhusu mada inayoshughulikiwa na hati hii.`,
  }),
} as const;
