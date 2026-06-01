/**
 * data-b — guard-exempt bilingual strings for the second migration batch.
 *
 * The locale-purity scanner (`i18n/locale-purity.ts`) skips everything
 * under `i18n/`, so this is the sanctioned home for the Swahili+English
 * literals that used to live inline in the batch-b components. Each entry
 * is a `{ sw, en }` pair; callers pick the side with their own
 * `isSw`/`locale` flag exactly as before — the only change is that the
 * Swahili text no longer sits in component source, which is what lets
 * those files drop off the leak allowlist.
 *
 * Convention mirrors the routes-grind strings modules:
 *   import { dataBStrings as S } from '@/i18n/strings/data-b';
 *   {isSw ? S.someKey.sw : S.someKey.en}
 */

export const dataBStrings = {
  // ── finance/RoyaltyDraftPanel ──────────────────────────────────────
  royaltyCutOff7d: { sw: 'Siku 7 zimebaki', en: 'Cut-off in 7 days' },
  royaltySignedYesterday: { sw: 'Saini jana', en: 'Signed yesterday' },
  royaltyStatusSubmitted: { sw: 'Imepelekwa', en: 'Submitted' },
  royaltyStatusSigned: { sw: 'Imesainiwa', en: 'Signed' },
  royaltyStatusReviewing: { sw: 'Inakaguliwa', en: 'In review' },
  royaltyStatusDraft: { sw: 'Rasimu', en: 'Draft' },
  royaltyMetricGrossLabel: { sw: 'Mauzo ya April', en: 'April gross sales' },
  royaltyMetricGrossSub: { sw: 'Kabla ya mrabaha', en: 'Pre-royalty top line' },
  royaltyMetricRoyaltyLabel: {
    sw: 'Mrabaha wa April',
    en: 'April royalty draft',
  },
  royaltyMetricRoyaltySub: {
    sw: 'Itapelekwa Mining Commission',
    en: 'Owed to Mining Commission',
  },
  royaltyMetricDraftsLabel: { sw: 'Rasimu zinasubiri', en: 'Drafts pending' },
  royaltyMetricDraftsSub: { sw: 'Zinahitaji saini', en: 'Need signature' },
  royaltyMetricSignedLabel: { sw: 'Zilizosainiwa', en: 'Signed' },
  royaltyMetricSignedSub: { sw: 'Tayari kwa kutuma', en: 'Ready to submit' },
  royaltyPanelTitle: {
    sw: 'Rasimu ya mrabaha - April 2026',
    en: 'Royalty draft - April 2026',
  },
  royaltyPanelSubtitle: {
    sw: 'Kila madini kwa kiwango chake cha kisheria',
    en: 'Each mineral at its statutory rate',
  },
  royaltySignBatch: { sw: 'Saini batch', en: 'Sign the batch' },
  royaltyColMineral: { sw: 'Madini / Mgodi', en: 'Mineral / site' },
  royaltyColRate: { sw: 'Kiwango', en: 'Rate' },
  royaltyColGross: { sw: 'Mauzo', en: 'Gross' },
  royaltyColRoyalty: { sw: 'Mrabaha', en: 'Royalty' },
  royaltyColStatus: { sw: 'Hali', en: 'Status' },

  // ── fleet/MaintenanceTable ─────────────────────────────────────────
  maintFlagOverdue: { sw: 'imechelewa', en: 'overdue' },
  maintFlagDueSoon: { sw: 'hivi karibuni', en: 'due soon' },
  maintEmpty: {
    sw: 'Hakuna matengenezo siku 30 zilizopita.',
    en: 'No maintenance events in the last 30 days.',
  },
  maintColAsset: { sw: 'Mali', en: 'Asset' },
  maintColKind: { sw: 'Aina', en: 'Kind' },
  maintColStarted: { sw: 'Imeanza', en: 'Started' },
  maintColDuration: { sw: 'Muda', en: 'Duration' },
  maintColStatus: { sw: 'Hali', en: 'Status' },

  // ── fleet/NewMaintenanceModal ──────────────────────────────────────
  newMaintKindPreventive: { sw: 'Kinga', en: 'Preventive' },
  newMaintKindCorrective: { sw: 'Marekebisho', en: 'Corrective' },
  newMaintKindInspection: { sw: 'Ukaguzi', en: 'Inspection' },
  newMaintDialogLabel: {
    sw: 'Anza matengenezo',
    en: 'Open new maintenance',
  },
  newMaintTitle: { sw: '', en: 'Open new maintenance' },
  newMaintSubtitle: { sw: 'Anza matengenezo mapya', en: '' },
  newMaintFieldAsset: { sw: 'Mali', en: 'Asset' },
  newMaintPickOption: { sw: 'chagua', en: 'pick' },
  newMaintFieldKind: { sw: 'Aina', en: 'Kind' },
  newMaintFieldDescription: { sw: 'Maelezo', en: 'Description' },
  newMaintFieldEta: { sw: 'Masaa', en: 'ETA hours' },
  newMaintCancel: { sw: 'Ghairi', en: 'Cancel' },
  newMaintSubmit: { sw: 'Anza', en: 'Open maintenance' },

  // ── home-chat/PersonaGreeting ──────────────────────────────────────
  greetSuggestionPortfolio: {
    sw: 'Onyesha muhtasari wa portfolio',
    en: 'Show portfolio overview',
  },
  greetSuggestionCash: {
    sw: 'Hali ya hela na siku zilizobaki',
    en: 'Cash position and runway days',
  },
  greetSuggestionDecisions: {
    sw: 'Maamuzi yanayosubiri',
    en: 'Decisions awaiting my attention',
  },
  greetSubline: {
    sw: 'niko hapa kukusaidia. Uliza chochote kuhusu mgodi wako.',
    en: 'ask me anything about your operation.',
  },
  greetChipsLabel: {
    sw: 'Anza na moja ya hizi',
    en: 'Start with one of these',
  },

  // ── home-chat/StepperBar ───────────────────────────────────────────
  stepperGreetingWord: { sw: 'Karibu', en: 'Welcome' },
  stepperOrientTitle: { sw: 'Tambua mali', en: 'Orient your estate' },
  stepperLicenceTitle: { sw: 'Leseni & EIA', en: 'Licence and EIA' },
  stepperRoyaltyTitle: {
    sw: 'Mrabaha & Forodha',
    en: 'Royalty and clearance',
  },
  stepperWorkforceTitle: {
    sw: 'Wafanyakazi & Mafunzo',
    en: 'Workforce and training',
  },
  stepperMarketplaceTitle: {
    sw: 'Soko & Mauzo',
    en: 'Marketplace and sales',
  },
  stepperStateComplete: { sw: ' (imekamilika)', en: ' (complete)' },
  stepperStateLocked: { sw: ' (imefungwa)', en: ' (locked)' },
  stepperProgress: { sw: 'Maendeleo', en: 'Progress' },
  stepperAriaSteps: { sw: 'Hatua za mafunzo', en: 'Learning steps' },
  stepperExpand: { sw: 'Panua', en: 'Expand' },
  stepperCollapse: { sw: 'Funga', en: 'Collapse' },
  stepperHeading: { sw: 'Mafunzo ya umiliki', en: 'Estate literacy' },

  // ── home-chat/inline-blocks/CitationsBlock ─────────────────────────
  citationKindCorpus: { sw: 'Hifadhi', en: 'Corpus' },
  citationKindWeb: { sw: 'Tovuti', en: 'Web' },
  citationKindDoc: { sw: 'Hati', en: 'Document' },
  citationHeadlineFallback: { sw: 'Vyanzo', en: 'Sources' },
  citationClose: { sw: 'Funga', en: 'Close' },
  citationOpenSource: { sw: 'Fungua chanzo', en: 'Open source' },

  // ── home-chat/inline-blocks/DocQuestBlock ──────────────────────────
  docQuestTitleFallback: { sw: 'Kazi ya hati', en: 'Document quest' },
  docQuestEyebrow: { sw: 'Kazi ya hati', en: 'Document side quest' },
  docQuestStart: { sw: 'Anza kazi', en: 'Start quest' },

  // ── home-chat/inline-blocks/FileRequestCardBlock ───────────────────
  fileReqEyebrow: { sw: 'Hati inahitajika', en: 'Document needed' },
  fileReqAcceptedLabel: { sw: 'Aina', en: 'Accepted' },
  fileReqAcceptedFallback: { sw: 'PDF / picha', en: 'PDF / image' },
  fileReqMax: { sw: 'upeo', en: 'max' },
  fileReqUpload: { sw: 'Pakia hati', en: 'Upload document' },
  fileReqOpenDocs: { sw: 'Fungua docs', en: 'Open docs tab' },
  fileReqSelected: { sw: 'Imechaguliwa:', en: 'Selected:' },

  // ── home-chat/inline-blocks/InlineDashboardBlock ───────────────────
  inlineDashFallbackTitle: { sw: 'Dashibodi', en: 'Dashboard' },
  inlineDashMaxDepth: {
    sw: 'Kina cha juu zaidi cha 3 kimefikiwa.',
    en: 'Max nesting depth (3) reached.',
  },

  // ── licences/LicencesList ──────────────────────────────────────────
  licenceFilterAll: { sw: 'Zote', en: 'All' },
  licenceFilterActive: { sw: 'Hai', en: 'Active' },
  licenceFilterPending: { sw: 'Inasubiri', en: 'Pending' },
  licenceFilterExpiring: { sw: 'Inakaribia', en: 'Expiring' },
  licenceFilterExpired: { sw: 'Imekwisha', en: 'Expired' },
  licenceCountdownNone: { sw: 'Bila tarehe', en: 'No expiry set' },
  licenceCountdownExpiredAgo: {
    sw: 'Imekwisha siku {n} zilizopita',
    en: 'Expired {n} days ago',
  },
  licenceCountdownToday: { sw: 'Inaisha leo', en: 'Expires today' },
  licenceCountdownRemaining: {
    sw: 'Siku {n} zimebaki',
    en: '{n} days remaining',
  },
  licenceLoadError: {
    sw: 'Imeshindwa kupakia leseni. Geuza kuingia tena au angalia muunganisho.',
    en: 'Failed to load licences. Reauthenticate or retry the gateway.',
  },
  licenceEmptyTitle: { sw: 'Hakuna leseni bado', en: 'No licences yet' },
  licenceEmptyBody: {
    sw: 'Sajili leseni yako ya kwanza kupitia onboarding ya Akili Kuu.',
    en: 'Register the first licence via the Master Brain onboarding flow.',
  },
  licenceSearchPlaceholder: {
    sw: 'Tafuta nambari, madini, eneo',
    en: 'Search number, mineral, site',
  },
  licenceColLicence: { sw: 'Leseni', en: 'Licence' },
  licenceColMineral: { sw: 'Madini', en: 'Mineral' },
  licenceColSite: { sw: 'Eneo / Mgodi', en: 'Site' },
  licenceColStatus: { sw: 'Hali', en: 'Status' },
  licenceColNextAction: { sw: 'Hatua inayofuata', en: 'Next action' },
  licenceSiteUnassigned: { sw: 'Hakitajwa', en: 'Not assigned' },
  licenceNoMatch: {
    sw: 'Hakuna leseni inayolingana na vichungi vyako vya sasa.',
    en: 'No licences match the current filters.',
  },
  licenceBrainNote: {
    sw: 'Akili Kuu inaangalia kila leseni kwa hatari ya kuanguka kwa dormancy na inafanya rasimu ya pakiti ya kuongeza muda siku 60 kabla ya tarehe ya mwisho.',
    en: 'Master Brain monitors every licence for dormancy-forfeiture risk and drafts the renewal pack 60 days before the expiry cliff.',
  },

  // ── marketplace/MarketplaceBoard ───────────────────────────────────
  mktMetricOpenLabel: { sw: 'Parcel zilizo wazi', en: 'Open parcels' },
  mktMetricOpenSub: {
    sw: 'Zinatangaziwa kwenye soko',
    en: 'Live on the board',
  },
  mktMetricMatchedLabel: { sw: 'Imepatikana mnunuzi', en: 'Matched buyers' },
  mktMetricMatchedSub: { sw: 'Tayari kwa malipo', en: 'Ready for settlement' },
  mktMetricCounterLabel: { sw: 'Counter zinasubiri', en: 'Counter offers' },
  mktMetricCounterSub: { sw: 'Zinahitaji uamuzi wako', en: 'Need your call' },
  mktMetricAvgLabel: { sw: 'Wastani wa bei', en: 'Average offer' },
  mktMetricAvgSub: { sw: 'Per parcel ya leo', en: 'Per parcel today' },
  mktLoadError: {
    sw: 'Imeshindwa kupakia orodha za soko. Geuza muunganisho au jaribu tena.',
    en: 'Failed to load marketplace listings. Check the gateway and retry.',
  },
  mktOutboundTitle: { sw: 'Outbound — uuzaji', en: 'Outbound (sell)' },
  mktOutboundSubtitle: {
    sw: 'parcel zinazoangaliwa na wanunuzi',
    en: 'parcels visible to buyers',
  },
  mktOutboundEmpty: {
    sw: 'Hakuna parcel iliyowekwa.',
    en: 'No active outbound listings.',
  },
  mktInboundTitle: { sw: 'RFB za wanunuzi', en: 'Inbound buyer RFBs' },
  mktInboundSubtitle: {
    sw: 'maombi ya wanunuzi karibu nawe',
    en: 'buyer requests within radius',
  },
  mktInboundLoading: { sw: 'Inapakia RFB…', en: 'Loading RFBs…' },
  mktInboundError: {
    sw: 'Imeshindwa kupata RFB za wanunuzi.',
    en: 'Failed to load buyer RFBs.',
  },
  mktInboundEmpty: {
    sw: 'Hakuna maombi mapya ya wanunuzi sasa hivi.',
    en: 'No new buyer requests right now.',
  },
  mktDistanceUnknown: {
    sw: 'Mbali isiyojulikana',
    en: 'Distance unknown',
  },
  mktChipNew: { sw: 'Mpya', en: 'New' },
  mktChipMatched: { sw: 'Imepatana', en: 'Matched' },
  mktChipOpen: { sw: 'Inasubiri', en: 'Open' },

  // ── marketplace/RfbDispatchPanel ───────────────────────────────────
  rfbNoManager: {
    sw: 'Tovuti hii haina msimamizi aliyepangwa.',
    en: 'This site has no manager assigned.',
  },
  rfbLoadingSites: { sw: 'Inapakia tovuti…', en: 'Loading sites…' },
  rfbSitesError: { sw: 'Imeshindwa kupakia tovuti.', en: 'Failed to load sites.' },
  rfbNoDispatchable: {
    sw: 'Hakuna tovuti yenye msimamizi aliyepangwa. Mwongezee msimamizi tovuti kabla ya kupeleka RFB.',
    en: 'No sites with an assigned manager. Assign a manager to a site before dispatching an RFB.',
  },
  rfbPickSite: { sw: 'Chagua tovuti', en: 'Pick a site' },
  rfbSelectSiteOption: { sw: '— Chagua tovuti —', en: '— Select a site —' },
  rfbManagerHint: {
    sw: 'Msimamizi wa tovuti uliyochagua atapata kazi hii moja kwa moja.',
    en: "The selected site's manager will receive this task.",
  },
  rfbDueLabel: { sw: 'Tarehe ya mwisho (hiari)', en: 'Due date (optional)' },
  rfbSiteLabel: { sw: 'Tovuti:', en: 'Site:' },
  rfbManagerLabel: { sw: 'Msimamizi:', en: 'Manager:' },
  rfbDispatching: { sw: 'Inatumwa…', en: 'Dispatching…' },
  rfbDispatch: { sw: 'Tuma kwa msimamizi', en: 'Dispatch to manager' },
  rfbCancel: { sw: 'Ghairi', en: 'Cancel' },
  rfbToast: {
    sw: 'Imetumwa kwa msimamizi. Task:',
    en: 'Dispatched to manager. Task:',
  },

  // ── onboarding/steps ───────────────────────────────────────────────
  onbCompanyName: { sw: 'Jina la kampuni', en: 'Company name' },
  onbRegistrationNo: { sw: 'Namba ya usajili', en: 'Registration no.' },
  onbRegisteredAddress: { sw: 'Anwani', en: 'Registered address' },
  onbDirectorName: { sw: 'Jina la mkurugenzi', en: 'Director full name' },
  onbDirectorNida: { sw: 'Kitambulisho cha NIDA', en: 'Director NIDA' },
  onbChooseFiles: { sw: 'au chagua faili', en: 'or choose files' },
  onbSeedHintSw: {
    sw: 'Chagua kichwa kifupi kwa muhtasari wako wa kwanza wa siku.',
    en: '',
  },
  onbHeadline: { sw: 'Kichwa', en: 'Headline' },
} as const;
