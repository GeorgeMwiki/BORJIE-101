/**
 * Guard-exempt string table for a cohort of owner-web route surfaces
 * ("routes A") that render bilingual copy via an inline `isSw` /
 * `languagePreference === 'sw'` boolean.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The locale-purity guard (`../locale-purity.ts`) flags hardcoded
 * Swahili literals that live in CODE outside `src/i18n/`. Several route
 * components historically inlined their Swahili next to the English
 * (e.g. `{isSw ? 'Imeshindwa kupakia.' : 'Could not load.'}`), tripping
 * the guard. Files UNDER `src/i18n/` are exempt, so the literals are
 * relocated here verbatim — the rendered output is byte-for-byte
 * identical; only the home of the string moves.
 *
 * These surfaces deliberately do NOT route through the central `t()`
 * dictionaries (they predate that migration and use a local boolean).
 * This table is the interim, guard-clean home for their copy. Keys are
 * namespaced by the source file so the cohort can share one module
 * without collisions.
 *
 * Some entries are a single combined literal that already carried both
 * languages in one string (e.g. `'Loading… / Inapakia…'`). Those are
 * stored under a single `both` field so the call site keeps its exact
 * prior render.
 */

/** A Swahili/English pair selected by the caller's locale boolean. */
interface SwEn {
  readonly sw: string;
  readonly en: string;
}

/** A single literal that already interleaves both languages. */
interface Both {
  readonly both: string;
}

