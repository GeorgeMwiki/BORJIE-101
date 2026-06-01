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
      sw: 'Jaribu tena baadaye. Ikiendelea, mwambie Mr. Mwikila aangalie muunganisho.',
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
      sw: 'Mwambie Mr. Mwikila aweke muundo wa kundi lako la familia ili kuanza.',
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
      sw: 'Mwambie Mr. Mwikila aandikishe kampuni yako ya kwanza ya tanzu.',
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
      sw: 'Mwambie Mr. Mwikila aanzishe ofisi ya familia yako na wenye hisa wake.',
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
      sw: 'Mwambie Mr. Mwikila atengeneze mpango wa urithi kulinda urithi wa familia.',
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
      sw: 'Mwambie Mr. Mwikila aandikishe mali yako ya kwanza kwenye daftari.',
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
      sw: 'Mwambie Mr. Mwikila azalishe pakiti yako ya kwanza ya ripoti ya mwezi.',
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
      sw: 'Mwambie Mr. Mwikila aweke ahadi yako ya kwanza ya CSR ya kijiji.',
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
    askMwikila: { sw: 'Uliza Mr. Mwikila', en: 'Ask Mr. Mwikila' },
  },
} as const;
