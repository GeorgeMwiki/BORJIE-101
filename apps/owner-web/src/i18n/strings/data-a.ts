/**
 * Guard-exempt bilingual string table — batch "data-a".
 *
 * The locale-purity scanner (`src/i18n/locale-purity.ts`) treats every
 * file under `i18n/` as the ONLY legitimate home for Swahili literals.
 * This module hoists the inline `isSw ? '…' : '…'` / `locale === 'sw'`
 * Swahili+English pairs out of a batch of owner-web components so those
 * component files drop out of the leak set while their rendered copy is
 * preserved byte-for-byte.
 *
 * Convention:
 *   - one namespace per source file (keyed by its short name);
 *   - each leaf is `{ sw, en }`, or a pure function returning `{ sw, en }`
 *     when the original literal interpolated runtime values;
 *   - callers select with the component's existing locale logic, e.g.
 *       `{isSw ? S.assets.totalValue.sw : S.assets.totalValue.en}`.
 *
 * No component logic lives here — only the strings.
 */

export const dataAStrings = {
  // ── components/EntityTimeline/EntityTimelineDrawer.tsx ──────────────
  entityTimelineDrawer: {
    titleByKind: {
      reminder: { sw: 'Historia ya kumbukumbu', en: 'Reminder history' },
      draft: { sw: 'Historia ya rasimu', en: 'Draft history' },
      parcel: { sw: 'Historia ya parcel', en: 'Parcel history' },
      bid: { sw: 'Historia ya zabuni', en: 'Bid history' },
    },
    close: { sw: 'Funga', en: 'Close' },
    events: { sw: 'Matukio', en: 'Events' },
  },

  // ── components/shared/EntityTimeline.tsx ───────────────────────────
  entityTimeline: {
    defaultTitle: { sw: 'Ratiba', en: 'Timeline' },
    empty: { sw: 'Hakuna matukio bado.', en: 'No timeline events yet.' },
  },

  // ── components/EntityTimeline/composers.ts ─────────────────────────
  composers: {
    reminder: {
      created: { sw: 'Kumbukumbu imeundwa', en: 'Reminder created' },
      stateChange: (state: string) => ({
        sw: `Hali imebadilika kuwa: ${state}`,
        en: `State changed to: ${state}`,
      }),
    },
    draft: {
      created: { sw: 'Rasimu imeandaliwa', en: 'Draft prepared' },
      stateChange: (state: string) => ({
        sw: `Hali ya rasimu: ${state}`,
        en: `Draft status: ${state}`,
      }),
    },
    parcel: {
      created: { sw: 'Parcel imerekodi', en: 'Parcel logged' },
      stateChange: (state: string) => ({
        sw: `Hali ya parcel: ${state}`,
        en: `Parcel state: ${state}`,
      }),
    },
    bid: {
      created: { sw: 'Zabuni imewekwa', en: 'Bid placed' },
      stateChange: (state: string) => ({
        sw: `Hali ya zabuni: ${state}`,
        en: `Bid state: ${state}`,
      }),
    },
  },

  // ── components/artifacts/ArtifactRenderer.tsx ──────────────────────
  artifactRenderer: {
    classification: {
      public: { sw: 'Hadharani', en: 'Public' },
      internal: { sw: 'Ndani ya Kampuni', en: 'Internal' },
      confidential: { sw: 'Siri', en: 'Confidential' },
    },
    disclaimer: {
      sw: 'Imeundwa na akili-bandia. Maamuzi ni yako.',
      en: 'AI-generated. Decisions are yours.',
    },
    loading: { sw: 'Inapakia…', en: 'Loading…' },
    retry: { sw: 'Jaribu tena', en: 'Retry' },
  },

  // ── components/blackboard/Blackboard.tsx ───────────────────────────
  blackboard: {
    title: { sw: 'Ubao wa kufundishia', en: 'Teaching board' },
    subtitle: (count: number, replaying: boolean) => ({
      sw: `${count} vipengele${replaying ? ' · inacheza tena' : ''}`,
      en: `${count} element${count === 1 ? '' : 's'}${replaying ? ' · replaying' : ''}`,
    }),
    replay: { sw: 'Cheza tena', en: 'Replay' },
    exportPdf: { sw: 'Hamisha PDF', en: 'Export PDF' },
    clear: { sw: 'Futa ubao', en: 'Clear board' },
    defaultCompany: { sw: 'mgodi wako', en: 'your operation' },
    emptyEyebrow: { sw: 'Ubao mtupu', en: 'Empty board' },
    emptyBodyLead: {
      sw: 'Niulize kuhusu mrabaha, leseni, mlolongo wa malipo, au utii wa NEMC kwa',
      en: 'Ask about royalty, licences, chain of custody, or NEMC compliance for',
    },
    emptyBodyTail: {
      sw: 'Nitachora kwenye ubao huu kadri tunavyozungumza.',
      en: 'I will draw on this board as we talk.',
    },
    emptyExample: {
      sw: 'Mfano: "Nielezee jinsi mrabaha unahesabiwa"',
      en: 'Example: "Teach me how royalty is calculated"',
    },
  },

  // ── components/chat/HandoffCard.tsx ────────────────────────────────
  handoffCard: {
    copy: {
      en: {
        sentTo: 'Sent to',
        pending: 'Awaiting reply',
        closed: 'Closed without reply',
        declined: 'Declined',
        re: 'Re:',
        site: 'Site:',
        category: 'Topic:',
      },
      sw: {
        sentTo: 'Imetumwa kwa',
        pending: 'Inasubiri jibu',
        closed: 'Imefungwa bila jibu',
        declined: 'Imekataliwa',
        re: 'Kuhusu:',
        site: 'Eneo:',
        category: 'Mada:',
      },
    },
    roleLabel: {
      T1_owner_strategist: { en: 'Owner', sw: 'Mmiliki' },
      T2_admin_strategist: { en: 'Admin', sw: 'Msimamizi' },
      T3_module_manager: { en: 'Manager', sw: 'Meneja' },
      T4_field_employee: { en: 'Worker', sw: 'Mfanyakazi' },
      T5_customer_concierge: { en: 'Concierge', sw: 'Mhudumu' },
      T_auditor: { en: 'Auditor', sw: 'Mkaguzi' },
      T_vendor: { en: 'Vendor', sw: 'Muuzaji' },
    },
    relTime: {
      sec: (n: number) => ({ sw: `${n}s zilizopita`, en: `${n}s ago` }),
      min: (n: number) => ({ sw: `${n}m zilizopita`, en: `${n}m ago` }),
      hr: (n: number) => ({ sw: `${n}h zilizopita`, en: `${n}h ago` }),
      day: (n: number) => ({ sw: `${n}d zilizopita`, en: `${n}d ago` }),
    },
  },

  // ── components/compliance/ComplianceSurface.tsx ────────────────────
  complianceSurface: {
    metrics: {
      totalLabel: { sw: 'Jumla ya majukumu', en: 'Total obligations' },
      totalSub: { sw: 'Mawasiliano hai ya udhibiti', en: 'Live regulator threads' },
      overdueLabel: { sw: 'Zimepitwa', en: 'Overdue' },
      overdueSub: { sw: 'Hatari ya faini', en: 'Penalty risk window' },
      watchingLabel: { sw: 'Inakaribia', en: 'Watching' },
      watchingSub: { sw: 'Inahitaji uangalifu wa wiki', en: 'Within 7-day window' },
      filedLabel: { sw: 'Iliyopita', en: 'Filed' },
      filedSub: { sw: 'Inakubaliana na ratiba', en: 'On cadence' },
    },
    cadenceTitle: { sw: 'Ratiba ya udhibiti', en: 'Regulator cadence' },
    cadenceSubtitle: {
      sw: 'Mining Commission, NEMC, BoT, TRA na OSHA — yote katika sehemu moja',
      en: 'Mining Commission, NEMC, BoT, TRA and OSHA in one rolled-up view',
    },
    colRegulator: { sw: 'Mdhibiti', en: 'Regulator' },
    colObligation: { sw: 'Jukumu', en: 'Obligation' },
    colCadence: { sw: 'Mzunguko', en: 'Cadence' },
    colNextAction: { sw: 'Hatua inayofuata', en: 'Next action' },
    citationsTitle: { sw: 'Vidokezo vya hivi karibuni', en: 'Recent citations' },
    citation1: {
      sw: 'Sera ya 2025/12 ya Mining Commission inahusu uhamishaji wa parcel.',
      en: 'Mining Commission directive 2025/12 covers parcel transfer logging.',
    },
    citation2: {
      sw: 'BoT memo 2026-03 — uthibitisho wa export proceeds umebadilika.',
      en: 'BoT memo 2026-03 introduces a new export-proceeds attestation form.',
    },
    citation3: {
      sw: 'NEMC inahimiza uchunguzi wa maji chini ya ardhi kwa migodi mipya.',
      en: 'NEMC has stepped up groundwater testing for newly-permitted sites.',
    },
    actionPlanTitle: { sw: 'Mpango wa hatua', en: 'Action plan' },
    actionPlanBody: {
      sw: 'Akili Kuu inakusanya mafaili yote ya uthibitisho na kuandaa pakiti za kila mwezi za udhibiti. Kila kitu kinawekwa kwa mlolongo wa hashi kwa ukaguzi.',
      en: 'Master Brain compiles every supporting file and assembles the monthly regulator pack. Every artefact lands on the hash-chained audit trail for inspection.',
    },
    track: {
      royaltyMonthly: {
        obligation: {
          sw: 'Mrabaha wa kila mwezi (6% ya dhahabu)',
          en: 'Monthly royalty filing (6% gold)',
        },
        nextDue: { sw: 'Siku 6 zimebaki', en: 'Due in 6 days' },
      },
      renewalPml: {
        obligation: {
          sw: 'Maombi ya kuongeza muda wa PML/247',
          en: 'PML/247 renewal pack submission',
        },
        nextDue: { sw: 'Imepita kwa siku 2', en: 'Overdue 2 days' },
      },
      nemcEia: {
        obligation: {
          sw: 'Ripoti ya robo mwaka ya EIA',
          en: 'Quarterly EIA monitoring report',
        },
        nextDue: { sw: 'Wiki 4 zimebaki', en: '4 weeks remaining' },
      },
      botFx: {
        obligation: {
          sw: 'Uthibitisho wa mapato ya nje',
          en: 'FX export-proceeds attestation',
        },
        nextDue: { sw: 'Imepelekwa siku 2 zilizopita', en: 'Submitted 2 days ago' },
      },
      traVat: {
        obligation: {
          sw: 'Kodi ya VAT ya kila mwezi',
          en: 'Monthly VAT return',
        },
        nextDue: { sw: 'Siku 12 zimebaki', en: '12 days remaining' },
      },
      oshaIncident: {
        obligation: {
          sw: 'Taarifa ya tukio ndani ya saa 24',
          en: 'Incident notification within 24h',
        },
        nextDue: { sw: 'Hakuna tukio', en: 'No open incidents' },
      },
    },
  },

  // ── components/dashboard/ComplianceSafetyPanel.tsx ─────────────────
  complianceSafetyPanel: {
    licenceHealth: { sw: 'Afya ya leseni', en: 'Licence health' },
    licencesTracked: { sw: 'leseni zinazofuatiliwa', en: 'licences tracked' },
    atRisk: { sw: 'zenye hatari', en: 'at risk' },
    rowAtRisk: { sw: 'hatari', en: 'at risk' },
    rowOk: { sw: 'sawa', en: 'ok' },
    mineralRight: { sw: 'haki ya madini', en: 'mineral right' },
    expiryUnknown: { sw: 'mwisho haujulikani', en: 'expiry unknown' },
    daysToExpiry: (days: number) => ({
      sw: `siku ${days} hadi mwisho`,
      en: `${days}d to expiry`,
    }),
    licenceEmpty: {
      sw: 'Hakuna safu za leseni zilizotatuliwa bado. Cockpit ya leseni itajaza mara tu mfumo wa msajili utakapolingana kwa shirika lako.',
      en: 'No licence rows resolved yet. The licence cockpit will populate once the registrar feed reconciles for your tenant.',
    },
    incidents: { sw: 'Matukio mazito', en: 'High-severity incidents' },
    openLast7d: { sw: 'wazi · siku 7 zilizopita', en: 'open · last 7d' },
    timeUnknown: { sw: 'muda haujulikani', en: 'time unknown' },
    incidentEmptyBefore: {
      sw: 'Hakuna matukio mazito yaliyo wazi. Uliza Ubongo wa Borjie kwenye',
      en: 'No open high-severity incidents. Ask Borjie Brain on',
    },
    incidentEmptyAfter: {
      sw: 'kwa ukaguzi wa usalama wa kina ikiwa unataka pasi ya pili.',
      en: 'for the long-tail safety scan if you want a second pass.',
    },
  },

  // ── components/dashboard/OwnerDashboardSurface.tsx ─────────────────
  ownerDashboardSurface: {
    updatedAt: (time: string) => ({
      sw: `Imesasishwa ${time}`,
      en: `Updated ${time}`,
    }),
    source: (source: string) => ({
      sw: `chanzo: ${source}`,
      en: `source: ${source}`,
    }),
    cached: { sw: '(imehifadhiwa)', en: '(cached)' },
    refreshing: { sw: 'inasasisha…', en: 'refreshing…' },
    offlineFallback: {
      sw: 'Uundaji wa dashibodi haupatikani.',
      en: 'Dashboard composition is offline.',
    },
    errorTitle: { sw: 'Data ya dashibodi haipatikani', en: 'Dashboard data is offline' },
    httpStatus: (status: number) => ({
      sw: `HTTP ${status}`,
      en: `HTTP ${status}`,
    }),
    errorHelpBefore: {
      sw: 'Uliza Ubongo wa Borjie moja kwa moja kwenye',
      en: 'Ask Borjie Brain directly on the',
    },
    errorHelpLink: { sw: 'gumzo la nyumbani', en: 'home chat' },
    errorHelpAfter: {
      sw: '— unaweza kuvuta ishara nyingi kati ya hizi papo hapo kutoka korpasi.',
      en: '— it can pull most of these signals on demand from the corpus.',
    },
  },

  // ── components/dashboard/AlertQueuePanel.tsx ───────────────────────
  alertQueuePanel: {
    title: { sw: 'Foleni ya tahadhari', en: 'Alert queue' },
    // Replaces the former hardcoded Swahili subhead that sat under the
    // English title (EN/SW split-brain) — now one language per locale.
    subtitle: {
      sw: 'Maamuzi yanayosubiri · matukio mazito',
      en: 'Pending decisions · high-severity incidents',
    },
    openCount: (count: number) => ({
      sw: `${count} wazi`,
      en: `${count} open`,
    }),
    empty: {
      before: {
        sw: 'Hakuna maamuzi wazi wala matukio mazito. Uliza Ubongo wa Borjie kwenye',
        en: 'No open decisions or high-severity incidents. Ask Borjie Brain on',
      },
      after: {
        sw: 'ili kuchanganua korpasi kwa lolote unaloweza kuwa umelikosa.',
        en: 'to scan the corpus for anything you might be missing.',
      },
    },
    // Localized row-source labels — the wire emits the neutral
    // 'decision' / 'incident' enum; the FE renders the active locale.
    source: {
      decision: { sw: 'uamuzi', en: 'decision' },
      incident: { sw: 'tukio', en: 'incident' },
    },
  },

  // ── components/dashboard/AiDailyBriefPanel.tsx ─────────────────────
  aiDailyBrief: {
    title: { sw: 'Muhtasari wa siku wa AI', en: 'AI daily brief' },
    subtitle: { sw: 'Muhtasari wa siku', en: 'Daily summary' },
    critical: (count: number) => ({ sw: `${count} mazito`, en: `${count} critical` }),
    allClear: { sw: 'salama', en: 'all clear' },
    emptyBefore: {
      sw: 'Hakuna shughuli iliyorekodiwa leo. Uliza Ubongo wa Borjie kwenye',
      en: 'No activity logged yet today. Ask Borjie Brain on',
    },
    emptyAfter: {
      sw: 'ili kuburudisha taarifa za uwandani.',
      en: 'to refresh the field signal.',
    },
    shiftsLogged: { sw: 'Zamu zilizoandikwa', en: 'Shifts logged' },
    openIncidents: { sw: 'Matukio yaliyo wazi', en: 'Open incidents' },
    openGrievances: { sw: 'Malalamiko yaliyo wazi', en: 'Open grievances' },
    criticalIncidents: { sw: 'Matukio mazito', en: 'Critical incidents' },
  },

  // ── components/dashboard/DailyBriefCard.tsx ────────────────────────
  dailyBrief: {
    cardAria: { sw: 'Muhtasari wa siku', en: "Today's daily brief" },
    persona: { sw: 'Bw. Mwikila', en: 'Mr. Mwikila' },
    role: { sw: 'Mkurugenzi Mtendaji wa AI', en: 'AI Managing Director' },
    actionPrefix: { sw: 'Hatua: ', en: 'Action: ' },
    chipProduction: { sw: 'Uzalishaji', en: 'Production' },
    chipTreasury: { sw: 'Hazina', en: 'Treasury' },
    chipCompliance: { sw: 'Utii', en: 'Compliance' },
    modalAria: { sw: 'Chanzo cha ushahidi', en: 'Source evidence' },
    sourceHeading: { sw: 'Chanzo', en: 'Source' },
    close: { sw: 'Funga', en: 'Close' },
    evidenceIdLabel: { sw: 'Kitambulisho cha ushahidi:', en: 'Evidence identifier:' },
    // Opens the live Ask-Borjie surface (/ask) seeded with a prompt so Mr.
    // Mwikila surfaces and cites this exact evidence — there is no standalone
    // evidence-viewer route; evidence is a brain-cited concept.
    openInLibrary: { sw: 'Fuatilia ushahidi huu', en: 'Trace this evidence' },
    evidencePrompt: {
      sw: (id: string) =>
        `Fuatilia na nukuu ushahidi wa chanzo nyuma ya muhtasari wa leo (ushahidi ${id}).`,
      en: (id: string) =>
        `Trace and cite the source evidence behind today's brief (evidence ${id}).`,
    },
    greeting: {
      morning: (salutation: string) => ({
        sw: `Habari za asubuhi, ${salutation}.`,
        en: `Good morning, ${salutation}.`,
      }),
      afternoon: (salutation: string) => ({
        sw: `Habari za mchana, ${salutation}.`,
        en: `Good afternoon, ${salutation}.`,
      }),
      evening: (salutation: string) => ({
        sw: `Habari za jioni, ${salutation}.`,
        en: `Good evening, ${salutation}.`,
      }),
    },
    summary: {
      shifts: (shifts: number, incidents: number) => ({
        sw: `Zamu ${shifts} zimeingia leo, matukio makubwa ${incidents} bado yapo wazi.`,
        en: `${shifts} shifts logged today; ${incidents} high incidents still open.`,
      }),
      decisions: (pending: number) => ({
        sw: `Maamuzi ${pending} yanasubiri uamuzi wako.`,
        en: `${pending} decisions are waiting on you.`,
      }),
    },
  },

  // ── components/dashboard/KpiStripPanel.tsx ─────────────────────────
  kpiStrip: {
    production: { sw: 'Uzalishaji · siku 30', en: 'Production · 30d' },
    cash: { sw: 'Hela · siku zilizobaki', en: 'Cash · days' },
    safety: { sw: 'Usalama · matukio mazito', en: 'Safety · open critical' },
    licences: { sw: 'Leseni · zenye hatari', en: 'Licences · at risk' },
    usdCliff: { sw: 'Tarehe ya USD', en: 'USD cliff' },
    metaSites: (count: number) => ({
      sw: `migodi ${count}`,
      en: `${count} sites`,
    }),
    metaCriticalToday: (count: number) => ({
      sw: `${count} mazito leo`,
      en: `${count} critical today`,
    }),
    metaOf: (atRisk: number, total: number) => ({
      sw: `${atRisk} kati ya ${total}`,
      en: `${atRisk} of ${total}`,
    }),
    metaRemediationComplete: {
      sw: 'urekebishaji umekamilika',
      en: 'remediation complete',
    },
    metaUsdContracts: (count: number) => ({
      sw: `mikataba ya USD ${count}`,
      en: `${count} USD contracts`,
    }),
  },

  // ── components/dashboard/ProductionVsTargetTable.tsx ───────────────
  productionVsTarget: {
    title: { sw: 'Uzalishaji dhidi ya lengo', en: 'Production vs target' },
    subtitle: { sw: 'Uzalishaji kwa migodi', en: 'Production by site' },
    sites: (count: number) => ({ sw: `migodi ${count}`, en: `${count} sites` }),
    empty: {
      sw: 'Hakuna ripoti za zamu zilizopokelewa kwa kipindi hiki.',
      en: 'No shift reports have landed for this window.',
    },
    colSite: { sw: 'Mgodi', en: 'Site' },
    colTonnes: { sw: 'Tani', en: 'Tonnes' },
    colFuel: { sw: 'Mafuta (L)', en: 'Fuel (L)' },
    colShifts: { sw: 'Zamu', en: 'Shifts' },
    unassigned: { sw: 'haijapangwa', en: 'unassigned' },
  },

  // ── components/estate/AssetsRegister.tsx ───────────────────────────
  assets: {
    classOptions: {
      all: { sw: 'Zote', en: 'All' },
      miningLicence: { sw: 'Leseni ya mgodi', en: 'Mining licence' },
      landParcel: { sw: 'Kiwanja', en: 'Land parcel' },
      building: { sw: 'Jengo', en: 'Building' },
      plantEquipment: { sw: 'Vifaa', en: 'Plant / equipment' },
      vehicle: { sw: 'Gari', en: 'Vehicle' },
      inventory: { sw: 'Bidhaa', en: 'Inventory' },
      financialInstrument: { sw: 'Chombo cha fedha', en: 'Financial instrument' },
      intellectualProperty: { sw: 'Haki miliki', en: 'IP' },
      goodwill: { sw: 'Sifa njema', en: 'Goodwill' },
      crypto: { sw: 'Sarafu za dijiti', en: 'Crypto' },
      other: { sw: 'Nyingine', en: 'Other' },
    },
    loading: { sw: 'Inapakia daftari la mali...', en: 'Loading asset register...' },
    loadError: { sw: 'Imeshindwa kupakia mali.', en: 'Could not load asset register.' },
    totalValueLabel: { sw: 'Jumla ya thamani', en: 'Total value' },
    totalValueSub: { sw: 'Hai katika kichujio cha sasa', en: 'Active in current filter' },
    assetCountLabel: { sw: 'Idadi ya mali', en: 'Asset count' },
    assetCountSub: (n: number) => ({ sw: `Madarasa ${n}`, en: `${n} classes` }),
    averageValueLabel: { sw: 'Thamani wastani', en: 'Average value' },
    registerTitle: { sw: 'Daftari la mali', en: 'Asset register' },
    registerSubtitle: {
      sw: 'Chuja kwa darasa la mali, fungua safu kuona historia ya thamani.',
      en: 'Filter by asset class, open a row for valuation history.',
    },
    emptyTitle: { sw: 'Hakuna mali', en: 'No assets' },
    emptyFilter: {
      sw: 'Hakuna mali kwenye kichujio cha sasa.',
      en: 'No assets match the current filter.',
    },
    filterAria: { sw: 'Chuja kwa darasa la mali', en: 'Filter by asset class' },
    colDescriptor: { sw: 'Maelezo', en: 'Descriptor' },
    colClass: { sw: 'Darasa', en: 'Class' },
    colValue: { sw: 'Thamani (TZS)', en: 'Value (TZS)' },
    colMethod: { sw: 'Mbinu', en: 'Method' },
    colValuedAt: { sw: 'Tathmini ya', en: 'Valued at' },
  },

  // ── components/estate/CapitalMovementsTimeline.tsx ─────────────────
  capitalMovements: {
    loading: { sw: 'Inapakia mtiririko...', en: 'Loading capital flows...' },
    loadError: { sw: 'Imeshindwa kupakia mtiririko.', en: 'Could not load capital flows.' },
    inflowLabel: { sw: 'Mtiririko ndani (siku 30)', en: 'Inflow (30d)' },
    inflowSub: {
      sw: 'Fedha zilizoingia kwenye kampuni za miliki',
      en: 'Money received by estate entities',
    },
    outflowLabel: { sw: 'Mtiririko nje (siku 30)', en: 'Outflow (30d)' },
    outflowSub: {
      sw: 'Fedha zilizotoka kwenye kampuni za miliki',
      en: 'Money paid out by estate entities',
    },
    netLabel: { sw: 'Salio (siku 30)', en: 'Net (30d)' },
    netSub: { sw: 'Mwendelezo wa miliki kwa siku 30', en: '30-day estate liquidity drift' },
    timelineTitle: { sw: 'Ratiba ya mtiririko', en: 'Flow timeline' },
    timelineSubtitle: (n: number) => ({
      sw: `Jumla ya tukio ${n} katika kumbukumbu.`,
      en: `${n} events on record.`,
    }),
    emptyTitle: { sw: 'Hakuna mtiririko bado', en: 'No flows yet' },
    empty: {
      sw: 'Hakuna mtiririko bado. Mtiririko wa kwanza utatengenezwa wakati LedgerService.post() inapozaa kumbukumbu ya kwanza ya kampuni-kati.',
      en: 'No flows yet. First entry appears when LedgerService.post() records an intercompany ledger row.',
    },
    to: { sw: 'kwenda', en: 'to' },
  },

  // ── components/estate/EntitiesList.tsx ─────────────────────────────
  entitiesList: {
    loading: { sw: 'Inapakia kampuni...', en: 'Loading entities...' },
    loadError: { sw: 'Imeshindwa kupakia kampuni.', en: 'Could not load entities.' },
    title: { sw: 'Kampuni zote', en: 'All entities' },
    subtitle: (n: number) => ({
      sw: `Jumla: ${n} kampuni hai chini ya miliki.`,
      en: `Total: ${n} entities under the estate.`,
    }),
    emptyTitle: { sw: 'Hakuna kampuni bado', en: 'No entities yet' },
    empty: {
      sw: 'Hakuna kampuni iliyosajiliwa bado. Anza kwa kuunda kikundi cha familia.',
      en: 'No entities registered yet. Start by creating a family-office group.',
    },
    kindPrefix: { sw: 'Aina: ', en: 'Kind: ' },
  },

  // ── components/estate/EstateOverview.tsx ───────────────────────────
  estateOverview: {
    loading: { sw: 'Inapakia miliki...', en: 'Loading estate...' },
    loadError: { sw: 'Imeshindwa kupakia data ya miliki.', en: 'Could not load estate data.' },
    noEstateTitle: { sw: 'Hakuna miliki bado', en: 'No estate registered yet' },
    noEstateSubtitle: {
      sw: 'Sajili kikundi cha familia chini ya /api/v1/estate/groups ili kuanza.',
      en: 'Register a family-office group via /api/v1/estate/groups to begin.',
    },
    noEstateBody: {
      sw: 'Mwambie Bw. Mwikila aanze kwa "tengeneza family office".',
      en: 'Ask Mr. Mwikila to "create a family office" to begin.',
    },
    noEntities: { sw: 'Hakuna kampuni.', en: 'No entities yet.' },
  },

  // ── components/estate/SuccessionPanel.tsx ──────────────────────────
  succession: {
    loading: { sw: 'Inapakia mipango ya urithi...', en: 'Loading succession plans...' },
    loadError: {
      sw: 'Imeshindwa kupakia mipango ya urithi.',
      en: 'Could not load succession plans.',
    },
    noPlanTitle: { sw: 'Hakuna mpango wa urithi bado', en: 'No succession plan yet' },
    noPlanSubtitle: {
      sw: 'Tengeneza mpango wa kwanza kupitia /api/v1/estate/succession-plans.',
      en: 'Create a plan via /api/v1/estate/succession-plans to start.',
    },
    noPlanBody: {
      sw: 'Mwambie Bw. Mwikila aanze kwa "tengeneza mpango wa urithi".',
      en: 'Ask Mr. Mwikila to "draft a succession plan" to begin.',
    },
    overdue: (n: number) => ({ sw: `Imepitwa siku ${n}`, en: `${n}d overdue` }),
    reviewIn: (n: number) => ({ sw: `Mapitio baada ya siku ${n}`, en: `Review in ${n}d` }),
    subtitle: (name: string, relation: string) => ({
      sw: `Mrithi aliyeteuliwa: ${name} (${relation})`,
      en: `Designated successor: ${name} (${relation})`,
    }),
    generateDraftWill: { sw: 'Tengeneza rasimu ya wosia', en: 'Generate draft will' },
    lastReview: { sw: 'Mapitio ya mwisho', en: 'Last review' },
    nextReview: { sw: 'Mapitio yanayofuata', en: 'Next review due' },
    contingency: { sw: 'Mrithi wa pili', en: 'Contingency successor' },
    designatedNida: { sw: 'NIDA ya mrithi aliyeteuliwa', en: 'Designated successor NIDA' },
    notes: { sw: 'Maelezo', en: 'Notes' },
  },

  // ── components/finance/PnlTableLive.tsx ────────────────────────────
  pnl: {
    monthlyTitle: { sw: 'P&L ya mwezi', en: 'Monthly P&L' },
    selectMonth: { sw: 'Chagua mwezi', en: 'Select month' },
    loadError: { sw: 'Imeshindwa kuchukua P&L. Jaribu tena.', en: 'Failed to load P&L. Try again.' },
    retry: { sw: 'Jaribu tena', en: 'Retry' },
  },
} as const;
