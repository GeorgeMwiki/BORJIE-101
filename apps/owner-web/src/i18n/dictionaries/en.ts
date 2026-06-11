/**
 * English source-of-truth dictionary for the owner cockpit.
 *
 * This is the ONLY file a human edits. The Swahili mirror (`sw.ts`) is
 * GENERATED from these strings by `scripts/i18n-generate-sw.mjs`
 * (Claude tier-1 via `@borjie/translation`, content-addressed in
 * `translation_cache`). Never hand-edit `sw.ts`.
 *
 * Rules for adding keys:
 *  - Group by surface namespace (`auth.signIn.*`, `dashboard.*`, …).
 *  - English only here — no Swahili, ever (the locale-purity guard
 *    fails the build if Swahili leaks into this file).
 *  - Use `{var}` placeholders for interpolation, never string concat.
 *  - A new key is dead until `pnpm i18n:gen` regenerates `sw.ts`.
 */

export const en = {
  common: {
    appName: 'Borjie',
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    continue: 'Continue',
    submit: 'Submit',
    error: 'Something went wrong.',
    breadcrumb: 'Breadcrumb',
    ownerNavigation: 'Owner navigation',
  },

  auth: {
    signIn: {
      eyebrow: 'Owner Cockpit',
      heading: 'Welcome back.',
      subheading: 'Sign in to continue to your cockpit.',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      footer: 'Audit chain · bilingual · Tanzania-resident',
      errorInvalidEmail: 'Enter a valid email address',
      errorPasswordRequired: 'Password is required',
      errorInvalidInput: 'Invalid details',
      errorSignInFailed: 'Sign-in failed. Check your details.',
      errorNetwork: 'Could not reach the Borjie API.',
    },
  },

  signup: {
    page: {
      eyebrow: 'Owner Cockpit',
      heading: 'Welcome to Borjie.',
      subheading: 'Sign up to start managing your mining operation.',
      title: 'Sign up',
    },
    wizard: {
      stepsAriaLabel: 'Signup steps',
      stepKind: 'Type',
      stepDetails: 'Details',
      stepConfirm: 'Confirm',
    },
    kind: {
      question: 'How would you like to sign up?',
      individualTitle: "I'm an individual miner",
      individualSubtitle: 'Artisanal miner or single-PML holder.',
      individualBullet1: 'Full name and phone',
      individualBullet2: 'Email',
      individualBullet3: 'Licence number (PML) — optional',
      individualBullet4: 'NIDA national ID — optional',
      businessTitle: 'I have a registered company',
      businessSubtitle: 'BRELA-registered company or PL/ML holder.',
      businessBullet1: 'Company name + BRELA number',
      businessBullet2: 'TIN number',
      businessBullet3: "Owner's name, phone, and email",
      businessBullet4: 'Licence number (PML/PL/ML) — optional',
    },
    individual: {
      heading: 'Your personal details',
    },
    business: {
      heading: 'Your company details',
    },
    field: {
      fullName: 'Full name',
      country: 'Country',
      phone: 'Phone',
      email: 'Email',
      language: 'Language',
      currency: 'Currency',
      miningLicence: 'Mining licence (PML)',
      miningLicenceBusiness: 'Mining licence (PML/PL/ML)',
      nationalId: 'NIDA national ID',
      orgName: 'Company name',
      businessReg: 'BRELA number',
      taxId: 'TIN number',
      ownerName: "Owner's name",
      ownerPhone: "Owner's phone",
      ownerEmail: "Owner's email",
      vat: 'VAT number',
      optional: '(optional)',
    },
    validation: {
      fullNameRequired: 'Full name is required',
      orgNameRequired: 'Company name is required',
      brelaRequired: 'BRELA number is required',
      tinRequired: 'TIN number is required',
      ownerNameRequired: "Owner's name is required",
      phoneInvalid: 'Enter a valid phone (e.g. +255712345678)',
      emailInvalid: 'Enter a valid email address',
    },
    nav: {
      back: '‹ Back',
      next: 'Continue ›',
      continue: 'Continue',
    },
    contact: {
      heading: 'Confirm and verify',
      labelType: 'Type',
      labelSummary: 'Summary',
      labelOwner: 'Owner',
      labelPhone: 'Phone',
      labelEmail: 'Email',
      sendOtp: 'Send OTP to my phone',
      submitting: 'Sending…',
      otpLabel: 'OTP sent to {phone}',
      verify: 'Verify',
      verifying: 'Verifying…',
      tryAgain: 'Try again',
      errorSignupFailed: 'Sign-up failed',
      errorBadResponse: 'Invalid response from server',
      errorNetwork: 'Could not reach the server',
      errorOtpInvalid: 'Enter a valid OTP code',
      errorOtpVerify: 'Could not verify OTP',
    },
  },

  dashboard: {
    greetingMorning: 'Good morning, {name}',
    greetingAfternoon: 'Good afternoon, {name}',
    greetingEvening: 'Good evening, {name}',
    subtitle: 'Here is your estate at a glance.',
    emptyState: 'Nothing to show yet.',

    eyebrow: "Today's cockpit",
    greeting: 'Welcome back, {name}',
    subline: '{legalName} - {region} - {sites} sites, plan: {plan}',
    ctaAsk: 'Ask Borjie',
    ctaCockpit: 'Cockpit view',
    ctaMasterBrain: 'Master Brain',
    briefSrHeading: "Mr. Mwikila's daily brief",

    todaysBrief: "Today's brief",
    metricOpenLicences: 'Open licences',
    metricOpenLicencesSub: 'Active PML / PL holdings',
    metricRoyaltyStatus: 'Royalty draft status',
    metricRoyaltyValue: 'In review',
    metricRoyaltySub: 'Drafting for the month cut-off',
    metricWorkforce: 'Workforce on shift',
    metricWorkforceSub: 'Morning shift - 3 sites',

    todaysActions: "Today's actions",
    actionSignProdTitle: 'Sign daily production report',
    actionSignProdContext: 'Site manager submitted the daily roll-up',
    actionOpen: 'Open',
    actionAdvancesTitle: 'Approve workforce advances',
    actionAdvancesContext: '3 requests above the standard limit',
    actionReview: 'Review',
    actionGoldTitle: 'Confirm gold sale offer',
    actionGoldContext: '2 buyers have submitted prices for today',
    actionCompare: 'Compare',
    actionNemcTitle: 'Sign NEMC submission',
    actionNemcContext: 'Monthly packet is pending your signature',
    actionSign: 'Sign',

    thisWeek: 'This week',
    eventLicenceExpiry: 'Licence expiry',
    eventLicenceExpiryWhen: 'Friday - 4 days',
    eventRoyaltyCutoff: 'Royalty cut-off',
    eventRoyaltyCutoffWhen: 'Monday - 7 days',
    eventNemcReview: 'NEMC review',
    eventNemcReviewWhen: 'Thursday - 10 days',

    brainStream: 'Brain stream',
    viewAll: 'View all',
    brainRecentTitle: 'Master Brain - recent decisions',
    brainRecentDesc: 'Top decisions with LMBM evidence and rationale.',
    brainRow1Title: 'Recommend holding 400g until Friday',
    brainRow1Detail: 'Gold price trending up 1.2% on the LBMA close',
    brainRow2Title: 'Warning: dormancy on PML/247',
    brainRow2Detail: '4-week gap - 28-day forfeiture risk window',
    brainRow3Title: 'Master Brain approved NEMC packet draft',
    brainRow3Detail: '14 citations attached from intelligence corpus',

    ownerOsHeading: 'Mr. Mwikila — your operating system',
    liveBrief: 'Live brief',

    // Real-data summary (replaces the former static metric/action/week/
    // brain-stream copy). Driven by GET /api/v1/owner/brief; each block
    // falls back to an explicit empty state rather than fabricated data.
    summaryEmptyTitle: 'Your cockpit fills as you operate',
    summaryEmptyBody:
      'Log a shift, add a licence, or ask Borjie Brain and your daily figures appear here.',
    summaryOffline: 'Live figures are offline right now.',
    metricLicencesAtRiskSub: '{count} at risk of expiry',
    metricLicencesNoneSub: 'No licences on file yet',
    metricDecisionsLabel: 'Decisions in review',
    metricDecisionsValueNone: 'All clear',
    metricDecisionsSub: '{count} awaiting your call',
    metricDecisionsNoneSub: 'Nothing pending right now',
    metricWorkforceShiftsSub: '{count} on shift today',
    metricWorkforceNoneSub: 'No shift logged yet',
    actionsEmpty: 'No actions need you right now.',
    actionReviewDecision: 'Review',
    thisWeekEmpty: 'No licence deadlines in view.',
    eventLicenceExpiresInDays: 'Expires in {count} days',
    eventLicenceExpirySoon: 'Expiring soon',
    brainStreamEmpty: 'Borjie Brain has no decisions logged yet.',
    brainAdvisorTitle: 'Advisor insight',
  },

  nav: {
    tenant: 'Tenant',
    ownerCockpit: 'Owner Cockpit',
    sectionOverview: 'Overview',
    sectionField: 'Field',
    sectionOperations: 'Operations',
    sectionMoney: 'Money',
    sectionCompliance: 'Compliance',
    sectionCommunity: 'Community',
    sectionSettings: 'Settings',
    home: 'Home',
    dashboard: 'Dashboard',
    cockpit: 'Cockpit',
    masterBrain: 'Master Brain',
    lmbm: 'LMBM',
    ask: 'Ask Borjie',
    headBriefing: 'Head briefing',
    agentic: 'Agentic plans',
    training: 'Training',
    portfolioMap: 'Portfolio map',
    sites: 'Sites',
    siteCockpit: 'Site cockpit',
    licences: 'Licences',
    licence: 'Licence',
    documents: 'Documents',
    documentIntelligence: 'Document intelligence',
    people: 'People',
    workforceTabs: 'Workforce tabs',
    fleet: 'Fleet',
    inventory: 'Inventory',
    geology: 'Geology',
    counterparties: 'Counterparties',
    chainOfCustody: 'Chain of custody',
    finance: 'Finance',
    sales: 'Sales',
    treasury: 'Treasury',
    marketplace: 'Marketplace',
    compliance: 'Compliance',
    safety: 'Safety',
    regulatorCalendar: 'Regulator calendar',
    community: 'Community',
    reports: 'Reports',
    groupView: 'Group view',
    onboarding: 'Onboarding',
    settings: 'Settings',
    notifications: 'Notifications',
    cooperatives: 'Cooperatives',
    insurance: 'Insurance',
    estate: 'Estate',
    inbox: 'Inbox',
    signOut: 'Sign out',
  },

  palette: {
    placeholder: 'Type a command or search...',
    recent: 'Recent',
    navigate: 'Navigate',
    action: 'Actions',
    spawnTab: 'Spawn tab',
    empty: 'No matches',
    actionRoyaltyDraft: 'Draft royalty filing',
    actionCreateReminder: 'Create a reminder',
    actionUploadDoc: 'Upload a document',
    actionCoopSettle: 'Cooperative settlement',
    actionShareLink: 'Generate share link',
    actionPinnedItems: 'Show my pinned items',
  },

  teach: {
    trustVerified: 'Verified · {count}-model debate',
    trustDebate: '{count}-model debate',
    autoAuthorized: 'Auto-authorized',
    hintHandoff: 'Connect me with a human advisor.',
    hintSimpler: 'Explain that more simply.',
    hintCmdk: 'Show me what I can do from here.',
    // Inline micro-action result bubbles. Rendered when an inline-block
    // tap executes (or is declined) through the gateway action-bridge.
    // `summary` carries a verb-specific line built from the tool result.
    microAction: {
      executed: '✓ {summary}',
      actionDone: 'Action completed.',
      reminderSet: 'Reminder set — {title}',
      reminderSetIn: 'Reminder set — {title} in {days} days',
      reminderSnoozed: 'Reminder snoozed {days} days',
      needsConfirmation: 'Needs your confirmation — {reason}',
      needsConfirmationBare: 'This action needs your confirmation.',
      // GENERATIVE FULFILLMENT (self-evolving org) — a brain-generated action
      // with no deterministic handler is fulfilled by the brain's own agentic
      // turn. These compose the structured follow-up the owner's tap sends.
      fulfill: 'Please go ahead with: {action}.',
      fulfillDetail: 'Please go ahead with: {action}. Details — {detail}.',
      // GENERATIVE TAB PROMOTION — a dynamic, brain-authored tab type the static
      // registry does not know defers to the brain to build + open it.
      promoteTab: 'Please build and open the full {label} tab.',
      // UNKNOWN-BLOCK affordance — a block kind the FE has no renderer for is
      // deferred to the brain to expand (re-emit as a known kind or describe
      // in prose). Never a raw `[unknown block]` at a paying owner.
      expandBlock: 'Please expand this for me.',
    },
    // Streaming chat lifecycle + controls. Single language per active locale.
    stream: {
      stop: 'Stop',
      stopAria: 'Stop generating',
      stopped: 'Response stopped',
      retry: 'Retry',
      attach: 'Attach a file',
      dropHere: 'Drop files to attach',
    },
    // Honest epistemic-state surface (Win #2 / INV-H). Rendered under an
    // assistant answer: a posture badge + three short axis lists. INV-H —
    // posture + axes only, never the audit math. EN/SW absolute.
    selfModel: {
      title: 'How sure I am',
      sureAbout: 'Sure about',
      unsureAbout: 'Unsure about',
      wouldNeed: 'Would help',
      posture: {
        answering: 'Confident',
        reasoning: 'Confident',
        clarifying: 'Needs detail',
        softening: 'Tentative',
        refusing: 'Holding back',
        deferring: 'Needs your call',
      },
    },
  },

  // Suite-wide portal switcher (the @borjie/app-shell <AppTopBar>). These
  // labels are injected into the headless shell so EN/SW never mix —
  // the shell itself hard-codes nothing.
  portal: {
    owner: 'Owner Cockpit',
    admin: 'Borjie Console',
    switch: 'Switch portal',
  },

  // Pilot in-app feedback widget (the fixed bottom-right pill + modal).
  // Always-on chrome, so every label flows through the dictionary to keep
  // EN/SW from mixing regardless of the active locale.
  feedback: {
    open: 'Tell Borjie',
    title: 'Share your experience',
    ratingPrompt: 'How was it?',
    noteLabel: 'Your note',
    messagePlaceholder: 'Write in Swahili or English...',
    cancel: 'Close',
    send: 'Send',
    error: 'Could not send — please try again',
  },

  // Top-bar sign-out control. Always-on chrome.
  signOut: {
    action: 'Sign out',
    pending: 'Signing out…',
    error: 'Could not sign out',
  },

  // Owner-OS reminders panel (list + create).
  reminders: {
    heading: 'Reminders',
    channelHint: 'Email default · SMS / Slack available',
    title: 'Title',
    body: 'Body',
    triggerAt: 'Trigger at',
    channel: 'Channel',
    saving: 'Saving…',
    schedule: 'Schedule reminder',
    empty: 'No reminders yet.',
    cancelItem: 'Cancel',
  },

  // MD-Agentic sandbox-writes review queue (O-W-33).
  sandboxQueue: {
    committed: 'Committed to the live system.',
    commitFailed: 'Commit failed',
    enterReasonFirst: 'Enter a reason first.',
    rejected: 'Rejected.',
    rejectFailed: 'Reject failed',
    loading: 'Loading staged writes…',
    empty: 'No staged writes in this view.',
    commit: 'Commit (four-eye)',
    rejectReason: 'Reject reason',
    rejectPlaceholder: 'Why reject this write?',
    reject: 'Reject',
  },

  // Head briefing surface (O-W-32, read-only).
  headBriefing: {
    unavailable: 'The morning briefing is unavailable right now.',
    noContent: 'No briefing content.',
    overnightActivity: 'Overnight activity',
    noAutonomousActions: 'No autonomous actions.',
    pendingApprovals: 'Pending approvals',
    nothingAwaiting: 'Nothing awaiting a decision.',
    escalations: 'Escalations',
    noEscalations: 'No escalations.',
    recommendations: 'Recommendations',
    noRecommendations: 'No recommendations.',
    anomalies: 'Anomalies',
  },

  // OwnerOSShell — the cockpit-home tab shell (OWNER-OS).
  ownerOsShell: {
    spawnNewTab: 'Spawn a new tab',
    newTab: 'New tab',
    recentTabs: 'Recent tabs',
    recentlyClosed: 'Recently closed',
    open: 'Open',
    dismissProposal: 'Dismiss proposal',
    genuiOpened: 'Opened "{title}" from your chat',
    inTabStrip: "It's in your tab strip — keep chatting.",
    openShort: 'Open',
    undo: 'Undo',
    dismiss: 'Dismiss',
    artifactPrepared: 'Prepared "{title}" from your chat',
    // Strip-friendly tab title per modality artifact kind (forecast/document/media).
    artifactTitle: {
      forecast: 'Forecast',
      document: 'Document',
      media: 'Media',
    },
  },

  // GenUI dynamic-tab host — a generated tab that ACTS (form-host, live
  // widgets, action buttons). All copy here is generic across any generated
  // tab (no per-tab strings).
  genuiTab: {
    // Form-host (record submission).
    submit: 'Save',
    submitting: 'Saving…',
    submitSuccess: 'Saved.',
    submitError: 'Could not save. Check your entries and try again.',
    requiredHint: 'Fill in the required fields.',
    // Records list (below the form).
    recordsHeading: 'Saved records',
    recordsEmpty: 'No records yet. Submit the form to add the first one.',
    recordsLoading: 'Loading records…',
    recordsError: 'Could not load records.',
    recordCreatedAt: 'Added {at}',
    recordsCreatedAtColumn: 'Created',
    // Live widgets.
    widgetLoading: 'Loading…',
    widgetError: 'Could not load this widget.',
    widgetEmpty: 'No data yet.',
    widgetPlaceholder: 'Live data appears here once this widget is connected.',
    widgetValueLabel: 'Value',
    // Action buttons.
    actionRunning: 'Working…',
    actionDone: 'Done.',
    actionDeclined: 'That needs confirmation: {reason}',
    actionHandlingIt: "On it — I'm handling that for you.",
    actionFailed: 'That action could not run.',
    // Field-level upload / address status strings (GenUIFieldRenderer).
    fieldUploading: 'Uploading…',
    fieldUploaded: 'Uploaded.',
    fieldReadingSignature: 'Reading…',
    fieldSignatureCaptured: 'Signature captured.',
    fieldSignatureReadError: 'Could not read signature image. Please choose a valid image file.',
    fieldUploadPreviewDisabled: 'preview — uploads require a saved tab',
    fieldUploadFailed: 'Upload failed',
    fieldAddressPlaceholder: 'Street address',
    fieldLatitude: 'Latitude',
    fieldLongitude: 'Longitude',
  },

  // Daily brief card (cockpit).
  cockpit: {
    dailyBriefTitle: 'Daily brief',
  },
} as const;

export type Dictionary = typeof en;
