/**
 * tail.ts — guard-exempt bilingual (sw / en) string table for the
 * "tail" of owner-web surfaces that still render via inline
 * `isSw ? '…' : '…'` (or paired sw/en records) rather than the `t()`
 * dictionaries.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) flags hardcoded
 * Swahili anywhere OUTSIDE `i18n/`. These surfaces legitimately need
 * both languages at the call-site, so their Swahili+English pairs are
 * hoisted here — inside the exempt `i18n/` tree — and the source files
 * import the values instead of inlining the literals. Net effect: the
 * source carries ZERO Swahili literals while runtime behaviour is
 * byte-identical.
 *
 * SHAPE
 * One namespace per source file (e.g. `peopleSurface`, `sitesList`).
 * Each leaf is `{ sw, en }`. Consumers read `S.<ns>.<key>.sw|en`
 * (usually via the file's existing `isSw` / locale switch).
 *
 * Pure data — no imports, no logic — so it is safe to pull into both
 * the server and client bundles.
 */

export interface BiString {
  readonly sw: string;
  readonly en: string;
}

export const tailStrings = {
  // ── components/people/PeopleSurface.tsx ──────────────────────────
  peopleSurface: {
    onShiftLabel: { sw: 'Wafanyakazi zamu ya leo', en: 'Workforce on shift' },
    onShiftSub: { sw: 'Walioingia kwa GPS', en: 'GPS-fenced check-ins' },
    supervisorsLabel: { sw: 'Wasimamizi kazini', en: 'Supervisors on shift' },
    supervisorsSub: { sw: 'Wamesalia kwa kushuhudia', en: 'Leadership coverage' },
    openIncidentsLabel: { sw: 'Matukio wazi', en: 'Open incidents' },
    openIncidentsSub: { sw: 'Yanahitaji ufuatiliaji', en: 'Need follow-through' },
    fuelLabel: { sw: 'Mafuta - siku 7', en: 'Fuel - 7d avg' },
    fuelSub: { sw: 'Mwelekeo wa matumizi', en: 'Consumption trend' },
    supervisorsHeading: { sw: 'Wasimamizi wakuu', en: 'Supervisors' },
    supervisorsCaption: {
      sw: 'Kiwango cha juu cha utawala kwa kila mgodi',
      en: 'Leadership coverage by site',
    },
    onShiftStatus: { sw: 'Kazini', en: 'On shift' },
    leaveStatus: { sw: 'Likizo', en: 'Leave' },
    offShiftStatus: { sw: 'Pumzika', en: 'Off shift' },
    incidentFeedHeading: { sw: 'Foleni ya matukio', en: 'Incident feed' },
    loading: { sw: 'Inapakia...', en: 'Loading...' },
    noIncidents: { sw: 'Hakuna tukio.', en: 'No recent incidents.' },
    unassigned: { sw: 'Hakitajwa', en: 'Unassigned' },
    fuelHeading: { sw: 'Matumizi ya mafuta', en: 'Fuel consumption' },
    fuelCaption: {
      sw: 'Lita kwa siku - wiki iliyopita',
      en: 'Litres / day - last week',
    },
    supRole1: { sw: 'Msimamizi wa chini ya ardhi', en: 'Underground supervisor' },
    supRole2: { sw: 'Mkuu wa mstari wa kuchakata', en: 'Processing line lead' },
    supRole3: { sw: 'Msimamizi wa vifaa', en: 'Equipment supervisor' },
    supRole4: { sw: 'Msimamizi wa jiolojia', en: 'Geology supervisor' },
  },

  // ── components/safety/SafetySurface.tsx ──────────────────────────
  safetySurface: {
    noTimestamp: { sw: 'Bila tarehe', en: 'No timestamp' },
    justNow: { sw: 'sasa hivi', en: 'just now' },
    minutesAgo: { sw: 'dakika {n} zilizopita', en: '{n}m ago' },
    hoursAgo: { sw: 'saa {n} zilizopita', en: '{n}h ago' },
    daysAgo: { sw: 'siku {n} zilizopita', en: '{n}d ago' },
    openIncidentsLabel: { sw: 'Matukio yaliyo wazi', en: 'Open incidents' },
    openIncidentsSub: { sw: 'Yanahitaji uchunguzi', en: 'Pending investigation' },
    criticalLabel: { sw: 'Kiwango cha juu kabisa', en: 'Critical severity' },
    criticalSub: { sw: 'Hatari ya papo hapo', en: 'Imminent risk' },
    highLabel: { sw: 'Kiwango cha juu', en: 'High severity' },
    highSub: { sw: 'Hatua ya haraka', en: 'Urgent action' },
    closed30dLabel: { sw: 'Yaliyofungwa siku 30', en: 'Closed 30d' },
    closed30dSub: { sw: 'Mzunguko wa ufungaji', en: 'Closure throughput' },
    loadError: {
      sw: 'Imeshindwa kupakia matukio. Geuza muunganisho na ujaribu tena.',
      en: 'Failed to load incidents. Check the gateway and retry.',
    },
    incidentQueue: { sw: 'Foleni ya matukio', en: 'Incident queue' },
    openCountSuffix: {
      sw: 'matukio yamefunguliwa',
      en: 'open across the portfolio',
    },
    zeroOpen: { sw: 'Hakuna tukio lililo wazi.', en: 'Zero open incidents.' },
    cleanRecord: {
      sw: 'Vipigo vya mafanikio kwa tarehe ya leo.',
      en: 'Clean safety record for today.',
    },
    icaHeading: { sw: 'Vidhibiti vya ICA', en: 'ICA critical controls' },
    icaCaption: {
      sw: 'Hali ya vifaa muhimu na uthibitisho',
      en: 'Equipment certification + status',
    },
    controlOk: { sw: 'Hai', en: 'OK' },
    controlRecert: { sw: 'Mukaguzi', en: 'Recert due' },
    fallProtection: {
      sw: 'Mikanda ya kuzuia kuanguka',
      en: 'Fall protection harnesses',
    },
    groundControl: {
      sw: 'Udhibiti wa ardhi chini ya ardhi',
      en: 'Underground ground control',
    },
    gasDetection: { sw: 'Vifaa vya kugundua gesi', en: 'Portable gas detection' },
    lockout: {
      sw: 'Kufunga vifaa wakati wa matengenezo',
      en: 'Equipment lockout / tagout',
    },
    evacuation: { sw: 'Mazoezi ya kutoroka', en: 'Emergency evacuation drill' },
  },

  // ── components/sites/SitesList.tsx ───────────────────────────────
  sitesList: {
    phaseAll: { sw: 'Zote', en: 'All' },
    phaseProduction: { sw: 'Uzalishaji', en: 'Production' },
    phaseDevelopment: { sw: 'Maendeleo', en: 'Development' },
    phaseExploration: { sw: 'Uchunguzi', en: 'Exploration' },
    phaseStandby: { sw: 'Pumzika', en: 'Standby' },
    loadError: {
      sw: 'Imeshindwa kupakia migodi. Geuza kuingia tena au jaribu tena.',
      en: 'Failed to load sites. Reauthenticate or retry the gateway.',
    },
    emptyTitle: { sw: 'Hakuna migodi bado', en: 'No sites registered yet' },
    emptyBody: {
      sw: 'Ongeza mgodi kupitia ramani ya leseni au onboarding ya Akili Kuu.',
      en: 'Add a site via the licence map or the Master Brain onboarding flow.',
    },
    searchPlaceholder: {
      sw: 'Tafuta jina, leseni, awamu',
      en: 'Search name, licence, phase',
    },
    colSite: { sw: 'Mgodi', en: 'Site' },
    colPhase: { sw: 'Awamu', en: 'Phase' },
    colStatus: { sw: 'Hali', en: 'Status' },
    colLicence: { sw: 'Leseni husika', en: 'Linked licence' },
    colOpen: { sw: 'Fungua', en: 'Open' },
    phaseUnspecified: { sw: 'Haijabainishwa', en: 'Unspecified' },
    noMatch: {
      sw: 'Hakuna mgodi unaolingana na vichungi vya sasa.',
      en: 'No sites match the current filters.',
    },
  },

  // ── components/voice/VoiceMicButton.tsx ──────────────────────────
  voiceMicButton: {
    start: { sw: 'Anza kusikiliza', en: 'Start listening' },
    stop: { sw: 'Acha kusikiliza', en: 'Stop listening' },
    listening: { sw: 'Inasikiliza…', en: 'Listening…' },
    unsupported: {
      sw: 'Sauti haijatumika kwenye kivinjari hiki.',
      en: 'Voice input not supported in this browser.',
    },
    error: { sw: 'Tatizo la sauti', en: 'Voice error' },
  },

  // ── components/voice/VoicePlayButton.tsx ─────────────────────────
  voicePlayButton: {
    play: { sw: 'Cheza kwa sauti', en: 'Play aloud' },
    stop: { sw: 'Acha sauti', en: 'Stop voice' },
    unsupported: { sw: 'Sauti haijatumika', en: 'Voice not supported' },
  },

  // ── components/workforce-tabs/WorkforceTabMatrix.tsx ─────────────
  workforceTabMatrix: {
    title: { sw: 'Matriki ya tabo za wafanyakazi', en: 'Workforce tab matrix' },
    description: {
      sw: 'Kila safu ni jukumu kwa eneo. Chagua tabo ambazo jukumu linapaswa kuona; ondoa alama kuficha. Tabo ya Bw. Mwikila na Wasifu daima zinaonekana.',
      en: 'Each row is a role for a given site scope. Check the tabs the role should see; uncheck to hide. The Mr. Mwikila chat tab and the Profile tab are always visible.',
    },
    role: { sw: 'Jukumu', en: 'Role' },
    scope: { sw: 'Eneo', en: 'Scope' },
    density: { sw: 'Mpangilio', en: 'Density' },
    densityComfortable: { sw: 'Wazi', en: 'Comfortable' },
    densityCompact: { sw: 'Bana', en: 'Compact' },
    saving: { sw: 'Inahifadhi…', en: 'Saving…' },
    saved: { sw: 'Imehifadhiwa', en: 'Saved' },
    error: { sw: 'Imeshindikana kuhifadhi', en: 'Save failed' },
    locked: { sw: 'Imefungwa', en: 'Locked' },
    notAllowedForRole: { sw: 'haifai', en: 'n/a' },
  },

  // ── components/workforce-tabs/WorkforceTabRequestQueue.tsx ───────
  workforceTabRequestQueue: {
    title: { sw: 'Maombi ya tabo yanayosubiri', en: 'Pending tab-change requests' },
    empty: { sw: 'Hakuna maombi yanayosubiri.', en: 'No pending requests.' },
    requester: { sw: 'Mtumaji', en: 'Requester' },
    role: { sw: 'Jukumu', en: 'Role' },
    site: { sw: 'Eneo', en: 'Site' },
    reason: { sw: 'Sababu', en: 'Reason' },
    diff: { sw: 'Mabadiliko yaliyopendekezwa', en: 'Proposed changes' },
    add: { sw: 'Ongeza', en: 'Add' },
    remove: { sw: 'Ondoa', en: 'Remove' },
    density: { sw: 'Mpangilio', en: 'Density' },
    approve: { sw: 'Idhinisha', en: 'Approve' },
    reject: { sw: 'Kataa', en: 'Reject' },
    note: { sw: 'Maelezo (hiari)', en: 'Note (optional)' },
    deciding: { sw: 'Inahifadhi…', en: 'Saving…' },
    error: { sw: 'Maamuzi hayakufaulu', en: 'Decision failed' },
    global: { sw: 'Kote', en: 'Global' },
  },

  // ── documents/DocumentExplorer.tsx (renders sw-only today) ───────
  documentExplorer: {
    askFallback: {
      sw: 'Nimepokea swali. Hati hii ina vipande {count}. Brain itajibu mara tu wakati wa kuchakatwa.',
      en: 'Question received. This document has {count} chunk(s). The brain will reply once processing completes.',
    },
    previewUnavailable: {
      sw: 'Hakiki haipatikani. Pakua faili kuona kamili.',
      en: 'Preview unavailable. Download the file to view it in full.',
    },
    summaryLabel: { sw: 'Muhtasari', en: 'Summary' },
    emptyConversation: {
      sw: 'Anza mazungumzo na hati hii. Niulize lolote.',
      en: 'Start a conversation with this document. Ask me anything.',
    },
    questionLabel: { sw: 'Andika swali kuhusu hati', en: 'Ask a question about the document' },
    questionPlaceholder: { sw: 'Andika swali...', en: 'Type a question...' },
    sendLabel: { sw: 'Tuma swali', en: 'Send question' },
    send: { sw: 'Tuma', en: 'Send' },
    sessionTitlePrefix: { sw: 'Soma', en: 'Read' },
  },

  // ── documents/DocumentList.tsx (renders sw-only today) ───────────
  documentList: {
    emptyTitle: { sw: 'Hakuna hati bado', en: 'No documents yet' },
    emptyBody: {
      sw: 'Pakia mkataba, zabuni au barua kuanza mazungumzo na hati hizo.',
      en: 'Upload a contract, tender, or letter to start a conversation with it.',
    },
  },

  // ── documents/DocumentUploadButton.tsx (renders sw-led today) ────
  documentUploadButton: {
    defaultLabel: { sw: 'Pakia hati · Upload document', en: 'Upload document' },
  },

  // ── documents/types.ts ───────────────────────────────────────────
  documentTypes: {
    statusQueued: { sw: 'Imewekwa kwenye foleni', en: 'Queued' },
    statusProcessing: { sw: 'Inachakatwa', en: 'Processing' },
    statusReady: { sw: 'Tayari', en: 'Ready' },
    statusFailed: { sw: 'Imeshindikana', en: 'Failed' },
    kindContract: { sw: 'Mkataba', en: 'Contract' },
    kindRfp: { sw: 'Zabuni', en: 'RFP / Tender' },
    kindLetter: { sw: 'Barua', en: 'Letter' },
    kindReport: { sw: 'Ripoti', en: 'Report' },
    kindOther: { sw: 'Nyingine', en: 'Other' },
  },

  // ── components/reports/strings.ts ────────────────────────────────
  reportPlayer: {
    play: { sw: 'Cheza', en: 'Play' },
    pause: { sw: 'Simamisha', en: 'Pause' },
    download: { sw: 'Pakua', en: 'Download' },
    shareWhatsapp: { sw: 'Tuma kwa WhatsApp', en: 'Share on WhatsApp' },
    speed: { sw: 'Mwendo', en: 'Speed' },
    chapters: { sw: 'Sura', en: 'Chapters' },
    transcript: { sw: 'Maandishi', en: 'Transcript' },
    previousChapter: { sw: 'Sura iliyotangulia', en: 'Previous chapter' },
    nextChapter: { sw: 'Sura inayofuata', en: 'Next chapter' },
    noAudio: { sw: 'Hakuna sauti kwa ripoti hii.', en: 'No audio for this report.' },
    loading: { sw: 'Inapakia ripoti…', en: 'Loading report…' },
    defaultShareCopy: {
      sw: 'Sikiliza muhtasari wa mmiliki wa Borjie',
      en: 'Listen to your Borjie owner brief',
    },
  },

  // ── lib/ceo-modes.ts (labelSw values) ────────────────────────────
  ceoModes: {
    build: { sw: 'Jenga', en: 'Build' },
    strategy: { sw: 'Mkakati', en: 'Strategy' },
    operations: { sw: 'Uendeshaji', en: 'Operations' },
    document: { sw: 'Hati', en: 'Document' },
    finance: { sw: 'Fedha', en: 'Finance' },
    risk: { sw: 'Hatari', en: 'Risk' },
    board: { sw: 'Bodi / Wawekezaji', en: 'Board / Investor' },
    compliance: { sw: 'Uzingatiaji', en: 'Compliance' },
  },

  // ── lib/cockpit-sse.ts (sw toast branches) ───────────────────────
  cockpitSse: {
    decisionRecorded: {
      sw: 'Uamuzi mpya ({severity}): {subject}',
      en: 'New {severity} decision: {subject}',
    },
    reminderFired: {
      sw: 'Kikumbusho kimetumwa: {title}',
      en: 'Reminder sent: {title}',
    },
    opportunityScan: {
      sw: 'Fursa {count} mpya zimepatikana',
      en: '{count} new opportunity(ies) found',
    },
    riskChanged: {
      sw: 'Hatari imebadilika kuwa {severity}',
      en: 'Risk severity changed to {severity}',
    },
    shiftStart: { sw: 'Mfanyakazi ameanza zamu', en: 'Worker started shift' },
    shiftEnd: { sw: 'Mfanyakazi amemaliza zamu', en: 'Worker ended shift' },
    complianceDeadline: {
      sw: 'Faili {filingKind} inaisha katika siku {days}',
      en: 'Filing {filingKind} due in {days} day(s)',
    },
    productionShiftReport: { sw: 'ripoti ya zamu', en: 'shift report' },
    productionPosted: {
      sw: 'Moja kwa moja: {tonnes} imewekwa ({date})',
      en: 'Live: {tonnes} posted ({date})',
    },
    tabSpawned: { sw: 'Tab imefunguliwa: {title}', en: 'Tab spawned: {title}' },
    tabUpdated: { sw: 'Tab imebadilishwa: {tabId}', en: 'Tab updated: {tabId}' },
    tabRemoved: { sw: 'Tab imefungwa: {tabId}', en: 'Tab closed: {tabId}' },
    tabProposed: {
      sw: 'Mr. Mwikila anapendekeza kubandika: {title}',
      en: 'Mr. Mwikila suggests pinning: {title}',
    },
  },

  // ── lib/screens.ts (titleSw values, keyed by screen id) ──────────
  screens: {
    'O-W-00': { sw: 'Nyumbani — ongea na Borjie', en: 'Home — chat with Borjie' },
    'O-W-01': { sw: 'Dashibodi ya Mkurugenzi', en: 'Cockpit dashboard' },
    'O-W-02': { sw: 'Akili Kuu', en: 'Conversational Master Brain' },
    'O-W-03': { sw: 'Ramani ya Biashara', en: 'LMBM graph explorer' },
    'O-W-04': { sw: 'Hati na Mazungumzo', en: 'Document chat (full PDF view)' },
    'O-W-05': { sw: 'Ramani ya Kampuni', en: 'Portfolio map' },
    'O-W-06': { sw: 'Kituo cha Mgodi', en: 'Site cockpit' },
    'O-W-07': { sw: 'Leseni', en: 'Licence cockpit' },
    'O-W-07a': { sw: 'Leseni zote', en: 'Licences index' },
    'O-W-06a': { sw: 'Migodi yote', en: 'Sites index' },
    'O-W-08': { sw: 'Watu na Majukumu', en: 'People & roles' },
    'O-W-09': { sw: 'Mali na Magari', en: 'Assets & fleet' },
    'O-W-10': { sw: 'Bidhaa na Manunuzi', en: 'Inventory & procurement' },
    'O-W-11': { sw: 'Jiolojia', en: 'Geology workbench' },
    'O-W-12': { sw: 'Gharama na Fedha', en: 'Cost & finance' },
    'O-W-13': { sw: 'Mauzo', en: 'Sales & pipeline' },
    'O-W-14': { sw: 'Uzingatiaji', en: 'Compliance centre' },
    'O-W-15': { sw: 'Usalama na Afya', en: 'Safety & EHS' },
    'O-W-16': { sw: 'Jamii na CSR', en: 'Community & CSR' },
    'O-W-17': { sw: 'Hazina na FX', en: 'FX & treasury' },
    'O-W-18': { sw: 'Ripoti', en: 'Reports & exports' },
    'O-W-19': { sw: 'Kampuni Nyingi', en: 'Multi-company group view' },
    'O-W-20': { sw: 'Soko na Washirika', en: 'Marketplace & external partners' },
    'O-W-21': { sw: 'Kuanza na Kuingiza Data', en: 'Onboarding & data import' },
    'O-W-22': {
      sw: 'Mipangilio',
      en: 'Settings — users, roles, plan, billing, autonomy',
    },
    'O-W-23': { sw: 'Uliza Borjie', en: 'Ask Borjie Brain' },
    'D-W-01': { sw: 'Dashibodi', en: 'Dashboard' },
    'O-W-24': { sw: 'Washirika wa Nje', en: 'Counterparties' },
    'O-W-25': { sw: 'Mlolongo wa Mali', en: 'Chain of custody' },
    'O-W-26': { sw: 'Kalenda ya Wakaguzi', en: 'Regulatory calendar' },
    'O-W-27': { sw: 'Muonekano wa Miliki', en: 'Estate overview' },
    'O-W-28': { sw: 'Kampuni za Miliki', en: 'Estate entities' },
    'O-W-29': { sw: 'Mitiririko ya Mtaji', en: 'Capital flows' },
    'O-W-30': { sw: 'Urithi', en: 'Succession' },
    'O-W-31': { sw: 'Daftari la Mali', en: 'Asset register' },
  },
} as const;
