/**
 * owner-os-a — guard-exempt Swahili+English string table for the first
 * batch of owner-os cockpit panels and shells.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) flags any Swahili
 * literal that appears in CODE outside `i18n/`. The owner-os panels used
 * to carry inline Swahili — bilingual captions, `registerTab` descriptor
 * glosses, intent-matcher keyword lists — straight in the component body.
 * Moving those literals here (the `i18n/` tree is exempt) keeps the exact
 * same `isSw ? … : …` locale logic at the call site while removing every
 * hardcoded Swahili token from the components themselves.
 *
 * SHAPE
 * Namespaced by panel/shell. Each leaf is `{ sw, en }` so a call site can
 * stay perfectly symmetric: `{isSw ? S.x.key.sw : S.x.key.en}`. A handful
 * of leaves are interpolation FRAGMENTS (e.g. a `…Prefix` that precedes a
 * runtime value) — these keep the dynamic part at the call site while the
 * translated words live here. Keyword arrays (`*Keywords`) hold the
 * Swahili tokens the intent-matcher needs at runtime.
 *
 * Add new owner-os batches as sibling files (owner-os-b, …) rather than
 * letting this one grow past the project's 800-line file ceiling.
 */

export const ownerOsAStrings = {
  // ── components/owner-os/OwnerOSChatPanel.tsx ──────────────────────
  chatPanel: {
    dropHint: {
      sw: 'Vuta hati hapa — Mr. Mwikila atazisoma, kuziainisha, na kuzifungua kwa mazungumzo',
      en: 'Drop documents here — Mr. Mwikila reads, files, and opens them for conversation',
    },
    /** Followed at the call site by the count, then `filedDoneSuffix`. */
    filedDonePrefix: {
      sw: 'Hati ',
      en: 'Filed ',
    },
    filedDoneSuffix: {
      sw: ' zimewasilishwa',
      en: '',
    },
    /** Drag-only overlay headline (shown only while dragging over the panel). */
    dropOverlay: {
      sw: 'Achia hati hapa',
      en: 'Drop documents here',
    },
    /** No droppable file matched the accepted types. */
    noSupported: {
      sw: 'Hakuna faili linalokubalika kwenye ulichoachia',
      en: 'No supported files in that drop',
    },
    /** Generic intake failure (the gateway detail is appended at the site). */
    intakeFailed: {
      sw: 'Uwasilishaji umeshindwa',
      en: 'Intake failed',
    },
    /** Paperclip attach button accessible label. */
    attach: {
      sw: 'Ambatisha hati',
      en: 'Attach a document',
    },
  },

  // ── components/owner-os/OwnerOSDocsPanel.tsx ──────────────────────
  docsPanel: {
    heading: {
      sw: 'Hati zako',
      en: 'Your documents',
    },
    addHint: {
      sw: 'Drag-and-drop kwenye Chat ili kuongeza',
      en: 'Drag-and-drop on Chat to add',
    },
    empty: {
      sw: 'Hakuna hati bado. Vuta moja kwenye Chat tab.',
      en: 'No documents yet. Drop one in the Chat tab.',
    },
    ask: {
      sw: 'Uliza',
      en: 'Ask',
    },
    thinking: {
      sw: 'Inafikiria…',
      en: 'Thinking…',
    },
    explain: {
      sw: 'Eleza',
      en: 'Explain',
    },
  },

  // ── components/owner-os/OwnerOSInsightsPanel.tsx ──────────────────
  insightsPanel: {
    heading: {
      sw: 'Ushauri wa leo',
      en: "Today's advisor note",
    },
    unavailable: {
      sw: 'Akili haijapatikana sasa. Jaribu tena baadaye.',
      en: 'Brain ladder unavailable right now. Try again shortly.',
    },
  },

  // ── components/owner-os/SpawnTabMenu.tsx ──────────────────────────
  spawnMenu: {
    placeholder: {
      sw: 'Tafuta tab… (mfano: utii, hatari, hazina)',
      en: 'Search a tab… (e.g. compliance, risk, treasury)',
    },
    recent: {
      sw: 'Hivi karibuni',
      en: 'Recent',
    },
    showAll: {
      sw: 'Onyesha zote',
      en: 'Show all',
    },
    hideAll: {
      sw: 'Onyesha za hivi karibuni tu',
      en: 'Show recent only',
    },
    allHelp: {
      sw: 'Aina zote 14 za tab',
      en: 'All 14 tab types',
    },
    emptyTitle: {
      sw: 'Bado hujafungua tab yoyote',
      en: 'No tabs spawned yet',
    },
    emptyHelp: {
      sw: 'Mwambie Bw. Mwikila unahitaji nini, na atafungua tab sahihi.',
      en: 'Tell Mr. Mwikila what you need and he will open the right tab for you.',
    },
    askPlaceholder: {
      sw: 'mfano: onyesha NEMC ya Geita',
      en: 'e.g. show me NEMC for Geita',
    },
    askSend: {
      sw: 'Tuma kwa Bw. Mwikila',
      en: 'Send to Mr. Mwikila',
    },
    navigate: {
      sw: 'sogea',
      en: 'navigate',
    },
    open: {
      sw: 'fungua',
      en: 'open',
    },
    close: {
      sw: 'funga',
      en: 'close',
    },
    shortcut: {
      sw: 'Bonyeza Cmd+T kufungua haraka',
      en: 'Press Cmd+T to open quickly',
    },
    noMatch: {
      sw: 'Hakuna tab inayolingana',
      en: 'No matching tab',
    },
    footerHelp: {
      sw: 'Aina zote zinaonekana kwa "Onyesha zote".',
      en: 'Full set is one click away under "Show all".',
    },
    dialogLabel: {
      sw: 'Menyu ya kufungua tab',
      en: 'Spawn tab menu',
    },
    closeAria: {
      sw: 'Funga',
      en: 'Close',
    },
    listboxLabel: {
      sw: 'Tabs zinazoweza kufunguliwa',
      en: 'Spawnable tabs',
    },
  },

  // ── components/owner-os/TabSnapshotShell.tsx ──────────────────────
  snapshotShell: {
    waking: {
      sw: 'Inarudisha mtazamo…',
      en: 'Restoring view…',
    },
    sleeping: {
      sw: 'Imepumzika, data ya nyuma inabaki kwa Bw. Mwikila',
      en: 'Asleep — Mr. Mwikila still tracks this tab in the background',
    },
  },

  // ── components/owner-os/panels/AccountingPanel.tsx ────────────────
  accounting: {
    descriptorLabel: {
      sw: 'Uhasibu',
      en: 'Accounting',
    },
    descriptorDescription: {
      sw: 'Hesabu za kulipa, kupokea na maandiko ya leja.',
      en: 'Accounts payable, receivable and journal entries.',
    },
    keywordsSw: ['uhasibu', 'leja'],
    openJournalTool: {
      sw: 'Fungua leja',
      en: 'Open journal',
    },
    heroTitle: {
      sw: 'Uhasibu',
      en: 'Accounting',
    },
    heroSubtitle: {
      sw: 'Mlolongo wa moja kwa moja wa leja toka LedgerService; vipindi vya AP / AR vya umri.',
      en: 'Live journal feed off the LedgerService double-entry ledger; AP / AR ageing buckets.',
    },
    emptyTitle: {
      sw: 'Eneo la uhasibu linakuja hivi karibuni',
      en: 'Accounting workspace landing soon',
    },
    emptyBody: {
      sw: 'Vipindi vya hesabu, kivinjari cha leja na orodha ya ulinganishaji vitaonekana hapa mara tu BFF ya /api/v1/accounting itakapozinduliwa. Maandiko ya LedgerService tayari yapo; paneli hii ni mkataba wa muonekano.',
      en: 'Account ageing, journal browser and reconciliation queue will surface here once the /api/v1/accounting BFF is exposed. The LedgerService entries already exist; this panel is the surface contract.',
    },
  },

  // ── components/owner-os/panels/AncillaryBusinessesPanel.tsx ───────
  ancillary: {
    descriptorLabel: {
      sw: 'Biashara Saidizi',
      en: 'Ancillary',
    },
    descriptorDescription: {
      sw: 'Biashara za upande: usambazaji, chakula, muuzaji wa rejareja, na zingine.',
      en: 'Side businesses: transport, catering, retail, and more.',
    },
    keywordsSw: ['biashara', 'upande', 'saidizi'],
    lookupTool: {
      sw: 'Angalia biashara saidizi',
      en: 'View ancillary businesses',
    },
    heroTitle: {
      sw: 'Biashara Saidizi — biashara za upande na miradi',
      en: 'Ancillary — side businesses and ventures',
    },
    heroSubtitle: {
      sw: 'Simamia biashara zisizo za msingi: usambazaji, chakula, muuzaji wa rejareja, na zingine.',
      en: 'Manage non-core businesses: transport, catering, retail, and more.',
    },
    emptyTitle: {
      sw: 'Hakuna biashara saidizi bado',
      en: 'No ancillary businesses yet',
    },
    emptyDescription: {
      sw: 'Ongeza biashara za upande kubaini mapato na flux za kati ya kampuni.',
      en: 'Add your side businesses to track revenue and intercompany flows.',
    },
    emptyCta: {
      sw: 'Ongeza biashara',
      en: 'Add business',
    },
  },

  // ── components/owner-os/panels/AssetRegisterPanel.tsx ─────────────
  assetRegister: {
    descriptorLabel: {
      sw: 'Daftari ya Mali',
      en: 'Asset register',
    },
    descriptorDescription: {
      sw: 'Orodha, thamini, bima, na mzigo wa mali.',
      en: 'Inventory, valuation, insurance, and encumbrances.',
    },
    keywordsSw: ['daftari', 'mali', 'thamini', 'bima'],
    browseTool: {
      sw: 'Karamu daftari ya mali',
      en: 'Browse asset register',
    },
    netWorthTool: {
      sw: 'Angalia muhtasari wa thamini halisi',
      en: 'View net worth summary',
    },
    heroTitle: {
      sw: 'Daftari ya Mali — orodha na thamini',
      en: 'Asset register — inventory and valuation',
    },
    heroSubtitle: {
      sw: 'Simamia daftari kamili ya mali, thamini, bima, na mzigo wa mali.',
      en: 'Maintain a complete register of assets, valuations, insurance, and encumbrances.',
    },
    emptyTitle: {
      sw: 'Hakuna mali iliyosajiliwa bado',
      en: 'No assets registered yet',
    },
    emptyDescription: {
      sw: 'Ongeza mali yako kutengeneza daftari kamili na kukamatia thamini halisi.',
      en: 'Add your assets to create a complete register and calculate net worth.',
    },
    emptyCta: {
      sw: 'Ongeza mali',
      en: 'Add asset',
    },
  },

  // ── components/owner-os/panels/AuditPanel.tsx ─────────────────────
  audit: {
    descriptorLabel: {
      sw: 'Ukaguzi',
      en: 'Audit',
    },
    descriptorDescription: {
      sw: 'Msururu wa ukaguzi wenye hash uliopangwa kwa muktadha.',
      en: 'Hash-chained audit trail scoped to this tab context.',
    },
    keywordsSw: ['ukaguzi', 'ushahidi'],
    exportTool: {
      sw: 'Hamisha CSV ya ukaguzi',
      en: 'Export audit CSV',
    },
    /** Precedes the runtime `context.focus` value. */
    scopedToPrefix: {
      sw: 'Imepangwa kwa: ',
      en: 'Scoped to: ',
    },
    heroTitle: {
      sw: 'Msururu wa ukaguzi',
      en: 'Audit trail',
    },
    heroSubtitle: {
      sw: 'Leja iliyo na hash, ya kuongeza tu, ya kila hatua ya brain, mwito wa junior na idhini ya binadamu.',
      en: 'Hash-chained, append-only ledger of every brain action, junior call and human approval.',
    },
    emptyTitle: {
      sw: 'Mlolongo wa ukaguzi unakuja hivi karibuni',
      en: 'Tab-scoped audit feed landing soon',
    },
    emptyBody: {
      sw: 'Pakiti ya audit-hash-chain tayari inarekodi kila kitendo. Paneli hii itaonyesha sehemu iliyopangwa (kwa siteId / licenceId / employeeId / focus) mara tu mkataba wa /api/v1/audit/feed utakapozinduliwa.',
      en: 'The audit-hash-chain package already records every action. This panel will surface a tab-scoped slice (filtered by siteId / licenceId / employeeId / focus) once the /api/v1/audit/feed contract is exposed.',
    },
  },

  // ── components/owner-os/panels/CSRCommunityPanel.tsx ──────────────
  csrCommunity: {
    descriptorLabel: {
      sw: 'Jamii za CSR',
      en: 'CSR communities',
    },
    descriptorDescription: {
      sw: 'Ahadi za jamii, daftari la malalamiko, ahadi za mazingira kwa kila kijiji.',
      en: 'Community pledges, grievance log, environment commitments per village.',
    },
    keywordsSw: ['jamii', 'kijiji', 'malalamiko', 'ahadi'],
    logPledgeTool: {
      sw: 'Andika ahadi ya CSR',
      en: 'Log CSR pledge',
    },
    heroTitle: {
      sw: 'Jamii za CSR',
      en: 'CSR communities',
    },
    heroSubtitle: {
      sw: 'Ahadi za kiwango cha kijiji, malalamiko na ahadi za mazingira zimehifadhiwa kama washirika wa nje.',
      en: 'Village-level pledges, grievances and environment commitments stored as external parties.',
    },
    emptyTitle: {
      sw: 'Mfumo wa CSR unakuja hivi karibuni',
      en: 'CSR aggregator landing soon',
    },
    emptyBody: {
      sw: 'Ahadi tayari zinaingia katika external_party_engagements zikiwa kind=csr_pledge. Mfumo wa CSR (jamia kwa kiwango cha kijiji na ramani ya malalamiko) ni hatua inayofuata.',
      en: 'Pledges already land in external_party_engagements with kind=csr_pledge. The dedicated CSR aggregator (village-level rollup + grievance map) is the next milestone.',
    },
  },

  // ── components/owner-os/panels/ChainOfCustodyPanel.tsx ────────────
  chainOfCustody: {
    descriptorLabel: {
      sw: 'Mlolongo wa Mali',
      en: 'Chain of custody',
    },
    descriptorDescription: {
      sw: 'Mlolongo wa kifurushi kutoka shimo hadi mnunuzi, wenye ukaguzi wa hash-chain.',
      en: 'Pit-to-buyer custody trail per ore parcel, hash-chain-audited so the regulator can verify it.',
    },
    keywordsSw: ['mlolongo', 'kifurushi'],
    trackTool: {
      sw: 'Fuatilia kifurushi',
      en: 'Track parcel',
    },
    heroTitle: {
      sw: 'Mlolongo wa Mali',
      en: 'Chain of custody',
    },
    heroSubtitle: {
      sw: 'Kila hatua ya kifurushi kutoka shimo hadi mnunuzi, imesalishwa kwa sha-256.',
      en: 'Every step of a parcel from pit-stockpile to exporter, sealed by sha-256 hash.',
    },
  },

  // ── components/owner-os/panels/CompliancePanel.tsx ────────────────
  compliance: {
    descriptorLabel: {
      sw: 'Utii',
      en: 'Compliance',
    },
    descriptorDescription: {
      sw: 'Ratiba ya NEMC, BoT, Tume ya Madini na TRA pamoja na mafaili ya udhibiti.',
      en: 'NEMC, BoT, Mining Commission and TRA cadence with regulator filings.',
    },
    keywordsSw: ['utii', 'leseni', 'udhibiti', 'mazingira'],
    draftLetterTool: {
      sw: 'Tayarisha barua ya NEMC',
      en: 'Draft NEMC letter',
    },
    scheduleReminderTool: {
      sw: 'Panga ukumbusho wa NEMC',
      en: 'Schedule NEMC reminder',
    },
    licenceHistoryTool: {
      sw: 'Onyesha historia ya leseni',
      en: 'View licence history',
    },
    /** Precedes the runtime `context.focus` value. */
    focusPrefix: {
      sw: 'Mada: ',
      en: 'Focus: ',
    },
    heroTitle: {
      sw: 'Kituo cha utii',
      en: 'Compliance centre',
    },
    heroSubtitle: {
      sw: 'Mfumo wa ratiba ya NEMC, BoT, TRA na Tume ya Madini wenye hali ya kijani / njano / nyekundu.',
      en: 'NEMC, BoT, TRA and Mining Commission cadence tracker with green / amber / red status.',
    },
  },

  // ── components/owner-os/panels/ESGPanel.tsx ───────────────────────
  esg: {
    descriptorDescription: {
      sw: 'Uzalishaji wa hewa, ushiriki wa jamii na maendeleo ya urejesho.',
      en: 'Emissions, community engagement and reclamation progress.',
    },
    keywordsSw: ['mazingira', 'jamii', 'urejesho'],
    draftUpdateTool: {
      sw: 'Tayarisha sasisho la jamii',
      en: 'Draft community update',
    },
    heroTitle: {
      sw: 'ESG — mazingira, jamii, urejesho',
      en: 'ESG — environment, community, reclamation',
    },
    heroSubtitle: {
      sw: 'Picha ya uzalishaji wa hewa, kumbukumbu za ushiriki wa jamii na hatua za urejesho kwa kila tovuti.',
      en: 'Emissions snapshot, community engagement log and reclamation milestones across every site.',
    },
    emptyTitle: {
      sw: 'Dashibodi ya ESG inakuja hivi karibuni',
      en: 'ESG dashboard landing soon',
    },
    emptyBody: {
      sw: 'Hatua za urejesho tayari zinapitia kalenda ya leseni; muhtasari wa ushiriki wa jamii na uzalishaji wa hewa utaonekana hapa mara tu BFF ya /api/v1/esg itakapozinduliwa.',
      en: 'Reclamation milestones already flow off the licence calendar; community engagement and emissions snapshots will surface here once the /api/v1/esg BFF is exposed.',
    },
  },

  // ── components/owner-os/panels/FamilyOfficePanel.tsx ──────────────
  familyOffice: {
    descriptorLabel: {
      sw: 'Ofisi ya Familia',
      en: 'Family office',
    },
    descriptorDescription: {
      sw: 'Wasimamizi, wakaidi, na utawala wa familia.',
      en: 'Principals, beneficiaries, and family governance.',
    },
    keywordsSw: ['wakaidi', 'wasimamizi', 'familia', 'ofisi'],
    viewPrincipalsTool: {
      sw: 'Angalia wasimamizi wa familia',
      en: 'View family principals',
    },
    heroTitle: {
      sw: 'Ofisi ya Familia — wasimamizi na wakaidi',
      en: 'Family office — principals and beneficiaries',
    },
    heroSubtitle: {
      sw: 'Simamia wasimamizi wa familia, watumishi, wakaidi, na muundo wa utawala.',
      en: 'Manage family principals, trustees, beneficiaries, and governance structure.',
    },
    emptyTitle: {
      sw: 'Hakuna ofisi ya familia bado',
      en: 'No family office yet',
    },
    emptyDescription: {
      sw: 'Ongeza wasimamizi wa familia na habari ya utawala kuanza.',
      en: 'Add family principals and governance information to get started.',
    },
    emptyCta: {
      sw: 'Weka ofisi ya familia',
      en: 'Set up family office',
    },
  },

  // ── components/owner-os/panels/FinancePanel.tsx ───────────────────
  finance: {
    descriptorLabel: {
      sw: 'Fedha',
      en: 'Finance',
    },
    descriptorDescription: {
      sw: 'Rasimu ya mrabaha, faida, sehemu ya kuvunja na dirisha la fedha.',
      en: 'Royalty drafter, P&L, break-even and cash window.',
    },
    keywordsSw: ['mrabaha', 'faida', 'gharama', 'fedha'],
    draftRoyaltyTool: {
      sw: 'Tayarisha rasimu ya mrabaha wa mwezi',
      en: 'Draft month-end royalty',
    },
    exportPnlTool: {
      sw: 'Hamisha faida na hasara',
      en: 'Export P&L',
    },
    heroTitle: {
      sw: 'Fedha — mrabaha, faida na sehemu ya kuvunja',
      en: 'Finance — royalty, P&L, break-even',
    },
    heroSubtitle: {
      sw: 'Rasimu ya mrabaha wa mwezi inayoingiza kwenye leja ya kuingia mara mbili ya LedgerService.',
      en: 'Monthly royalty drafter feeding the LedgerService double-entry ledger with break-even sensitivity.',
    },
    cashWindowsTitle: {
      sw: 'Madirisha ya fedha',
      en: 'Cash windows',
    },
    cashWindowsBody: {
      sw: 'Dirisha la dhahabu la BoT linaongoza muda wa kuuza. P&L ya kila mwezi inajengwa kutoka leja ya LedgerService na revaluation ya FX inafanyika kwa kiwango cha siku ya mwisho ya mwezi.',
      en: 'BoT gold window drives sell timing. The monthly P&L composes from the LedgerService double-entry posting, with FX revaluation booked at the month-end BoT rate.',
    },
  },
} as const;
