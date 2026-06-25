/**
 * routes-b.ts — guard-exempt bilingual (sw / en) copy for a batch of
 * owner-web route + boundary surfaces ("routes B" tranche).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The locale-purity guard (`i18n/locale-purity.ts`) flags hardcoded
 * Swahili that appears as bare literals in CODE anywhere under
 * `owner-web/src` — EXCEPT files under `i18n/`, which are exempt because
 * the dictionaries are the one legitimate home for Swahili prose. Until
 * owner-web finishes its migration to a runtime `t()` framework, several
 * route files still render bilingual UX through `isSw` ternaries (and a
 * few unconditional `sw / en` slash strings + locale-only metadata) with
 * the Swahili spelled inline. Lifting those literals into this exempt
 * module removes them from the leak set while keeping the rendered bytes
 * identical.
 *
 * SHAPE
 * -----
 * Namespaced by source file. Every entry is a `{ sw, en }` pair so call
 * sites keep their exact locale logic:
 *   - locale-gated:        `{isSw ? S.ns.key.sw : S.ns.key.en}`
 *   - always-bilingual:    `` `${S.ns.key.sw} / ${S.ns.key.en}` ``
 *   - swahili-only (meta): `S.ns.key.sw`
 *
 * The pairs port 1:1 into the eventual messages bundle, at which point
 * call sites read from `t()` and this shim can be deleted.
 */

export interface BiString {
  readonly sw: string;
  readonly en: string;
}

