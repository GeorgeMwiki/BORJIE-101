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
  // ── shared incident enum render (safety + people surfaces) ───────
  // One canonical sw term per concept — both surfaces localize the raw
  // `kind` / `severity` tokens returned by /api/v1/mining/incidents
  // through this single map so the same enum value never renders two
  // different ways across the cockpit. Unknown values fall back to a
  // localized placeholder (never the raw English token).
  incident: {
    kind: {
      safety: { sw: 'Usalama', en: 'Safety' },
      environmental: { sw: 'Mazingira', en: 'Environmental' },
      community: { sw: 'Jamii', en: 'Community' },
      near_miss: { sw: 'Tukio karibu', en: 'Near miss' },
      equipment_failure: { sw: 'Hitilafu ya mitambo', en: 'Equipment failure' },
      fatality: { sw: 'Kifo', en: 'Fatality' },
      unknown: { sw: 'Aina nyingine', en: 'Other' },
    },
    severity: {
      low: { sw: 'Chini', en: 'Low' },
      medium: { sw: 'Wastani', en: 'Medium' },
      high: { sw: 'Juu', en: 'High' },
      critical: { sw: 'Hatari kubwa', en: 'Critical' },
      fatality: { sw: 'Kifo', en: 'Fatality' },
      unknown: { sw: 'Haijulikani', en: 'Unknown' },
    },
  },

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
    // Recent-reports chip strip + honest empty states.
    recentHeading: { sw: 'Ripoti za hivi karibuni', en: 'Recent reports' },
    recentLoading: { sw: 'Inapakia ripoti…', en: 'Loading reports…' },
    noRecent: {
      sw: 'Hakuna ripoti iliyozalishwa bado. Tengeneza ripoti hapa chini ili kuisikiliza.',
      en: 'No reports generated yet. Create one below to listen to it here.',
    },
    noSelection: {
      sw: 'Chagua ripoti hapo juu ili kuanza kuisikiliza.',
      en: 'Pick a report above to start listening.',
    },
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
      sw: 'Bw. Mwikila anapendekeza kubandika: {title}',
      en: 'Mr. Mwikila suggests pinning: {title}',
    },
  },

  // ── components/genui-tab/GenUITabHost.tsx ────────────────────────
  genUITabHost: {
    loading: { sw: 'Inapakia kichupo…', en: 'Loading tab…' },
    notFound: { sw: 'Kichupo hiki hakipatikani tena.', en: 'This tab is no longer available.' },
    errorPrefix: { sw: 'Imeshindwa kupakia kichupo hiki:', en: 'Could not load this tab:' },
    empty: { sw: 'Kichupo hiki bado hakina sehemu.', en: 'This tab has no sections yet.' },
  },

  // ── lib/screens.ts (titleSw + intentSw values, keyed by screen id) ─
  // `sw` is the Swahili title (mirrors the EN `title`); `en` is the EN
  // title source-of-truth check; `intentSw` is a faithful Swahili
  // rendering of the EN `intent` paragraph so the page hero/header can
  // render the intent in the active locale with FULL parity (zero-mix:
  // never an EN intent under an SW title).
  screens: {
    'O-W-00': {
      sw: 'Nyumbani — ongea na Borjie',
      en: 'Home — chat with Borjie',
      intentSw:
        'Nyumbani inayoanzia kwa mazungumzo. Salamu za persona, vidokezo vya mapendekezo, manukuu, na pembeni ya miito ya zana za mratibu.',
    },
    'O-W-01': {
      sw: 'Dashibodi ya Mkurugenzi',
      en: 'Cockpit dashboard',
      intentSw: 'Dashibodi ya kila siku ya kadi 10 kwa mujibu wa BOJI_AI_SPEC §13.',
    },
    'O-W-02': {
      sw: 'Akili Kuu',
      en: 'Conversational Master Brain',
      intentSw:
        'Eneo kamili la mazungumzo lenye alama za miito ya wakala na mitindo 8 ya Mkurugenzi.',
    },
    'O-W-03': {
      sw: 'Ramani ya Biashara',
      en: 'LMBM graph explorer',
      intentSw:
        'Nodi za grafu zinazobonyezwa katika Ramani Hai ya Biashara ya Madini; ufuatiliaji wa chanzo.',
    },
    'O-W-04': {
      sw: 'Hati na Mazungumzo',
      en: 'Document chat (full PDF view)',
      intentSw:
        'Mwangaza wa visanduku-mipaka na muonekano wa kulinganisha kati ya faili za PDF.',
    },
    'O-W-05': {
      sw: 'Ramani ya Kampuni',
      en: 'Portfolio map',
      intentSw:
        'Tabaka za PostGIS + Mapbox: leseni, migodi, makazi, maji, maeneo yaliyohifadhiwa, barabara.',
    },
    'O-W-06': {
      sw: 'Kituo cha Mgodi',
      en: 'Site cockpit',
      intentSw:
        'Upatanishi wa zamu, alama ya jiolojia, na uchumi wa kitengo kwa kila mgodi.',
    },
    'O-W-07': {
      sw: 'Leseni',
      en: 'Licence cockpit',
      intentSw:
        'Kifurushi cha kuhuisha, alama ya kutotumika, na historia ya malipo kwa kila haki ya madini.',
    },
    'O-W-07a': {
      sw: 'Leseni zote',
      en: 'Licences index',
      intentSw:
        'Kila leseni chini ya mteja hai; bonyeza kuingia kwenye kituo chake.',
    },
    'O-W-06a': {
      sw: 'Migodi yote',
      en: 'Sites index',
      intentSw:
        'Kila mgodi wa kimwili chini ya mteja hai; bonyeza kuingia kwenye kituo chake.',
    },
    'O-W-08': {
      sw: 'Watu na Majukumu',
      en: 'People & roles',
      intentSw: 'Chati ya shirika, daftari la malipo ya mbele, na uzalishaji kwa awamu.',
    },
    'O-W-09': {
      sw: 'Mali na Magari',
      en: 'Assets & fleet',
      intentSw:
        'Uwakilishi wa kipengele-mlinganisho na alama za matengenezo ya kutabiri.',
    },
    'O-W-10': {
      sw: 'Bidhaa na Manunuzi',
      en: 'Inventory & procurement',
      intentSw: 'Ratiba ya kuagiza upya; hali ya uzingatiaji wa ITC ya wasambazaji.',
    },
    'O-W-11': {
      sw: 'Jiolojia',
      en: 'Geology workbench',
      intentSw:
        'Muonekano wa mgodi wa 3D, upembuzi-pembe wa mishipa, na chati za QA/QC za uchanganuzi.',
    },
    'O-W-12': {
      sw: 'Gharama na Fedha',
      en: 'Cost & finance',
      intentSw:
        'Faida na hasara kamili, uchumi wa kitengo, na uhamasishaji wa kiwango-sawa.',
    },
    'O-W-13': {
      sw: 'Mauzo',
      en: 'Sales & pipeline',
      intentSw: 'Ulinganishaji wa bei-halisi kwa kila mnunuzi; ufuatiliaji wa malipo.',
    },
    'O-W-14': {
      sw: 'Uzingatiaji',
      en: 'Compliance centre',
      intentSw: 'Maktaba ya manukuu ya mdhibiti; orodha ya hatua.',
    },
    'O-W-15': {
      sw: 'Usalama na Afya',
      en: 'Safety & EHS',
      intentSw: 'Vidhibiti muhimu; ramani-joto ya matukio.',
    },
    'O-W-16': {
      sw: 'Jamii na CSR',
      en: 'Community & CSR',
      intentSw: 'Hifadhi ya kumbukumbu; dashibodi ya utoaji; ramani ya malalamiko.',
    },
    'O-W-17': {
      sw: 'Hazina na FX',
      en: 'FX & treasury',
      intentSw:
        'Viwango vya moja kwa moja; kiigizaji cha kuuza-au-kuhifadhi; kifuatiliaji cha mwamba wa 27-Mar.',
    },
    'O-W-18': {
      sw: 'Ripoti',
      en: 'Reports & exports',
      intentSw:
        'Vifurushi vya kila siku, kila wiki, kila mwezi, mwekezaji, benki, bodi, na ukaguzi.',
    },
    'O-W-19': {
      sw: 'Kampuni Nyingi',
      en: 'Multi-company group view',
      intentSw: 'Muhtasari wa makampuni mengi kwa wateja wa mpango wa kampuni / kundi.',
    },
    'O-W-20': {
      sw: 'Soko na Washirika',
      en: 'Marketplace & external partners',
      intentSw: 'Ugunduzi wa washirika na ofa za pande mbili.',
    },
    'O-W-21': {
      sw: 'Kuanza na Kuingiza Data',
      en: 'Onboarding & data import',
      intentSw: 'Pakia kwa wingi faili za PML PDF, madaftari, na ripoti za awali.',
    },
    'O-W-22': {
      sw: 'Mipangilio',
      en: 'Settings — users, roles, plan, billing, autonomy',
      intentSw:
        'Mhariri wa RBAC, ankara, sera ya uhuru, na maboresho ya mpango.',
    },
    'O-W-23': {
      sw: 'Uliza Borjie',
      en: 'Ask Borjie Brain',
      intentSw:
        'Muunganisho wa moja kwa moja na POST /api/v1/brain/turn — mazungumzo kamili yenye ushahidi unaonukuliwa kutoka korpasi.',
    },
    'D-W-01': {
      sw: 'Dashibodi',
      en: 'Dashboard',
      intentSw:
        'Muonekano wa pili wa hali iliyopangwa. Nafasi saba kutoka /api/v1/owner/brief: muhtasari wa AI, foleni ya tahadhari, ukanda wa KPI, uzalishaji, fedha + mwamba wa USD, uzingatiaji, usalama.',
    },
    'O-W-24': {
      sw: 'Washirika wa Nje',
      en: 'Counterparties',
      intentSw:
        'Kila mshirika ambaye operesheni inagusana naye (juu, chini, na pembeni) wenye kadi-alama na ratiba kamili ya ushirikiano.',
    },
    'O-W-25': {
      sw: 'Mlolongo wa Mali',
      en: 'Chain of custody',
      intentSw:
        'Mlolongo wa uangalizi toka shimoni hadi mnunuzi kwa kila pakiti ya madini, ukaguliwa kwa mlolongo-heshi ili mdhibiti aweze kuthibitisha hakuna kilichopangwa upya.',
    },
    'O-W-26': {
      sw: 'Kalenda ya Wakaguzi',
      en: 'Regulatory calendar',
      intentSw:
        'Kila uwasilishaji wa Tume ya Madini, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, na LHRC kwenye kalenda moja, ukiwekewa rangi kwa hali.',
    },
    'O-W-27': {
      sw: 'Muonekano wa Miliki',
      en: 'Estate overview',
      intentSw:
        'Ganda la ofisi-ya-familia, muonekano-mti wa kila kampuni, thamani jumla ya mali, mitiririko ya hivi karibuni ya mtaji, na hali ya urithi.',
    },
    'O-W-28': {
      sw: 'Kampuni za Miliki',
      en: 'Estate entities',
      intentSw:
        'Kila biashara chini ya ganda la ofisi-ya-familia yenye aina, asilimia ya umiliki, na hali ya mzunguko-wa-maisha.',
    },
    'O-W-29': {
      sw: 'Mitiririko ya Mtaji',
      en: 'Capital flows',
      intentSw:
        'Mitiririko ya fedha kati ya kampuni kwa mpangilio wa muda: gawio, mikopo ya ndani, sindano za mtaji, na migawanyo ya JV.',
    },
    'O-W-30': {
      sw: 'Urithi',
      en: 'Succession',
      intentSw:
        'Mpango wa urithi kwa kila kundi, mrithi aliyeteuliwa, mpango wa dharura, kidokezo cha tarehe ya mapitio, na uwezo wa wosia-rasimu.',
    },
    'O-W-31': {
      sw: 'Daftari la Mali',
      en: 'Asset register',
      intentSw:
        'Daftari la mali lililounganishwa linaloweza kuchujwa kwa aina lenye thamani ya sasa na vizuizi.',
    },
    'O-W-32': {
      sw: 'Taarifa ya Asubuhi',
      en: 'Head briefing',
      intentSw:
        'Skrini ya kwanza ya kuingia: shughuli za usiku za kujiendesha, idhini zinazosubiri, kupandishwa, mabadiliko ya KPI, mapendekezo, na hitilafu kama hati moja iliyopangwa.',
    },
    'O-W-33': {
      sw: 'Mipango ya Wakala',
      en: 'Agentic plans & sandbox',
      intentSw:
        'Foleni ya mapitio ya MD-wakala: maandishi yaliyopangwa ya sandbox aliyopendekeza brain, yenye idhini ya macho-manne (inatekeleza kwa pamoja) na kukataa. Soma-kwanza; idhini ndiyo njia ya hatari-kubwa.',
    },
  },
} as const;
