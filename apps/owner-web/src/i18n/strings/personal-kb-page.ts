/**
 * Personal-KB page (R8) — per-file {en, sw} string module.
 * One language per active locale; real Swahili, no mixing.
 */

export const personalKbPageStrings = {
  title: { en: 'Personal knowledge base', sw: 'Maktaba yangu binafsi' },
  subtitle: {
    en: 'Everything you have told Borjie about yourself',
    sw: 'Vitu vyote nilivyokuelezea kuhusu mimi',
  },
  body: {
    en: 'Every preference, recurring fact, and context you have shared with Borjie. Crosses tenant boundaries: your assistant remembers you, not the company you happen to be working with.',
    sw: 'Kila pendeleo, ukweli unaojirudia, na muktadha uliyoshiriki na Borjie. Unavuka mipaka ya mashirika: msaidizi wako anakukumbuka wewe, si kampuni unayofanya nayo kazi.',
  },
} as const;