export const routesBStrings = {
  /**
   * Shared loading/empty strings used in 'use client' components under
   * apps/owner-web/src/components/ that need bilingual content but are
   * not part of the i18n/strings/data-*.ts cohort.
   */
  sharedClientStrings: {
    loadingDrafts: {
      sw: 'Inapakia rasimu…',
      en: 'Loading drafts…',
    },
    noRoyaltyDrafts: {
      sw: 'Hakuna rasimu za mrabaha kwa sasa.',
      en: 'No royalty drafts pending.',
    },
    couldNotLoadRoyaltyDrafts: {
      sw: 'Imeshindwa kupakia rasimu za mrabaha.',
      en: 'Could not load royalty drafts.',
    },
  },

  /** app/(routes)/compliance/page.tsx and ComplianceSurface.tsx. */
  compliance: {
    draftMonthlyPack: {
      sw: 'Tayarisha pakiti',
      en: 'Draft monthly pack',
    },
    askForCitations: {
      sw: 'Uliza vidokezo',
      en: 'Ask for citations',
    },
    // ComplianceSurface.tsx — recent packs section
    recentPacksTitle: {
      sw: 'Pakiti za hivi karibuni',
      en: 'Recent compliance packs',
    },
    draftPackLink: {
      sw: 'Unda pakiti',
      en: 'Draft pack',
    },
    loadingPacks: {
      sw: 'Inapakia…',
      en: 'Loading…',
    },
    loadPacksFailed: {
      sw: 'Imeshindwa kupakia pakiti za kawaida.',
      en: 'Could not load compliance packs.',
    },
    noPacksYet: {
      sw: 'Hakuna pakiti zilizoundwa bado.',
      en: 'No compliance packs generated yet.',
    },
    defaultPackLabel: {
      sw: 'Pakiti ya utiifu',
      en: 'Compliance pack',
    },
  },

  /** app/(routes)/safety/page.tsx — O-W-15 Safety & EHS. */
  safety: {
    logNewIncident: {
      sw: 'Sajili tukio jipya',
      en: 'Log new incident',
    },
    toolboxBrief: {
      sw: 'Toolbox ya leo',
      en: 'Toolbox brief',
    },
    /**
     * Incident kind labels — MUST stay in lock-step with the gateway
     * `IncidentKindEnum`
     * (services/api-gateway/src/routes/mining/_openapi/sales-incidents-schemas.ts):
     * safety | environmental | community | near_miss | equipment_failure | fatality.
     * Used by safety/incidents/new/page.tsx.
     */
    incidentKind: {
      safety: { sw: 'Usalama', en: 'Safety' },
      environmental: { sw: 'Mazingira', en: 'Environmental' },
      community: { sw: 'Jamii', en: 'Community' },
      near_miss: { sw: 'Karibu ajali', en: 'Near miss' },
      equipment_failure: { sw: 'Hitilafu ya mtambo', en: 'Equipment failure' },
      fatality: { sw: 'Kifo', en: 'Fatality' },
    },
  },

  /** app/(routes)/people/page.tsx — O-W-08 People & roles. */
  people: {
    openRoster: {
      sw: 'Onyesha ratiba',
      en: 'Open roster',
    },
    askAboutWorkforce: {
      sw: 'Uliza kuhusu wafanyakazi',
      en: 'Ask about workforce',
    },
  },

  /** app/(routes)/reports/page.tsx — O-W-18 Reports & exports. */
  reports: {
    reportLibrary: {
      sw: 'Maktaba ya ripoti',
      en: 'Report library',
    },
    askAnalytics: {
      sw: 'Uliza kuhusu chati',
      en: 'Ask about analytics',
    },
    provenance: {
      sw: 'Uthibitisho',
      en: 'Provenance',
    },
    provenanceTagline: {
      sw: 'Kila namba inarejea kwa LMBM.',
      en: 'Every figure cites a chunk in the LMBM.',
    },
    provenanceBody: {
      sw: 'Ripoti zilizotengenezwa zinajumuisha kiambatisho cha hashi kwa kila takwimu, kuweza kufuatiliwa nyuma kwa ledger ya chanzo au chunk ya hati. Ripoti zinabaki kusomwa hata bila intaneti.',
      en: 'Generated reports include an appendix with a hash anchor for every figure, traceable back to the source ledger or document chunk. Reports stay readable offline; sharing requires explicit access grants.',
    },
  },

  /**
   * app/(routes)/settings/connected-agents/connected-agents-list.tsx.
   * These render as unconditional `sw / en` strings (no isSw gate); the
   * `sw`/`en` halves are reassembled at the call site with the original
   * separators preserved exactly.
   */
  connectedAgentsList: {
    relNow: { sw: 'sasa hivi', en: 'just now' },
    relMinutesAgo: { sw: 'dakika {n} zilizopita', en: '{n}m ago' },
    relHoursAgo: { sw: 'saa {n} zilizopita', en: '{n}h ago' },
    relDaysAgo: { sw: 'siku {n} zilizopita', en: '{n}d ago' },
    httpProblem: { sw: 'Tatizo (HTTP {status})', en: 'Problem (HTTP {status})' },
    networkError: { sw: 'Tatizo la mtandao', en: 'network error' },
    revokeTitle: {
      sw: 'Ondoa idhini ya wakala?',
      en: 'Revoke agent access?',
    },
    revokeConfirm: {
      sw: 'Ondoa idhini ya wakala "{label}"? Hatua hii haiwezi kutenduliwa.',
      en: 'Revoke agent "{label}"? This cannot be undone.',
    },
    cancel: { sw: 'Ghairi', en: 'Cancel' },
    revokeFailed: {
      sw: 'Tatizo: {detail}. Jaribu tena.',
      en: 'Failed: {detail}. Try again.',
    },
    loadingAria: { sw: 'Inapakia mawakala', en: 'Loading agents' },
    retry: { sw: 'Jaribu tena', en: 'Retry' },
    emptyTitle: {
      sw: 'Hakuna wakala wa nje walioongezwa bado.',
      en: 'No external agents are connected yet.',
    },
    emptyBody: {
      sw: 'Ukiidhinisha wakala kupitia',
      en: 'When you authorize an agent via',
    },
    emptyBodySuffix: {
      sw: ', wataonekana hapa.',
      en: ', it will appear here.',
    },
    issued: { sw: 'Iliongezwa', en: 'Issued' },
    lastUsed: { sw: 'Imetumika mwisho', en: 'Last used' },
    expires: { sw: 'Inaisha', en: 'Expires' },
    revoking: { sw: 'Inaondoa…', en: 'Revoking…' },
    revoke: { sw: 'Ondoa', en: 'Revoke' },
  },

  /** app/(routes)/settings/jurisdiction/jurisdiction-settings.tsx. */
  jurisdictionSettings: {
    loading: {
      sw: 'Inapakia muktadha…',
      en: 'Loading jurisdiction snapshot…',
    },
    currentTagline: { sw: 'Eneo la sasa la sheria', en: '' },
    fieldCountry: { sw: 'Nchi', en: 'Country' },
    fieldCurrency: { sw: 'Sarafu', en: 'Currency' },
    fieldDefaultLanguage: { sw: 'Lugha', en: 'Default language' },
    fieldTimeZone: { sw: 'Eneo la saa', en: 'Time zone' },
    fieldMineralAuthority: {
      sw: 'Mdhibiti wa madini',
      en: 'Mineral authority',
    },
    fieldEnvironmentalAuthority: {
      sw: 'Mdhibiti wa mazingira',
      en: 'Environmental authority',
    },
    fieldTransparency: { sw: 'Uwazi', en: 'Transparency initiative' },
    fieldAuditAuthority: { sw: 'Mkaguzi', en: 'Audit authority' },
    lockedTagline: { sw: 'Eneo la sheria limefungwa', en: '' },
    lockedBodySwPrefix: {
      sw: 'Akaunti yako imefungwa kwa',
      en: '',
    },
    lockedBodySwSuffix: {
      sw: 'kwa ajili ya utiifu. Mabadiliko ya kudumu yanahitaji msaada wa Borjie baada ya simu ya uthibitisho.',
      en: '',
    },
    requestChange: { sw: 'Omba mabadiliko', en: 'Request a change' },
    overrideTagline: {
      sw: 'Uliza kuhusu eneo lingine la sheria',
      en: '',
    },
    overrideBodySw: {
      sw: 'Unaweza kuomba jibu la zamu moja kwa eneo lingine — sema kwa mfano',
      en: '',
    },
    /** SW conjunction "or" joining the two example phrases. */
    overrideBodySwOr: { sw: 'au', en: '' },
  },

  /** app/(routes)/settings/saved-searches/saved-searches-panel.tsx. */
  savedSearches: {
    frequencyHourly: { sw: 'Kila saa', en: 'Hourly' },
    frequencyDaily: { sw: 'Kila siku', en: 'Daily' },
    frequencyWeekly: { sw: 'Kila wiki', en: 'Weekly' },
    sourceMarketplace: { sw: 'Soko', en: 'Marketplace' },
    sourceOpportunities: { sw: 'Fursa', en: 'Opportunities' },
    sourceRegulatory: { sw: 'Kanuni', en: 'Regulatory' },
    newSearchTagline: {
      sw: 'Utafutaji mpya: toa jina, andika maswali yako, chagua mzunguko',
      en: 'New search: give it a name, write your query, choose a cadence',
    },
    labelField: { sw: 'Jina', en: 'Label' },
    queryField: { sw: 'Maswali (JSON)', en: 'Query JSON' },
    frequencyField: { sw: 'Mzunguko', en: 'Frequency' },
    sourceField: { sw: 'Chanzo', en: 'Source' },
    save: { sw: 'Hifadhi', en: 'Save' },
    savedListTagline: { sw: 'Utafutaji wako uliohifadhiwa', en: 'Your saved searches' },
    emptyList: {
      sw: 'Hakuna utafutaji uliohifadhiwa.',
      en: 'No saved searches yet.',
    },
    delete: { sw: 'Futa', en: 'Delete' },
  },

  /** app/(routes)/site-cockpit/page.tsx — O-W-06 Site cockpit. */
  siteCockpit: {
    switchSite: { sw: 'Badilisha mgodi', en: 'Switch site' },
    askAboutSite: {
      sw: 'Uliza kuhusu mgodi',
      en: 'Ask about this site',
    },
    activeSite: { sw: 'Mgodi unaonyeshwa', en: 'Active site' },
    noSites: {
      sw: 'Hakuna machimbo bado. Ongeza machimbo kwenye Onboarding ili kufungua dirisha hili.',
      en: 'No sites yet. Add a site on the Onboarding surface to open this cockpit.',
    },
  },

  /** app/(routes)/workforce-tabs/kiosk/KioskClockInSurface.tsx. */
  kioskSurface: {
    site: { sw: 'Tovuti', en: 'Site' },
    employeeId: { sw: 'Namba ya mfanyikazi', en: 'Employee ID' },
    employeePlaceholder: { sw: 'kwa mfano: EMP-001', en: 'e.g. EMP-001' },
    selectPrompt: {
      sw: 'Chagua tovuti na andika namba ya mfanyikazi kuanza.',
      en: 'Select a site and enter the worker badge ID to enable the passkey button.',
    },
    recentCheckIns: {
      sw: 'Imeingia hivi karibuni',
      en: 'Recent check-ins',
    },
  },

  /** app/(routes)/workforce-tabs/kiosk/page.tsx — O-W-WORKFORCE-KIOSK. */
  kioskPage: {
    title: { sw: 'Kiosk ya {workforce}', en: 'Workforce kiosk' },
    body: {
      sw: 'Mfanyikazi anaweza kuingia/kutoka kazini kupitia Touch ID au Windows Hello kwenye kompyuta ya msingi.',
      en: 'Workers clock in/out from this shared terminal using Touch ID or Windows Hello — no phone required.',
    },
  },

  /** app/(routes)/workforce-tabs/page.tsx — O-W-WORKFORCE-TABS. */
  workforceTabs: {
    title: { sw: 'Tabo za {workforce}', en: 'Workforce tab access' },
    scopeGlobal: { sw: 'Kote', en: 'Global' },
    body: {
      sw: 'Weka ni tabo zipi kila jukumu litazione kwenye programu ya {workforce}. Mabadiliko yanasajiliwa kwa msururu wa heshi.',
      en: 'Set which tabs each role sees in the workforce mobile app. Every change is recorded on the hash-chained audit trail.',
    },
  },

  /** app/(routes)/workforce/openings/page.tsx — chain L-A. */
  workforceOpenings: {
    title: { sw: 'Nafasi za Kazi', en: 'Workforce Openings' },
    intro: {
      sw: 'Tangaza nafasi mpya — wagombea wataalikwa kupitia SMS na meneja atawakubali.',
      en: 'Post a new opening — candidates are invited via SMS and the manager approves them.',
    },
    postHeading: {
      sw: 'Tangaza nafasi mpya',
      en: 'Post a new opening',
    },
    postBody: {
      sw: 'Mwikila atatengeneza tangazo kutoka kwa maelezo yako.',
      en: 'Mwikila drafts the listing from your prompt and pre-fills the SMS invite copy.',
    },
    openMwikila: { sw: 'Anza na Mwikila', en: 'Open Mwikila' },
    openPositions: { sw: 'Nafasi za sasa', en: 'Open positions' },
    emptyPositions: {
      sw: 'Hakuna nafasi wazi bado.',
      en: 'No openings yet. Post one above.',
    },
  },

  /** app/error.tsx — owner cockpit segment error boundary. */
  error: {
    eyebrow: { sw: 'Hitilafu', en: 'Something went wrong' },
    heading: { sw: 'Haikupakia.', en: "That didn't load." },
    body: {
      sw: 'Tumepokea ripoti. Jaribu tena — kama itaendelea kutokea, timu yetu inaangalia tayari.',
      en: "We've captured the error. Try again — if it keeps happening, our team is already looking.",
    },
    retry: { sw: 'Jaribu tena', en: 'Try again' },
    backToCockpit: { sw: 'Rudi kwenye cockpit', en: 'Back to cockpit' },
  },

  /** app/not-found.tsx — owner cockpit not-found surface. */
  notFound: {
    metaTitle: {
      sw: 'Ukurasa haupo — Borjie Owner Cockpit',
      en: 'Page not found — Borjie Owner Cockpit',
    },
    metaDescription: {
      sw: 'Hatuwezi kupata ukurasa huo.',
      en: "We couldn't find that page.",
    },
    eyebrow: { sw: 'Hatuwezi kupata', en: 'Not found' },
    heading: { sw: 'Ukurasa haupo.', en: "That page doesn't exist." },
    body: {
      sw: 'Inawezekana umebadilishwa au kiungo ni cha zamani. Jaribu nyumbani au nenda kwenye master brain.',
      en: 'It may have moved or the link is out of date. Try the cockpit home or jump to the master brain.',
    },
    backToCockpit: { sw: 'Rudi kwenye cockpit', en: 'Back to cockpit' },
    masterBrain: { sw: 'Master brain', en: 'Master brain' },
  },

  /** app/oauth/confirm/confirm-panel.tsx — device-authorize consent. */
  oauthConfirm: {
    scopeOwnerRead: {
      sw: 'Soma data ya cockpit (rasimu, vikumbusho, maamuzi, vitu)',
      en: 'Read cockpit data (drafts, reminders, decisions, entities)',
    },
    scopeOwnerWrite: {
      sw: 'Tengeneza au sasisha data ya mmiliki (bila kuhusisha pesa)',
      en: 'Create or update owner data (excluding money)',
    },
    scopeOwnerDraft: {
      sw: 'Tengeneza, hariri, na funga rasimu za nyaraka',
      en: 'Create, edit, and lock document drafts',
    },
    scopeOwnerReminders: {
      sw: 'Panga vikumbusho kwa ajili yako',
      en: 'Schedule reminders for you',
    },
    scopeOwnerShare: {
      sw: 'Tengeneza viungo vya kushiriki data yako',
      en: 'Generate share links to your data',
    },
    scopeAdminRead: {
      sw: 'Soma data ya msimamizi wa ndani (Borjie team only)',
      en: 'Read internal admin data (Borjie team only)',
    },
    commProblem: {
      sw: 'Tatizo la mawasiliano (HTTP {status})',
      en: 'Communication problem (HTTP {status})',
    },
    networkRetry: {
      sw: 'Tatizo la mtandao — jaribu tena',
      en: 'Network problem — try again',
    },
    httpProblem: { sw: 'Tatizo (HTTP {status})', en: 'Problem (HTTP {status})' },
    networkError: { sw: 'Tatizo la mtandao', en: 'Network error' },
    header: { sw: 'Idhinisha wakala wa nje', en: 'Authorize external agent' },
    headerTagline: {
      sw: 'Idhinisha wakala wa nje',
      en: 'Authorize external agent',
    },
    missingCode: {
      sw: 'Hakuna msimbo wa mtumiaji. Hakikisha umetumia kiunganisho alichokupa wakala.',
      en: 'No user code provided — make sure you used the link the agent gave you.',
    },
    loadingAria: {
      sw: 'Inapakia maelezo ya wakala',
      en: 'Loading agent details',
    },
    approvedTitle: {
      sw: 'Imeidhinishwa. Wakala anaweza kufanya kazi sasa.',
      en: 'Approved. The agent can now act on your behalf.',
    },
    approvedBody: {
      sw: 'Wakala sasa anaweza kutenda kwa niaba yako.',
      en: 'The agent can now act on your behalf.',
    },
    approvedRedirect: {
      sw: 'Inaelekeza kwenye orodha ya wakala katika sekunde {n} …',
      en: 'Redirecting to the agent list in {n}s …',
    },
    deniedTitle: { sw: 'Umekataa ombi.', en: 'You denied the request.' },
    deniedBody: {
      sw: 'Kifaa hakitapokea tokeni.',
      en: 'The device will not receive a token.',
    },
    agentLabel: { sw: 'Wakala', en: 'Agent' },
    codeLabel: { sw: 'Msimbo', en: 'Code' },
    requestsPermissions: {
      sw: 'Anaomba ruhusa zifuatazo',
      en: 'Requests the following permissions',
    },
    noScopes: {
      sw: 'Hakuna ruhusa maalum',
      en: 'no specific scopes requested',
    },
    revokeNotePrefix: {
      sw: 'Unaweza kuondoa idhini wakati wowote kutoka',
      en: 'You can revoke this at any time from',
    },
    revokeNoteSuffix: {
      sw: '(Mipangilio → Wakala walioongezwa).',
      en: '(Settings → Connected agents).',
    },
    approve: { sw: 'Idhinisha', en: 'Approve' },
    deny: { sw: 'Kataa', en: 'Deny' },
  },
} as const;
