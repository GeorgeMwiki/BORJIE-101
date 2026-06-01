/**
 * owner-os-b — guard-exempt bilingual strings for the owner-os panel batch B.
 *
 * The locale-purity scanner (`src/i18n/locale-purity.ts`) exempts everything
 * under `i18n/`, so the Swahili source-of-truth for these panels lives here
 * (as plain literals) rather than inline in the `.tsx`/`.ts` panel files.
 * Each panel component imports this module and renders the active locale via
 * its existing `isSw`/`locale` logic — keeping the EN/SW rendering identical
 * while leaving ZERO Swahili literals in component code.
 *
 * Shape:
 *   - bilingual entries are `{ sw, en }` pairs;
 *   - `swKeywords` arrays hold the Swahili intent-matcher aliases that get
 *     spread alongside the English keywords in each descriptor.
 *
 * Namespaced by panel so call-sites read `S.<panel>.<slot>.{sw,en}`.
 */

export const ownerOsBStrings = {
  geology: {
    label: { sw: 'Jiolojia', en: 'Geology' },
    description: {
      sw: 'Kumbukumbu za visima, matokeo ya assay na imani ya orebody.',
      en: 'Drill-hole log, assay results and orebody confidence.',
    },
    toolUploadAssay: { sw: 'Pakia matokeo ya assay', en: 'Upload assay results' },
    heroTitle: { sw: 'Jiolojia', en: 'Geology' },
    heroSubtitle: {
      sw: 'Kumbukumbu za visima, foleni ya assay na mkondo wa imani ya orebody kwa tovuti.',
      en: 'Drill-hole log, assay queue and orebody-confidence sparkline per site.',
    },
    emptyTitle: {
      sw: 'Eneo la jiolojia linakuja hivi karibuni',
      en: 'Geology surface landing soon',
    },
    emptyBody: {
      sw: 'Kumbukumbu za visima tayari zipo kwenye huduma ya jiolojia. Paneli hii itaonyesha foleni ya assay kwa tovuti na chati ya imani ya orebody mara tu /api/v1/geology/drillholes itakapozinduliwa.',
      en: 'The drill-hole log already exists in the geology service. This panel will surface a per-site assay queue and orebody-confidence chart once /api/v1/geology/drillholes is exposed.',
    },
    swKeywords: ['jiolojia', 'sampuli'],
  },

  hr: {
    label: { sw: 'Wafanyakazi', en: 'HR' },
    description: {
      sw: 'Orodha ya wafanyakazi, idadi, wasimamizi, mafuta na zamu.',
      en: 'Workforce roster, headcount, supervisors, fuel and shifts.',
    },
    toolOpenRoster: { sw: 'Fungua ratiba', en: 'Open roster' },
    toolDraftOffer: { sw: 'Tayarisha barua ya ajira', en: 'Draft offer letter' },
    heroTitle: { sw: 'Wafanyakazi na rasilimali watu', en: 'HR — workforce & people' },
    heroSubtitle: {
      sw: 'Ratiba, wasimamizi, mahudhurio, kumbukumbu za mafuta na orodha ya matukio kwa kila tovuti.',
      en: 'Roster, supervisors, attendance, fuel logs and incident feed across every site.',
    },
    scopedTo: (siteId: string) => ({
      sw: `Imepangwa kwa ${siteId}`,
      en: `Scoped to ${siteId}`,
    }),
    swKeywords: ['wafanyakazi', 'mfanyakazi', 'mshahara', 'zamu', 'mahudhurio'],
  },

  holdings: {
    label: { sw: 'Mali za Familia', en: 'Holdings' },
    description: {
      sw: 'Muundo wa familia, ngazi za kumiliki, na muundo wa kundi.',
      en: 'Family structure, shareholding tiers, and group composition.',
    },
    toolViewStructure: { sw: 'Angalia muundo wa mali', en: 'View holdings structure' },
    heroTitle: {
      sw: 'Mali za Familia — muundo wa familia na kumiliki',
      en: 'Holdings — family structure and ownership',
    },
    heroSubtitle: {
      sw: 'Angalia ngazi za kumiliki wa familia na muundo wa kundi kwa haraka.',
      en: "View your family's shareholding tiers and group composition at a glance.",
    },
    emptyTitle: { sw: 'Hakuna data ya mali bado', en: 'No holdings data yet' },
    emptyDescription: {
      sw: 'Ongeza muundo wa familia na habari ya kumiliki kuanza.',
      en: 'Add your family structure and shareholding information to get started.',
    },
    emptyCta: { sw: 'Ongeza mali', en: 'Add holdings' },
    swKeywords: ['mali', 'muundo', 'kumiliki'],
  },

  licences: {
    label: { sw: 'Leseni', en: 'Licences' },
    description: {
      sw: 'Kalenda ya PML, ML, SML pamoja na pakiti ya upyaji wa Tume ya Madini.',
      en: 'PML, ML, SML calendar with Mining Commission renewal pack.',
    },
    toolDraftRenewal: { sw: 'Tayarisha pakiti ya upyaji', en: 'Draft renewal pack' },
    toolViewHistory: { sw: 'Onyesha historia', en: 'View licence history' },
    heroTitle: { sw: 'Leseni', en: 'Licences' },
    heroSubtitle: {
      sw: 'Kalenda ya siku-precise ya muda wa kuisha kwa kila PML, ML na SML kwenye kampuni.',
      en: 'Day-precise expiry calendar across every PML, ML and SML in the portfolio.',
    },
    swKeywords: ['leseni', 'upyaji', 'kibali'],
  },

  marketplace: {
    label: { sw: 'Soko', en: 'Marketplace' },
    description: {
      sw: 'Mizigo ya madini, wanunuzi waliokaguliwa, daraja la LBMA na ulinganishaji.',
      en: 'Ore parcels, vetted buyers, LBMA grading and bid matching.',
    },
    toolListParcel: { sw: 'Tangaza mzigo mpya', en: 'List new ore parcel' },
    toolComparePrices: { sw: 'Linganisha bei', en: 'Compare prices' },
    heroTitle: { sw: 'Soko', en: 'Marketplace' },
    heroSubtitle: {
      sw: 'Ubao wa moja kwa moja wa mizigo ya madini wenye wanunuzi waliokaguliwa, dhahabu ya LBMA na vito vya ICA.',
      en: 'Live ore-parcel board with vetted buyers, LBMA-graded gold parcels and ICA-graded gemstones.',
    },
    swKeywords: ['soko', 'mzigo', 'mnunuzi'],
  },

  ops: {
    label: { sw: 'Shughuli', en: 'Operations' },
    description: {
      sw: 'Muhtasari wa shughuli toka pit hadi bandari: tovuti, usalama na ubaguzi.',
      en: 'Pit-to-port ops overview: sites, safety and field exceptions.',
    },
    toolOpenSiteCockpit: { sw: 'Fungua kituo cha tovuti', en: 'Open site cockpit' },
    toolRunShiftRecon: {
      sw: 'Endesha ulinganishaji wa zamu',
      en: 'Run shift reconciliation',
    },
    heroTitle: { sw: 'Shughuli — toka pit hadi bandari', en: 'Operations — pit to port' },
    heroSubtitle: {
      sw: 'Muhtasari wa moja kwa moja wa shughuli kwenye tovuti, usalama na ubaguzi wa shamba.',
      en: 'Live operating snapshot across sites, safety and field exceptions.',
    },
    tileProducingSites: { sw: 'Tovuti zinazozalisha', en: 'Producing sites' },
    tileProducingSitesSub: { sw: '2 katika maendeleo', en: '2 in development' },
    tileOpenIncidents: { sw: 'Matukio yanayoendelea', en: 'Open incidents' },
    tileOpenIncidentsSub: { sw: '1 muhimu', en: '1 critical' },
    tileOnShift: { sw: 'Wafanyakazi zamuni', en: 'Workforce on-shift' },
    tileOnShiftSub: { sw: '−3 dhidi ya jana', en: '−3 vs yesterday' },
    headingSites: { sw: 'Tovuti', en: 'Sites' },
    headingSafety: { sw: 'Usalama', en: 'Safety' },
    swKeywords: ['shughuli', 'utendaji'],
  },

  regulatoryFilings: {
    label: { sw: 'Mafaili ya Wakaguzi', en: 'Regulator filings' },
    description: {
      sw: 'Mafaili ya Tume ya Madini, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC katika kalenda moja.',
      en: 'Mining Commission, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC filings on one calendar.',
    },
    toolNextDeadline: { sw: 'Angalia mwisho ujao', en: 'Check next deadline' },
    heroTitle: { sw: 'Mafaili ya Wakaguzi', en: 'Regulator filings' },
    heroSubtitle: {
      sw: 'Kila faili ya serikali kwenye kalenda moja ili hakuna inayopita tarehe yake.',
      en: 'Every government filing on one calendar so nothing slips past its due date.',
    },
    swKeywords: ['wakaguzi', 'mafaili'],
  },

  reports: {
    label: { sw: 'Ripoti', en: 'Reports' },
    description: {
      sw: 'Ripoti za robo mwaka, pakiti za mwezi na ripoti za sauti.',
      en: 'Quarterly briefs, monthly packs and audio reports.',
    },
    toolGenerateMonthly: { sw: 'Tengeneza pakiti ya mwezi', en: 'Generate monthly pack' },
    heroTitle: { sw: 'Ripoti', en: 'Reports' },
    heroSubtitle: {
      sw: 'Pakiti ya bodi ya mwezi, muhtasari wa robo mwaka na maktaba ya ripoti za sauti za Bw. Mwikila.',
      en: 'Monthly board pack, quarterly brief and the audio-report library Mr. Mwikila narrates.',
    },
    emptyTitle: {
      sw: 'Maktaba ya ripoti inakuja hivi karibuni',
      en: 'Reports library landing soon',
    },
    emptyBody: {
      sw: 'Pakiti ya report-engine tayari inazalisha pakiti za mwezi. Paneli hii itaonyesha maktaba pamoja na sauti ya Bw. Mwikila mara tu /api/v1/reports itakapozinduliwa.',
      en: "The report-engine package already produces monthly packs. This panel will surface the library + Mr. Mwikila's audio narration once /api/v1/reports is exposed inside the cockpit tab loop.",
    },
    swKeywords: ['ripoti', 'muhtasari'],
  },

  risk: {
    label: { sw: 'Hatari', en: 'Risk' },
    description: {
      sw: 'FX, hatua za udhibiti, hali ya kill-switch na ishara za udanganyifu.',
      en: 'FX exposure, critical controls, kill-switch state and fraud signals.',
    },
    toolKillSwitch: { sw: 'Hali ya kill-switch', en: 'Kill-switch state' },
    toolExposureSnapshot: { sw: 'Endesha picha ya exposure', en: 'Run exposure snapshot' },
    heroTitle: {
      sw: 'Hatari — exposure, vidhibiti, kill-switch',
      en: 'Risk — exposure, controls, kill-switch',
    },
    heroSubtitle: {
      sw: 'Eneo la moja kwa moja la hatari: ngazi ya FX exposure, afya ya vidhibiti muhimu na hali ya kill-switch.',
      en: 'Live risk surface: FX exposure ladder, critical-controls health and the kill-switch arm state.',
    },
    tileFxExposure: { sw: 'FX exposure ya leo', en: 'Today FX exposure' },
    tileFxExposureSub: { sw: 'Dirisha la dhahabu wazi', en: 'Gold window open' },
    tileKillSwitch: { sw: 'Kill-switch', en: 'Kill-switch' },
    tileKillSwitchValue: { sw: 'ARMED', en: 'ARMED' },
    tileKillSwitchSub: { sw: 'fail-closed imewashwa', en: 'fail-closed armed' },
    tileCriticalControls: { sw: 'Vidhibiti muhimu', en: 'Critical controls' },
    tileCriticalControlsSub: { sw: '1 mwezini', en: '1 due this month' },
    focus: (topic: string) => ({ sw: `Mada: ${topic}`, en: `Focus: ${topic}` }),
    fraudHeading: { sw: 'Ishara za udanganyifu', en: 'Fraud signals' },
    fraudBody: {
      sw: 'Hakuna ishara za udanganyifu zilizoinuliwa katika saa 24 zilizopita. Kichanganuzi cha graph-RAG kinaendesha kila saa na kinarekodi tofauti kwenye hash-chain isiyoweza kubadilishwa.',
      en: 'No fraud signals raised in the last 24 hours. The graph-RAG anomaly scanner runs hourly and records deviations on the immutable hash-chain audit log.',
    },
    swKeywords: ['hatari', 'udanganyifu'],
  },

  safety: {
    label: { sw: 'Usalama', en: 'Safety' },
    description: {
      sw: 'Orodha ya matukio, vyeti vya ICA na maelezo ya toolbox.',
      en: 'Incident feed, ICA certifications and toolbox briefings.',
    },
    toolLogIncident: { sw: 'Sajili tukio jipya', en: 'Log new incident' },
    heroTitle: { sw: 'Usalama na EHS', en: 'Safety & EHS' },
    heroSubtitle: {
      sw: 'Matukio yanayoendelea, vyeti vya vifaa muhimu na orodha ya toolbox shamba.',
      en: 'Open incidents, critical-equipment certifications and the field toolbox queue.',
    },
    swKeywords: ['usalama', 'tukio', 'ajali'],
  },

  sites: {
    label: { sw: 'Tovuti', en: 'Sites' },
    description: {
      sw: 'Tovuti za uchimbaji, awamu, jiolojia na ulinganishaji wa uzalishaji.',
      en: 'Mining sites, phase, geology and production reconciliation.',
    },
    toolOpenCockpit: { sw: 'Fungua kituo cha tovuti', en: 'Open site cockpit' },
    heroTitle: { sw: 'Tovuti', en: 'Sites' },
    heroSubtitle: {
      sw: 'Kila tovuti ya uchimbaji: awamu, alama ya jiolojia na kifaa cha uzalishaji.',
      en: 'Every mining site across the portfolio: phase, geology score and production gauge.',
    },
    swKeywords: ['tovuti', 'mgodi', 'uzalishaji'],
  },

  succession: {
    label: { sw: 'Urithi', en: 'Succession' },
    description: {
      sw: 'Wosia, mpango wa urithi, na ufanisi wa kizazi kijacho.',
      en: 'Will, inheritance plan, and next-generation readiness.',
    },
    toolReviewPlan: { sw: 'Pigia tathmini mpango wa urithi', en: 'Review succession plan' },
    heroTitle: {
      sw: 'Urithi — wosia na mpango wa urithi',
      en: 'Succession — will and inheritance',
    },
    heroSubtitle: {
      sw: 'Andaa kizazi kijacho na uhakikishe kuendelea kwa familia.',
      en: 'Plan for the next generation and ensure family continuity.',
    },
    emptyTitle: { sw: 'Hakuna mpango wa urithi bado', en: 'No succession plan yet' },
    emptyDescription: {
      sw: 'Tengeneza mpango wa urithi kulinda urithi wako na uhakikishe kuendelea kwa familia.',
      en: 'Create a succession plan to protect your legacy and ensure family continuity.',
    },
    emptyCta: { sw: 'Tengeneza mpango wa urithi', en: 'Create succession plan' },
    swKeywords: ['urithi', 'wosia', 'kizazi', 'baadaye'],
  },

  treasury: {
    label: { sw: 'Hazina', en: 'Treasury' },
    description: {
      sw: 'FX, dirisha la dhahabu, hedging, BoT na muda wa kuuza.',
      en: 'FX, gold window, hedging, BoT exposure and sell timing.',
    },
    toolPlaceSellOrder: { sw: 'Tengeneza order ya kuuza', en: 'Place sell order' },
    toolHedgeWindow: { sw: 'Linda dirisha la leo', en: 'Hedge today window' },
    heroTitle: { sw: 'Hazina — FX na dirisha la dhahabu', en: 'Treasury — FX & gold window' },
    heroSubtitle: {
      sw: 'Mkondo wa moja kwa moja wa FX, msimulator wa kuuza dhidi ya kuhifadhi, na mfumo wa USD-cliff.',
      en: 'Live FX sparkline, sell-vs-stockpile simulator, and the persistent USD-cliff tracker.',
    },
    swKeywords: ['hazina', 'kuuza', 'dhahabu', 'fedha'],
  },

  workforce: {
    label: { sw: 'Wafanyakazi shamba', en: 'Workforce' },
    description: {
      sw: 'Mahudhurio ya zamu, kuingia kwa biometriki na uthibitisho wa wasimamizi.',
      en: 'Shift attendance, biometric clock-in and supervisor coverage.',
    },
    toolOpenShiftBoard: { sw: 'Fungua ubao wa zamu', en: 'Open shift board' },
    heroTitle: {
      sw: 'Wafanyakazi shamba — zamu na mahudhurio',
      en: 'Workforce — shifts & attendance',
    },
    heroSubtitle: {
      sw: 'Idadi ya wafanyakazi zamuni, uthibitisho wa wasimamizi, kuingia kwa biometriki na orodha ya mafuta.',
      en: 'On-shift headcount, supervisor coverage, biometric clock-in and fuel-log feed.',
    },
    swKeywords: ['mahudhurio', 'zamu'],
  },

  builtins: {
    chatLabel: { sw: 'Mazungumzo', en: 'Chat' },
    chatDescription: {
      sw: 'Ongea na Bw. Mwikila — COO wako wa AI wa madini.',
      en: 'Talk to Mr. Mwikila — your AI mining COO.',
    },
    docsLabel: { sw: 'Hati', en: 'Docs' },
    docsDescription: {
      sw: 'Sanduku la hati za mmiliki na maktaba.',
      en: 'Owner document inbox + filed library.',
    },
    draftsLabel: { sw: 'Rasimu', en: 'Drafts' },
    draftsDescription: {
      sw: 'Rasimu za barua na kadi za mrabaha zinazosubiri saini.',
      en: 'Draft messages, letters and royalty cards waiting for sign-off.',
    },
    remindersLabel: { sw: 'Vikumbusho', en: 'Reminders' },
    remindersDescription: { sw: 'Vikumbusho vyenye muda.', en: 'Time-anchored reminders + nudges.' },
    insightsLabel: { sw: 'Maarifa', en: 'Insights' },
    insightsDescription: {
      sw: 'Maarifa ya wilaya mtambuka kutoka brain.',
      en: 'Cross-domain insights surfaced by the brain.',
    },
    docContextLabel: { sw: 'Hati', en: 'Document' },
    docContextDescription: {
      sw: 'Mazungumzo yaliyopangwa kwa hati moja.',
      en: 'Conversation scoped to a single document.',
    },
    docsSwKeywords: ['hati'],
    draftsSwKeywords: ['rasimu'],
    remindersSwKeywords: ['kumbusho'],
    insightsSwKeywords: ['maarifa', 'mwelekeo'],
  },
} as const;