export const routesAStrings = {
  // app/(routes)/cockpit/page.tsx
  cockpit: {
    greetMorning: { sw: 'Habari za asubuhi', en: 'Good morning' },
    greetAfternoon: { sw: 'Habari za mchana', en: 'Good afternoon' },
    greetEvening: { sw: 'Habari za jioni', en: 'Good evening' },
    siteOne: { sw: 'mgodi 1', en: '1 site' },
    /** Plural noun for sites; the count is appended at the call site. */
    sitesPluralNoun: { sw: 'migodi', en: 'sites' },
    plan: { sw: 'mpango', en: 'plan' },
  },

  // app/(routes)/compliance/licences/[id]/renewal/LicenceRenewalClient.tsx
  renewalClient: {
    stageNoAction: { sw: 'Hakuna hatua', en: 'No action' },
    stageReminder: { sw: 'Kukumbushwa', en: 'Reminder' },
    stageDrafting: { sw: 'Rasimu inaandikwa', en: 'Drafting' },
    stageAwaitingOwner: { sw: 'Inasubiri mmiliki', en: 'Awaiting owner' },
    stageSubmitted: { sw: 'Imewasilishwa', en: 'Submitted' },
    stageRenewed: { sw: 'Imeshapyishwa', en: 'Renewed' },
    draftOpened: { sw: 'Rasimu imefunguliwa', en: 'Draft opened' },
    submissionRefRequired: {
      sw: 'Tafadhali ingiza kumbukumbu ya uwasilishaji',
      en: 'Submission reference required',
    },
    renewalSubmitted: {
      sw: 'Upyaji umewasilishwa',
      en: 'Renewal submitted to regulator',
    },
    loading: { sw: 'Inapakia…', en: 'Loading…' },
    licenceNotFound: { sw: 'Leseni haijapatikana', en: 'Licence not found' },
    kind: { sw: 'Aina', en: 'Kind' },
    number: { sw: 'Namba', en: 'Number' },
    mineral: { sw: 'Madini', en: 'Mineral' },
    expiry: { sw: 'Tarehe ya kumalizika', en: 'Expiry' },
    daysRemaining: { sw: 'Siku zilizobaki', en: 'Days remaining' },
    stage: { sw: 'Hatua', en: 'Stage' },
    startDraftHeading: { sw: 'Anzisha rasimu', en: 'Start the renewal draft' },
    startDraftBody: {
      sw: 'Mr. Mwikila ataandaa rasimu ya hati za upyaji kulingana na maelezo ya leseni.',
      en: "Mr. Mwikila will assemble the renewal docs from the licence's profile.",
    },
    startRenewalCta: { sw: 'Anzisha upyaji', en: 'Start renewal' },
    submitToRegulatorHeading: {
      sw: 'Wasilisha kwa msimamizi',
      en: 'Submit to the regulator',
    },
    submitToRegulatorBody: {
      sw: 'Andika nambari ya kumbukumbu ya msimamizi na (hiari) URL ya hati ya upyaji.',
      en: 'Enter the regulator reference and (optional) the renewal document URL.',
    },
    submissionReferenceLabel: {
      sw: 'Kumbukumbu',
      en: 'Submission reference',
    },
    renewalDocUrlLabel: { sw: 'URL ya hati', en: 'Renewal doc URL' },
    submitRenewalCta: { sw: 'Wasilisha', en: 'Submit renewal' },
    renewalComplete: {
      sw: 'Upyaji umekamilika. Hati imewekwa kwenye `licences.fees.renewal_doc_url`.',
      en: 'Renewal complete. Document stamped onto `licences.fees.renewal_doc_url`.',
    },
  },

  // app/(routes)/compliance/licences/[id]/renewal/page.tsx
  renewalPage: {
    backToCompliance: {
      sw: 'Rudi kwa compliance',
      en: 'Back to compliance',
    },
    eyebrow: { sw: 'Upyaji wa leseni', en: 'Licence renewal' },
    heading: { sw: 'Mchakato wa upyaji', en: 'Renewal workflow' },
    body: {
      sw: 'Anzisha rasimu, kagua, na uwasilishe kwa NEMC / PCCB / TMAA. Mr. Mwikila atatuma vikumbusho vya 90 / 60 / 30 / 14 / 7 / 1 siku.',
      en: 'Start the draft, review, and submit to NEMC / PCCB / TMAA. Mr. Mwikila pulses reminders at 90 / 60 / 30 / 14 / 7 / 1 days.',
    },
  },

  // app/(routes)/document-intelligence/page.tsx
  documentIntelligence: {
    title: { both: 'Hati hai · Living documents' },
    subtitle: {
      both: 'Pakia mkataba, zabuni au barua. Brain itazungumza nazo kama vyombo hai.',
    },
    emptyState: { both: 'Chagua hati au pakia mpya kuanza.' },
  },

  // app/(routes)/estate/page.tsx
  estate: {
    entitiesLabel: { sw: 'Kampuni', en: 'Entities' },
    entitiesSub: {
      sw: 'Jumla ya kampuni hai kwenye miliki',
      en: 'Active entities under the estate',
    },
    assetValueLabel: { sw: 'Thamani ya mali', en: 'Asset value' },
    assetValueSub: { sw: 'TZS, jumla ya mali', en: 'TZS, total estate assets' },
    capitalFlowsLabel: { sw: 'Mtiririko (siku 30)', en: 'Capital flows (30d)' },
    capitalFlowsSub: { sw: 'TZS, mtiririko wa siku 30', en: 'TZS, last 30 days' },
    successionLabel: { sw: 'Hali ya urithi', en: 'Succession status' },
    successionSub: {
      sw: 'Hatua za mapitio yanayohitajika',
      en: 'Plans pending review',
    },
  },

  // app/(routes)/finance/page.tsx
  finance: {
    // SW draft CTA interpolates `SW.royalty` after this prefix; the EN
    // side is a complete sentence. Stored as a pair so the call site
    // keeps `isSw ? `${prefix}${SW.royalty}` : en`.
    draftMonthEndRoyalty: {
      sw: 'Tayarisha rasimu ya ',
      en: 'Draft month-end royalty',
    },
    askAboutPnl: { sw: 'Uliza kuhusu P&L', en: 'Ask about P&L' },
    howPnlComposesHeading: {
      sw: 'Jinsi P&L inavyojengwa',
      en: 'How the P&L composes',
    },
    howPnlComposesBody: {
      sw: 'P&L ya kila mwezi inaungana toka ledger ya kuingia mara mbili ya LedgerService, na FX revaluation inafanyika kwa kiwango cha BoT cha siku ya mwisho ya mwezi. Kila takwimu inarudishwa hadi kwa sehemu yake ya chanzo (parcel, sale, fuel slip, payroll line) ili kwamba ukaguzi unaweza kuthibitisha kila line.',
      en: 'The monthly P&L composes from the LedgerService double-entry posting, with FX revaluation booked at the month-end BoT rate. Every figure traces back to its source artefact (parcel, sale, fuel slip, payroll line) so an auditor can verify each line directly against the immutable journal.',
    },
  },

  // app/(routes)/fleet/maintenance/page.tsx
  fleetMaintenance: {
    subhead: { both: 'Matengenezo ya Magari' },
    intro: { both: 'Matengenezo ya siku 30 zilizopita kwa kila gari.' },
    newMaintenanceCta: { both: 'Open new maintenance / Anza matengenezo' },
    recentEventsSubtitle: { both: 'Matukio ya hivi karibuni' },
    loading: { both: 'Loading… / Inapakia…' },
  },

  // app/(routes)/marketplace/inbound/[rfbId]/page.tsx
  inboundRfb: {
    eyebrow: { sw: 'RFB ya mnunuzi', en: 'Inbound buyer RFB' },
    heading: { sw: 'Tuma kwa msimamizi', en: 'Dispatch to a manager' },
    body: {
      sw: 'Chagua msimamizi na tovuti ya kushughulikia ombi hili. Hatua hii itaunda kazi ya kazi ya mfanyakazi inayofungamana na RFB hii.',
      en: 'Pick the manager and the site that will fulfil this buyer request. This creates a worker task linked back to the RFB.',
    },
  },

  // app/(routes)/mwikila/delegation/delegation-matrix.tsx
  delegationMatrix: {
    catShifts: { sw: 'Zamu', en: 'Shifts' },
    catPayrollPrep: { sw: 'Maandalizi ya mishahara', en: 'Payroll prep' },
    catRoyaltyFiling: { sw: 'Ufungaji wa mrabaha', en: 'Royalty filing' },
    catLicenceRenewalReminders: {
      sw: 'Vikumbusho vya leseni',
      en: 'License renewal reminders',
    },
    catContractFollowups: {
      sw: 'Ufuatiliaji wa mikataba',
      en: 'Contract followups',
    },
    catWorkerHires: { sw: 'Kuajiri wafanyakazi', en: 'Worker hires' },
    catWorkerDiscipline: { sw: 'Hatua za kinidhamu', en: 'Worker discipline' },
    catCapex: { sw: 'Matumizi makubwa', en: 'Capex' },
    catInventoryOrders: { sw: 'Maagizo ya bidhaa', en: 'Inventory orders' },
    catComplianceFilings: { sw: 'Ripoti za kanuni', en: 'Compliance filings' },
    catMarketplaceBids: { sw: 'Zabuni za soko', en: 'Marketplace bids' },
    catMarketplaceCounters: { sw: 'Rejea za bei', en: 'Marketplace counters' },
    loading: { both: 'Loading… / Inapakia…' },
    categoryHeader: { both: 'Category / Kazi' },
  },

  // app/(routes)/mwikila/delegation/page.tsx
  delegationPage: {
    subhead: {
      both: 'Uwakilishi wa Mwikila — chagua kiwango cha uhuru kwa kila kazi',
    },
  },

  // app/(routes)/mwikila/inbox/page.tsx
  mwikilaInbox: {
    subhead: { both: 'Mwikila kwa niaba yako — kagua, idhinisha au rejesha' },
  },

  // app/(routes)/onboarding/page.tsx
  onboarding: {
    stepLicencesSw: { sw: 'Pakia leseni', en: 'Licence import' },
    stepSitesSw: { sw: 'Mipaka ya tovuti', en: 'Site geometry' },
    stepDrillHolesSw: { sw: 'Mashimo ya kuchimba', en: 'Drill-hole batch' },
    stepCockpitSeedSw: { sw: 'Anza dashibodi', en: 'Cockpit seed' },
    completeStepFirst: {
      sw: 'Tafadhali kamilisha hatua hii kabla ya kuendelea.',
      en: 'Please complete this step before continuing.',
    },
    sessionNotReady: {
      sw: 'Kipindi hakijaanza.',
      en: 'Session not ready.',
    },
    startFailedTitle: {
      sw: 'Hatukuweza kuanzisha usajili',
      en: 'We could not start onboarding',
    },
    startFailedBody: {
      sw: 'Huduma ya usajili haipatikani kwa sasa. Angalia muunganisho wako kisha jaribu tena.',
      en: 'The onboarding service is unavailable right now. Check your connection and try again.',
    },
    retryButton: { sw: 'Jaribu tena', en: 'Retry' },
    progressSubtitle: { both: 'Maendeleo' },
    hintLicencesSw: { sw: 'Tia PML/PL/SML/ML hapa', en: 'Drop PML/PL/SML/ML PDFs here' },
    hintSitesSw: {
      sw: 'Tia GeoJSON ya kila tovuti',
      en: 'Drop a GeoJSON polygon for each site',
    },
    hintDrillSw: {
      sw: 'Tia CSV ya mashimo ya kwanza',
      en: 'Drop the first drill-hole CSV batch',
    },
    backButton: { both: 'Back / Rudi' },
    finishButton: { both: 'Finish / Maliza' },
    nextButton: { both: 'Next / Endelea' },
    // ── B1 bridge: real upload → OCR → commit + confirmation surface ──────
    uploadingLicences: {
      sw: 'Inapakia na kusoma leseni…',
      en: 'Uploading and reading your licences…',
    },
    uploadFailedTitle: {
      sw: 'Baadhi ya faili hazikupakia',
      en: 'Some files did not upload',
    },
    reasonMimeNotAllowed: {
      sw: 'Aina ya faili hairuhusiwi (tumia PDF/picha).',
      en: 'File type not allowed (use PDF or an image).',
    },
    reasonTooLarge: { sw: 'Faili ni kubwa mno (MB 25 juu).', en: 'File is too large (25 MB max).' },
    reasonStorageUnavailable: {
      sw: 'Hifadhi haipatikani kwa sasa.',
      en: 'Storage is unavailable right now.',
    },
    reasonStoragePutFailed: {
      sw: 'Kupakia faili kumeshindwa.',
      en: 'Uploading the file failed.',
    },
    reasonReadyFailed: {
      sw: 'Hatukuweza kuanzisha usomaji wa faili.',
      en: 'We could not start reading the file.',
    },
    reasonUnknown: { sw: 'Hitilafu isiyojulikana.', en: 'An unknown error occurred.' },
    pendingExtractionNote: {
      sw: 'Baadhi ya leseni bado zinasomwa — zitaongezwa zikiisha.',
      en: 'Some licences are still being read — they will be added once ready.',
    },
    // Confirmation surface
    doneTitle: { sw: 'Usajili umekamilika', en: 'Onboarding complete' },
    doneSubtitle: {
      sw: 'Hivi ndivyo tulivyoingiza kwenye dashibodi yako.',
      en: "Here's what we loaded into your cockpit.",
    },
    countLicences: { sw: 'Leseni', en: 'Licences' },
    countSites: { sw: 'Tovuti', en: 'Sites' },
    countEmployees: { sw: 'Wafanyakazi', en: 'Employees' },
    countHoldings: { sw: 'Milki', en: 'Holdings' },
    rowsCreatedLabel: { sw: 'zimeundwa', en: 'created' },
    rowsSkippedLabel: { sw: 'zimerukwa (zilikuwepo)', en: 'skipped (already existed)' },
    headlineLabel: { sw: 'Kichwa cha taarifa ya kwanza', en: 'First brief headline' },
    goToCockpit: { sw: 'Nenda dashibodini', en: 'Go to cockpit' },
    emptyCockpitNote: {
      sw: 'Hakuna safu mpya zilizoundwa. Pakia leseni za PDF ili kujaza dashibodi.',
      en: 'No new rows were created. Upload licence PDFs to populate your cockpit.',
    },
  },

  // app/(routes)/payroll/page.tsx
  payroll: {
    title: { sw: 'Mishahara', en: 'Payroll' },
    intro: {
      sw: 'Endesha mishahara ya kipindi kwa M-Pesa. Mwikila huandaa hesabu; wewe unakubali.',
      en: 'Run period payroll via M-Pesa bulk-payout. Mwikila pre-computes the line items; you approve.',
    },
    runNewPeriodHeading: {
      sw: 'Endesha kipindi kipya',
      en: 'Run a new period',
    },
    runNewPeriodBody: {
      sw: 'Chagua tarehe za mwanzo na mwisho. Mwikila atatumia clock-in events na shift reports kuhesabu kila mfanyakazi.',
      en: 'Pick a start + end date. Mwikila uses clock-in events and shift reports to compute every worker. Money posts via LedgerService.post() — double-entry guaranteed.',
    },
    openMwikilaCta: { sw: 'Anza na Mwikila', en: 'Open Mwikila' },
    recentRunsHeading: {
      sw: 'Vipindi vya hivi karibuni',
      en: 'Recent runs',
    },
    noRuns: {
      sw: 'Hakuna kipindi bado. Endesha cha kwanza juu.',
      en: 'No runs yet. Trigger the first one above.',
    },
  },

  // app/(routes)/personal-kb/[personId]/personal-kb-detail-panel.tsx
  personalKbDetail: {
    kindPreference: { both: 'Mapendekezo' },
    kindContext: { both: 'Mazingira ya sasa' },
    kindRecurringFact: { both: 'Ukweli wa maisha' },
    kindCalibration: { both: 'Marekebisho' },
    kindSentiment: { both: 'Hisia za hivi karibuni' },
    loading: { both: 'Loading… / Inapakia…' },
    forbidden: {
      both:
        'You can only read your own personal-KB. / Unaweza tu kusoma maktaba yako mwenyewe.',
    },
    consentRequiredGloss: { both: 'Idhini inahitajika' },
    // The SW consent body wraps a <strong> around the settings path, so
    // it is split: prose before, the bold segment, prose after.
    consentBodySwBefore: {
      both: 'Ili kusoma kumbukumbu zako za kibinafsi tunahitaji idhini yako. Fungua ',
    },
    consentBodySwStrong: { both: 'Mipangilio → Idhini' },
    consentBodySwAfter: { both: ' kuruhusu.' },
    noCells: { both: 'No cells yet. / Hakuna kumbukumbu bado.' },
  },

  // app/(routes)/personal-kb/personal-kb-panel.tsx
  personalKbPanel: {
    roleOwner: { both: 'Mmiliki' },
    roleManager: { both: 'Meneja' },
    roleEmployee: { both: 'Mfanyakazi' },
    roleBuyer: { both: 'Mnunuzi' },
    roleAdmin: { both: 'Msimamizi' },
    searchGloss: { both: 'Tafuta kwenye maktaba yangu' },
    searchButton: { both: 'Search / Tafuta' },
    resultsGloss: { both: 'Matokeo ya utafutaji' },
    noMatches: { both: 'No matches yet. / Hakuna matokeo bado.' },
    hatsGloss: { both: 'Kofia zako — mahali pote unapotumia Borjie' },
    noHats: { both: 'No hats yet. / Hauna kofia bado.' },
    openButton: { both: 'Open / Fungua' },
  },
} as const satisfies Record<string, Record<string, SwEn | Both>>;

/**
 * Licence-renewal "start" audit summary. The licence number is woven
 * into the middle of the sentence, so it can't be a flat key — this
 * helper reproduces the original interpolated strings verbatim
 * (SW: `Upyaji wa leseni <number> umeanza`; EN falls back to the noun
 * "licence" when the number is empty).
 */
export function renewalStartSummary(
  isSw: boolean,
  licenceNumber: string,
): string {
  return isSw
    ? `Upyaji wa leseni ${licenceNumber} umeanza`
    : `Renewal for ${licenceNumber || 'licence'} started`;
}
