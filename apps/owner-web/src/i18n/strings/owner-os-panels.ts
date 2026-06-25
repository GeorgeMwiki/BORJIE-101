/**
 * owner-os-panels — guard-exempt Swahili+English string table for the
 * owner-os panels wired off `EmptyPanelBody` onto live BFF data
 * (Wave PANELS-WIRE).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal a wired panel needs (column
 * headers, loading / error / empty captions, row labels, CTA copy) lives
 * here rather than inline in the component — keeping the panel sources
 * free of hardcoded Swahili tokens while preserving the symmetric
 * `isSw ? S.x.key.sw : S.x.key.en` call-site shape used across owner-os.
 *
 * SHAPE
 * Namespaced by panel. Each leaf is `{ sw, en }`. A small `shared` block
 * holds the generic loading / error / refresh captions reused by every
 * wired panel so the bilingual copy stays in one place.
 */

export const ownerOsPanelsStrings = {
  // ── Generic captions reused by every wired panel ────────────────────
  shared: {
    loading: { sw: 'Inapakia…', en: 'Loading…' },
    errorTitle: {
      sw: 'Imeshindwa kupakia data',
      en: 'Could not load data',
    },
    errorBody: {
      sw: 'Jaribu tena baadaye. Ikiendelea, mwambie Bw. Mwikila aangalie muunganisho.',
      en: 'Try again shortly. If it persists, ask Mr. Mwikila to check the connection.',
    },
    retry: { sw: 'Jaribu tena', en: 'Retry' },
    /** Followed at the call site by the row count, then `rowsSuffix`. */
    rowsPrefix: { sw: '', en: '' },
    rowsSuffix: { sw: ' kati ya jumla', en: ' shown' },
  },

  // ── HoldingsPanel → GET /api/v1/estate/groups ───────────────────────
  holdings: {
    sectionTitle: { sw: 'Makundi ya umiliki', en: 'Holding groups' },
    sectionSubtitle: {
      sw: 'Makundi ya familia yaliyosajiliwa na mwenye hisa mkuu.',
      en: 'Registered family groups and their principal owner.',
    },
    colName: { sw: 'Kundi', en: 'Group' },
    colType: { sw: 'Aina', en: 'Type' },
    colCountry: { sw: 'Nchi', en: 'Country' },
    colPrincipal: { sw: 'Mwenye hisa mkuu', en: 'Principal owner' },
    emptyTitle: { sw: 'Hakuna kundi la umiliki bado', en: 'No holding groups yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila aweke muundo wa kundi lako la familia ili kuanza.',
      en: 'Ask Mr. Mwikila to set up your family group structure to get started.',
    },
    ask: {
      sw: 'Niwekee muundo wa kundi langu la familia',
      en: 'Set up my family group structure',
    },
  },

  // ── SubsidiariesPanel → GET /api/v1/estate/entities ─────────────────
  subsidiaries: {
    heroTitle: {
      sw: 'Kampuni za Tanzu — taasisi unazomiliki',
      en: 'Subsidiaries — entities you own',
    },
    heroSubtitle: {
      sw: 'Fuatilia kampuni za tanzu, utendaji wao, na mtiririko wa kati ya kampuni.',
      en: 'Track child companies, their performance, and intercompany flows.',
    },
    sectionTitle: { sw: 'Kampuni za tanzu', en: 'Subsidiary entities' },
    sectionSubtitle: {
      sw: 'Kampuni za tanzu, hisa za umiliki na hali yake.',
      en: 'Child entities, ownership stake and status.',
    },
    colName: { sw: 'Kampuni', en: 'Entity' },
    colKind: { sw: 'Aina', en: 'Kind' },
    colOwnership: { sw: 'Umiliki', en: 'Ownership' },
    colStatus: { sw: 'Hali', en: 'Status' },
    emptyTitle: { sw: 'Hakuna kampuni za tanzu bado', en: 'No subsidiaries yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila aandikishe kampuni yako ya kwanza ya tanzu.',
      en: 'Ask Mr. Mwikila to register your first subsidiary entity.',
    },
    ask: {
      sw: 'Niandikishe kampuni mpya ya tanzu',
      en: 'Register a new subsidiary entity',
    },
  },

  // ── FamilyOfficePanel → GET /api/v1/estate/groups ───────────────────
  familyOffice: {
    sectionTitle: { sw: 'Ofisi ya familia', en: 'Family office' },
    sectionSubtitle: {
      sw: 'Wenye hisa wakuu wa kila kundi lililosajiliwa.',
      en: 'Principal owners across each registered group.',
    },
    colPrincipal: { sw: 'Mwenye hisa', en: 'Principal' },
    colGroup: { sw: 'Kundi', en: 'Group' },
    colFounded: { sw: 'Mwaka', en: 'Founded' },
    emptyTitle: { sw: 'Hakuna ofisi ya familia bado', en: 'No family office yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila aanzishe ofisi ya familia yako na wenye hisa wake.',
      en: 'Ask Mr. Mwikila to set up your family office and its principals.',
    },
    ask: {
      sw: 'Nianzishie ofisi ya familia na wenye hisa wake',
      en: 'Set up my family office and principals',
    },
  },

  // ── SuccessionPanel → GET /api/v1/estate/succession-plans ───────────
  succession: {
    sectionTitle: { sw: 'Mipango ya urithi', en: 'Succession plans' },
    sectionSubtitle: {
      sw: 'Warithi waliopangwa na tarehe ya tathmini ijayo.',
      en: 'Designated successors and next review date.',
    },
    colPrincipal: { sw: 'Mwenye hisa wa sasa', en: 'Current principal' },
    colSuccessor: { sw: 'Mrithi aliyepangwa', en: 'Designated successor' },
    colRelation: { sw: 'Uhusiano', en: 'Relation' },
    colNextReview: { sw: 'Tathmini ijayo', en: 'Next review' },
    emptyTitle: { sw: 'Hakuna mpango wa urithi bado', en: 'No succession plan yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila atengeneze mpango wa urithi kulinda urithi wa familia.',
      en: 'Ask Mr. Mwikila to draft a succession plan to protect your legacy.',
    },
    ask: {
      sw: 'Nitengenezee mpango wa urithi',
      en: 'Draft a succession plan',
    },
  },

  // ── AssetRegisterPanel → GET /api/v1/estate/assets ──────────────────
  assetRegister: {
    sectionTitle: { sw: 'Daftari la mali', en: 'Asset register' },
    sectionSubtitle: {
      sw: 'Mali, thamani ya sasa na njia ya tathmini.',
      en: 'Assets, current valuation and valuation method.',
    },
    colDescriptor: { sw: 'Mali', en: 'Asset' },
    colClass: { sw: 'Aina', en: 'Class' },
    colValue: { sw: 'Thamani ya sasa', en: 'Current value' },
    colMethod: { sw: 'Njia ya tathmini', en: 'Valuation method' },
    emptyTitle: { sw: 'Hakuna mali iliyosajiliwa bado', en: 'No assets registered yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila aandikishe mali yako ya kwanza kwenye daftari.',
      en: 'Ask Mr. Mwikila to register your first asset in the register.',
    },
    ask: {
      sw: 'Niandikishe mali kwenye daftari',
      en: 'Register an asset in the register',
    },
  },

  // ── GeologyPanel → GET /api/v1/mining/drill-holes ───────────────────
  geology: {
    sectionTitle: { sw: 'Mashimo ya kuchimba', en: 'Drill holes' },
    sectionSubtitle: {
      sw: 'Mashimo ya hivi karibuni ya uchunguzi, kina na mwelekeo.',
      en: 'Most recent exploration holes, depth and azimuth.',
    },
    colHole: { sw: 'Shimo', en: 'Hole' },
    colDepth: { sw: 'Kina (m)', en: 'Depth (m)' },
    colAzimuth: { sw: 'Mwelekeo', en: 'Azimuth' },
    colDip: { sw: 'Mteremko', en: 'Dip' },
    emptyTitle: { sw: 'Hakuna mashimo ya kuchimba bado', en: 'No drill holes yet' },
    emptyBody: {
      sw: 'Mara timu ya uwandani inaporekodi shimo la kwanza, litaonekana hapa.',
      en: 'Once the field team logs the first hole, it appears here.',
    },
    ask: {
      sw: 'Nionyeshe jinsi ya kurekodi shimo la kuchimba',
      en: 'Show me how to log a drill hole',
    },
  },

  // ── ReportsPanel → GET /api/v1/mining/reports ───────────────────────
  reports: {
    sectionTitle: { sw: 'Ripoti zilizozalishwa', en: 'Generated reports' },
    sectionSubtitle: {
      sw: 'Pakiti za ripoti zilizozalishwa hivi karibuni.',
      en: 'Most recently generated report packs.',
    },
    colKind: { sw: 'Aina', en: 'Kind' },
    colTitle: { sw: 'Kichwa', en: 'Title' },
    colGenerated: { sw: 'Imezalishwa', en: 'Generated' },
    emptyTitle: { sw: 'Hakuna ripoti bado', en: 'No reports yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila azalishe pakiti yako ya kwanza ya ripoti ya mwezi.',
      en: 'Ask Mr. Mwikila to generate your first monthly report pack.',
    },
    ask: {
      sw: 'Nizalishie pakiti ya ripoti ya mwezi',
      en: 'Generate a monthly report pack',
    },
  },

  // ── AuditPanel → GET /api/v1/audit-trail/entries ────────────────────
  audit: {
    sectionTitle: { sw: 'Mfululizo wa ukaguzi', en: 'Audit trail' },
    sectionSubtitle: {
      sw: 'Matukio ya hivi karibuni kwenye mfululizo usiobadilika.',
      en: 'Most recent entries on the append-only chain.',
    },
    colAction: { sw: 'Kitendo', en: 'Action' },
    colActor: { sw: 'Mhusika', en: 'Actor' },
    colCategory: { sw: 'Jamii', en: 'Category' },
    colWhen: { sw: 'Wakati', en: 'When' },
    emptyTitle: { sw: 'Hakuna matukio ya ukaguzi bado', en: 'No audit entries yet' },
    emptyBody: {
      sw: 'Mara vitendo vinaporekodi, mfululizo wa ukaguzi utaonekana hapa.',
      en: 'As actions are recorded, the audit trail surfaces here.',
    },
  },

  // ── CSRCommunityPanel → GET /api/v1/mining/csr-plans ────────────────
  csrCommunity: {
    sectionTitle: { sw: 'Mipango ya CSR', en: 'CSR plans' },
    sectionSubtitle: {
      sw: 'Ahadi za jamii kwa kijiji, hali na jamii.',
      en: 'Community pledges per village, status and category.',
    },
    colTitle: { sw: 'Mpango', en: 'Plan' },
    colCategory: { sw: 'Jamii', en: 'Category' },
    colStatus: { sw: 'Hali', en: 'Status' },
    emptyTitle: { sw: 'Hakuna mpango wa CSR bado', en: 'No CSR plans yet' },
    emptyBody: {
      sw: 'Mwambie Bw. Mwikila aweke ahadi yako ya kwanza ya CSR ya kijiji.',
      en: 'Ask Mr. Mwikila to log your first village CSR pledge.',
    },
    ask: {
      sw: 'Niwekee ahadi ya CSR ya kijiji',
      en: 'Log a village CSR pledge',
    },
  },

  // ── CTA-only panels (no backing route yet) ──────────────────────────
  ancillary: {
    ask: {
      sw: 'Niandikishe biashara mpya ya pembeni',
      en: 'Register a new side business',
    },
  },
  accounting: {
    ask: {
      sw: 'Nionyeshe muhtasari wa hesabu na malipo',
      en: 'Show me the accounting and payments summary',
    },
  },
  esg: {
    ask: {
      sw: 'Nionyeshe hali ya mazingira na jamii (ESG)',
      en: 'Show me the ESG and community status',
    },
  },
  procurement: {
    ask: {
      sw: 'Nionyeshe wauzaji na maagizo ya ununuzi',
      en: 'Show me suppliers and purchase orders',
    },
  },
  legal: {
    ask: {
      sw: 'Nionyeshe maktaba ya mikataba na rasimu',
      en: 'Show me the contracts library and drafts',
    },
  },

  // ── Shared CTA affordance label ─────────────────────────────────────
  cta: {
    askMwikila: { sw: 'Uliza Bw. Mwikila', en: 'Ask Mr. Mwikila' },
  },

  // ── Enum-token labels (raw-enum-render class) ───────────────────────
  // DB enum tokens (UPPER/snake_case codes) MUST NOT render verbatim in a
  // table cell: the raw English-ish token (`active`, `processing_plant`)
  // is invisible to source-literal scanners yet leaks under `sw`. Each
  // bounded vocabulary below maps every token the BFF can emit to one
  // canonical `{ sw, en }` label, resolved at the cell via `enumLabel()`
  // (see components/owner-os/panels/enum-label.ts). One canonical term per
  // concept (glossary): e.g. `status:active` is always "Inafanya kazi".
  //
  // Vocabularies are faithful copies of the gateway/database source of
  // truth; the contract test (panels/__tests__/enum-label-contract.test.ts)
  // pins them so a server-side vocabulary change forces a label here.
  enumLabels: {
    // estate_entities.kind — ESTATE_ENTITY_KINDS
    entityKind: {
      mine_licence_holder: { sw: 'Mwenye leseni ya mgodi', en: 'Mine licence holder' },
      processing_plant: { sw: 'Kiwanda cha uchakataji', en: 'Processing plant' },
      transport_co: { sw: 'Kampuni ya usafiri', en: 'Transport company' },
      equipment_rental: { sw: 'Ukodishaji wa vifaa', en: 'Equipment rental' },
      camp_catering: { sw: 'Huduma ya chakula kambini', en: 'Camp catering' },
      fuel_station: { sw: 'Kituo cha mafuta', en: 'Fuel station' },
      retail_at_site: { sw: 'Rejareja eneoni', en: 'Retail at site' },
      real_estate: { sw: 'Mali isiyohamishika', en: 'Real estate' },
      agriculture: { sw: 'Kilimo', en: 'Agriculture' },
      forestry: { sw: 'Misitu', en: 'Forestry' },
      tourism: { sw: 'Utalii', en: 'Tourism' },
      security_co: { sw: 'Kampuni ya ulinzi', en: 'Security company' },
      insurance_brokerage: { sw: 'Udalali wa bima', en: 'Insurance brokerage' },
      consulting_firm: { sw: 'Kampuni ya ushauri', en: 'Consulting firm' },
      training_school: { sw: 'Shule ya mafunzo', en: 'Training school' },
      subsidiary_holding: { sw: 'Umiliki wa tanzu', en: 'Subsidiary holding' },
      joint_venture: { sw: 'Ubia', en: 'Joint venture' },
      other: { sw: 'Nyingine', en: 'Other' },
    },
    // estate_entities.status — ESTATE_ENTITY_STATUSES
    entityStatus: {
      active: { sw: 'Inafanya kazi', en: 'Active' },
      dormant: { sw: 'Imelala', en: 'Dormant' },
      divested: { sw: 'Imeuzwa', en: 'Divested' },
      wound_up: { sw: 'Imefungwa', en: 'Wound up' },
    },
    // estate_groups.holding_type — ESTATE_HOLDING_TYPES
    holdingType: {
      family_office: { sw: 'Ofisi ya familia', en: 'Family office' },
      investment_co: { sw: 'Kampuni ya uwekezaji', en: 'Investment company' },
      trust: { sw: 'Dhamana', en: 'Trust' },
      sole_proprietor: { sw: 'Mmiliki pekee', en: 'Sole proprietor' },
      jv: { sw: 'Ubia', en: 'Joint venture' },
      cooperative_apex: { sw: 'Umoja wa ushirika', en: 'Cooperative apex' },
    },
    // estate_assets.asset_class — ESTATE_ASSET_CLASSES
    assetClass: {
      mining_licence: { sw: 'Leseni ya uchimbaji', en: 'Mining licence' },
      land_parcel: { sw: 'Kipande cha ardhi', en: 'Land parcel' },
      building: { sw: 'Jengo', en: 'Building' },
      plant_equipment: { sw: 'Mitambo na vifaa', en: 'Plant & equipment' },
      vehicle: { sw: 'Gari', en: 'Vehicle' },
      inventory: { sw: 'Bidhaa ghalani', en: 'Inventory' },
      financial_instrument: { sw: 'Chombo cha kifedha', en: 'Financial instrument' },
      intellectual_property: { sw: 'Hakimiliki', en: 'Intellectual property' },
      goodwill: { sw: 'Sifa njema', en: 'Goodwill' },
      crypto: { sw: 'Sarafu ya kidijitali', en: 'Crypto' },
      other: { sw: 'Nyingine', en: 'Other' },
    },
    // estate_assets.valuation_method — ESTATE_VALUATION_METHODS
    valuationMethod: {
      book_value: { sw: 'Thamani ya kitabu', en: 'Book value' },
      market_value: { sw: 'Thamani ya soko', en: 'Market value' },
      replacement_cost: { sw: 'Gharama ya kubadilisha', en: 'Replacement cost' },
      appraised: { sw: 'Iliyokadiriwa', en: 'Appraised' },
      discounted_cash_flow: { sw: 'Mtiririko wa fedha uliopunguzwa', en: 'Discounted cash flow' },
      other: { sw: 'Nyingine', en: 'Other' },
    },
    // csr_plans.category — education|water|health|roads|markets|land_rehab|youth|other
    csrCategory: {
      education: { sw: 'Elimu', en: 'Education' },
      water: { sw: 'Maji', en: 'Water' },
      health: { sw: 'Afya', en: 'Health' },
      roads: { sw: 'Barabara', en: 'Roads' },
      markets: { sw: 'Masoko', en: 'Markets' },
      land_rehab: { sw: 'Urejeshaji wa ardhi', en: 'Land rehabilitation' },
      youth: { sw: 'Vijana', en: 'Youth' },
      other: { sw: 'Nyingine', en: 'Other' },
    },
    // csr_plans.status — draft|approved|in_progress|completed|cancelled
    csrStatus: {
      draft: { sw: 'Rasimu', en: 'Draft' },
      approved: { sw: 'Imeidhinishwa', en: 'Approved' },
      in_progress: { sw: 'Inaendelea', en: 'In progress' },
      completed: { sw: 'Imekamilika', en: 'Completed' },
      cancelled: { sw: 'Imeghairiwa', en: 'Cancelled' },
    },
    // community_meetings.status — scheduled|held|cancelled|deferred (ESG panel)
    communityMeetingStatus: {
      scheduled: { sw: 'Imepangwa', en: 'Scheduled' },
      held: { sw: 'Imefanyika', en: 'Held' },
      cancelled: { sw: 'Imeghairiwa', en: 'Cancelled' },
      deferred: { sw: 'Imeahirishwa', en: 'Deferred' },
    },
    // legal contract status (contracts library — future table). Mirrors the
    // legal-draft lifecycle the contracts route will expose.
    legalContractStatus: {
      draft: { sw: 'Rasimu', en: 'Draft' },
      under_review: { sw: 'Inakaguliwa', en: 'Under review' },
      negotiating: { sw: 'Inajadiliwa', en: 'Negotiating' },
      executed: { sw: 'Imesainiwa', en: 'Executed' },
      active: { sw: 'Inatumika', en: 'Active' },
      expired: { sw: 'Imeisha muda', en: 'Expired' },
      terminated: { sw: 'Imesitishwa', en: 'Terminated' },
    },
    // ancillary business status (side-business table — future). Reuses the
    // estate-entity lifecycle so the vocabulary stays canonical.
    ancillaryStatus: {
      active: { sw: 'Inafanya kazi', en: 'Active' },
      dormant: { sw: 'Imelala', en: 'Dormant' },
      divested: { sw: 'Imeuzwa', en: 'Divested' },
      wound_up: { sw: 'Imefungwa', en: 'Wound up' },
    },
    // interactive_reports.render_kind ∪ renderer_kind (document render jobs).
    renderKind: {
      html_bundle: { sw: 'Kifurushi cha HTML', en: 'HTML bundle' },
      html_with_video: { sw: 'HTML yenye video', en: 'HTML with video' },
      html_with_charts: { sw: 'HTML yenye chati', en: 'HTML with charts' },
      print_pdf_fallback: { sw: 'PDF ya kuchapisha', en: 'Printable PDF' },
      text: { sw: 'Maandishi', en: 'Text' },
      docxtemplater: { sw: 'Hati ya Word', en: 'Word document' },
      'react-pdf': { sw: 'PDF', en: 'PDF' },
      typst: { sw: 'Typst', en: 'Typst' },
    },
    // audit_events.actor_kind — ACTOR_KIND_ENUM
    auditActorKind: {
      ai_autonomous: { sw: 'AI inayojiendesha', en: 'AI (autonomous)' },
      ai_proposal: { sw: 'Pendekezo la AI', en: 'AI proposal' },
      ai_execution: { sw: 'Utekelezaji wa AI', en: 'AI execution' },
      human_approval: { sw: 'Idhini ya mtu', en: 'Human approval' },
      human_override: { sw: 'Ubadilishaji wa mtu', en: 'Human override' },
      human_action: { sw: 'Kitendo cha mtu', en: 'Human action' },
      system: { sw: 'Mfumo', en: 'System' },
    },
    // ── Non-owner-os surfaces (raw-enum-render sweep, round 11) ──────────
    // These extend the enum-label apparatus to the cockpit surfaces that
    // were rendering DB tokens verbatim. Same canon: one `{ sw, en }` per
    // token, resolved via enumLabel(); the contract test pins each domain.

    // sites.status (SiteSummary.status) — lifecycle string off the gateway
    // sites row. The column is a free string (default 'unknown'), so the
    // vocabulary covers the known lifecycle values and the helper humanises
    // anything else rather than leaking a raw token under `sw`.
    siteStatus: {
      active: { sw: 'Inafanya kazi', en: 'Active' },
      planned: { sw: 'Imepangwa', en: 'Planned' },
      exploration: { sw: 'Uchunguzi', en: 'Exploration' },
      development: { sw: 'Maendeleo', en: 'Development' },
      production: { sw: 'Uzalishaji', en: 'Production' },
      suspended: { sw: 'Imesimamishwa', en: 'Suspended' },
      'care_and_maintenance': { sw: 'Uangalizi na matengenezo', en: 'Care & maintenance' },
      rehabilitation: { sw: 'Urejeshaji', en: 'Rehabilitation' },
      closed: { sw: 'Imefungwa', en: 'Closed' },
      dormant: { sw: 'Imelala', en: 'Dormant' },
      unknown: { sw: 'Haijajulikana', en: 'Unknown' },
      unspecified: { sw: 'Haijabainishwa', en: 'Unspecified' },
    },
    // lmbm graph node.kind — LmbmNodeKind (lib/types/lmbm.ts)
    lmbmNodeKind: {
      company: { sw: 'Kampuni', en: 'Company' },
      licence: { sw: 'Leseni', en: 'Licence' },
      site: { sw: 'Eneo', en: 'Site' },
      document: { sw: 'Hati', en: 'Document' },
      person: { sw: 'Mtu', en: 'Person' },
      event: { sw: 'Tukio', en: 'Event' },
    },
    // market-intelligence disruption_alerts.kind
    disruptionKind: {
      logistics: { sw: 'Usafirishaji', en: 'Logistics' },
      regulatory: { sw: 'Udhibiti', en: 'Regulatory' },
      weather: { sw: 'Hali ya hewa', en: 'Weather' },
      geopolitics: { sw: 'Siasa za kimataifa', en: 'Geopolitics' },
    },
    // Shared alert severity — disruption_alerts.severity ∪ expansion
    // recommendation.severity. One canonical scale across both surfaces.
    alertSeverity: {
      info: { sw: 'Taarifa', en: 'Info' },
      low: { sw: 'Chini', en: 'Low' },
      medium: { sw: 'Wastani', en: 'Medium' },
      high: { sw: 'Juu', en: 'High' },
      critical: { sw: 'Hatari kubwa', en: 'Critical' },
    },
    // capacity-expansion scenario.kind — ExpansionKind (hyphenated tokens)
    expansionKind: {
      'new-shaft': { sw: 'Shimo jipya', en: 'New shaft' },
      'new-site': { sw: 'Eneo jipya', en: 'New site' },
      'processing-upgrade': { sw: 'Uboreshaji wa uchakataji', en: 'Processing upgrade' },
    },
    // head-briefing escalation.priority — 'P1' | 'P2' | 'P3'
    escalationPriority: {
      P1: { sw: 'Kipaumbele P1', en: 'Priority P1' },
      P2: { sw: 'Kipaumbele P2', en: 'Priority P2' },
      P3: { sw: 'Kipaumbele P3', en: 'Priority P3' },
    },
    // head-briefing pending-approval.urgency — 'low' | 'medium' | 'high'
    approvalUrgency: {
      low: { sw: 'Si ya haraka', en: 'Low' },
      medium: { sw: 'Ya wastani', en: 'Medium' },
      high: { sw: 'Ya haraka', en: 'High' },
    },
    // owner-os reminders.status (dispatch lifecycle)
    reminderStatus: {
      scheduled: { sw: 'Imepangwa', en: 'Scheduled' },
      sending: { sw: 'Inatumwa', en: 'Sending' },
      sent: { sw: 'Imetumwa', en: 'Sent' },
      acknowledged: { sw: 'Imepokelewa', en: 'Acknowledged' },
      failed: { sw: 'Imeshindikana', en: 'Failed' },
      cancelled: { sw: 'Imeghairiwa', en: 'Cancelled' },
    },
    // owner-os reminders.channel (delivery channel)
    reminderChannel: {
      email: { sw: 'Barua pepe', en: 'Email' },
      sms: { sw: 'SMS', en: 'SMS' },
      slack: { sw: 'Slack', en: 'Slack' },
      whatsapp: { sw: 'WhatsApp', en: 'WhatsApp' },
    },
    // head-briefing notable-action.domain — AutonomyDomain (autonomy/types.ts)
    autonomyDomain: {
      finance: { sw: 'Fedha', en: 'Finance' },
      offtake: { sw: 'Ununuzi wa madini', en: 'Offtake' },
      maintenance: { sw: 'Matengenezo', en: 'Maintenance' },
      compliance: { sw: 'Uzingatiaji', en: 'Compliance' },
      communications: { sw: 'Mawasiliano', en: 'Communications' },
      marketing: { sw: 'Masoko', en: 'Marketing' },
      hr: { sw: 'Rasilimali watu', en: 'HR' },
      procurement: { sw: 'Ununuzi', en: 'Procurement' },
      insurance: { sw: 'Bima', en: 'Insurance' },
      'legal_proceedings': { sw: 'Kesi za kisheria', en: 'Legal proceedings' },
      'community_welfare': { sw: 'Ustawi wa jamii', en: 'Community welfare' },
    },
    // md-agentic sandbox-writes status (staged-write lifecycle)
    sandboxWriteStatus: {
      pending: { sw: 'Inasubiri', en: 'Pending' },
      committed: { sw: 'Imethibitishwa', en: 'Committed' },
      rejected: { sw: 'Imekataliwa', en: 'Rejected' },
    },
    // md-agentic sandbox-writes operation (the staged DB verb)
    sandboxOperation: {
      insert: { sw: 'Kuongeza', en: 'Insert' },
      update: { sw: 'Kusasisha', en: 'Update' },
      delete: { sw: 'Kufuta', en: 'Delete' },
      upsert: { sw: 'Kuongeza/kusasisha', en: 'Upsert' },
    },

    // audit_events.action_category — ACTION_CATEGORY_ENUM (incl. legacy aliases)
    auditActionCategory: {
      finance: { sw: 'Fedha', en: 'Finance' },
      offtake: { sw: 'Ununuzi wa madini', en: 'Offtake' },
      royalty_collection: { sw: 'Ukusanyaji wa mrabaha', en: 'Royalty collection' },
      licence_suspension: { sw: 'Kusimamisha leseni', en: 'Licence suspension' },
      counterparty_welfare: { sw: 'Ustawi wa mshirika', en: 'Counterparty welfare' },
      maintenance: { sw: 'Matengenezo', en: 'Maintenance' },
      compliance: { sw: 'Uzingatiaji', en: 'Compliance' },
      communications: { sw: 'Mawasiliano', en: 'Communications' },
      marketing: { sw: 'Masoko', en: 'Marketing' },
      hr: { sw: 'Rasilimali watu', en: 'HR' },
      procurement: { sw: 'Ununuzi', en: 'Procurement' },
      insurance: { sw: 'Bima', en: 'Insurance' },
      legal: { sw: 'Sheria', en: 'Legal' },
      other: { sw: 'Nyingine', en: 'Other' },
      // Deprecated legacy aliases — retained so immutable historical
      // hash-chained entries still resolve to a localized label.
      leasing: { sw: 'Ukodishaji', en: 'Leasing' },
      rent_collection: { sw: 'Ukusanyaji wa kodi', en: 'Rent collection' },
      tenant_welfare: { sw: 'Ustawi wa mpangaji', en: 'Tenant welfare' },
      eviction: { sw: 'Kufukuza', en: 'Eviction' },
    },
  },
} as const;
