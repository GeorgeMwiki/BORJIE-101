/**
 * Reports library page (O-W-18-LIBRARY) — per-file {en, sw} module.
 * One language per active locale; real Swahili, no mixing.
 */

export const reportsLibraryPageStrings = {
  back: { en: 'Back to Reports', sw: 'Rudi kwenye Ripoti' },
  eyebrow: { en: 'Reports · Library', sw: 'Ripoti · Maktaba' },
  title: { en: 'Report library', sw: 'Maktaba ya ripoti' },
  subtitle: {
    en: 'All generated reports for your estate, newest first. Each report includes a hash anchor for every figure — traceable to the source ledger or document chunk.',
    sw: 'Ripoti zote zilizotengenezwa kwa miliki yako, mpya kwanza. Kila ripoti ina nanga ya hash kwa kila takwimu — inafuatilika hadi kwenye ledger ya chanzo au kipande cha hati.',
  },
  generate: { en: 'Generate new report', sw: 'Tengeneza ripoti mpya' },
  ask: { en: 'Ask about analytics', sw: 'Uliza kuhusu uchambuzi' },
  loadingAria: { en: 'Loading report library…', sw: 'Inapakia maktaba ya ripoti…' },
  loadError: {
    en: 'Could not load the report library.',
    sw: 'Imeshindwa kupakia maktaba ya ripoti.',
  },
  emptyTitle: { en: 'No reports generated yet', sw: 'Hakuna ripoti zilizotengenezwa bado' },
  emptyBody: {
    en: 'Use the report generator to produce your first daily brief, monthly review, or board pack.',
    sw: 'Tumia kitengenezaji cha ripoti kutengeneza muhtasari wako wa kwanza wa kila siku, mapitio ya kila mwezi, au pakiti ya bodi.',
  },
  emptyCta: { en: 'Generate your first report', sw: 'Tengeneza ripoti yako ya kwanza' },
  colType: { en: 'Type', sw: 'Aina' },
  colGenerated: { en: 'Generated', sw: 'Imetengenezwa' },
  colVersion: { en: 'Version', sw: 'Toleo' },
  colActions: { en: 'Actions', sw: 'Vitendo' },
  discuss: { en: 'Discuss', sw: 'Jadili' },
  kindDaily: { en: 'Daily owner brief', sw: 'Muhtasari wa kila siku' },
  kindWeekly: { en: 'Weekly strategy memo', sw: 'Memo ya mkakati wa kila wiki' },
  kindMonthly: { en: 'Monthly business review', sw: 'Mapitio ya biashara ya kila mwezi' },
  kindInvestor: { en: 'Investor / bank pack', sw: 'Pakiti ya mwekezaji / benki' },
  kindBoard: { en: 'Board pack', sw: 'Pakiti ya bodi' },
  kindAudit: { en: 'Audit pack', sw: 'Pakiti ya ukaguzi' },
  kindCommunity: { en: 'Community update', sw: 'Taarifa ya jamii' },
} as const;
