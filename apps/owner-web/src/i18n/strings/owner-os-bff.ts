/**
 * owner-os-bff — guard-exempt Swahili+English string table for the final
 * five owner-os panels migrated off CTA-only stubs onto live BFF data
 * (Wave PANELS-WIRE, final five): Accounting, ESG, Procurement, Legal,
 * Ancillary.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal these panels need (hero copy,
 * column headers, empty-state captions) lives here rather than inline in
 * the component — keeping the panel sources free of hardcoded Swahili
 * tokens while preserving the symmetric `isSw ? S.x.key.sw : S.x.key.en`
 * call-site shape used across owner-os.
 *
 * SHAPE
 * Namespaced by panel. Each leaf is `{ sw, en }`. Two panels (ESG,
 * Procurement) landed on real tenant rows and so carry column headers;
 * three (Accounting, Legal, Ancillary) currently return a real empty
 * list (their domain tables are not yet modelled) and so carry only
 * hero + empty-state copy.
 *
 * The CTA prompt + "Ask Mr. Mwikila" label are reused from
 * `owner-os-panels.ts` (`P.<area>.ask`, `P.cta.askMwikila`).
 */

export const ownerOsBffStrings = {
  // ── AccountingPanel → GET /api/v1/mining/accounting/ledger ──────────
  // Empty contract: accounting-journal domain table still needed.
  accounting: {
    heroTitle: { sw: 'Uhasibu', en: 'Accounting' },
    heroSubtitle: {
      sw: 'Jarida la malipo na madeni, makundi ya umri wa madeni, na foleni ya upatanisho.',
      en: 'Journal feed, AP / AR ageing buckets and the reconciliation queue.',
    },
    colDate: { sw: 'Tarehe', en: 'Date' },
    colAccount: { sw: 'Akaunti', en: 'Account' },
    colAmount: { sw: 'Kiasi', en: 'Amount' },
    emptyTitle: { sw: 'Hakuna kumbukumbu za uhasibu bado', en: 'No accounting records yet' },
    emptyBody: {
      sw: 'Jarida la uhasibu litaonekana hapa mara tu kumbukumbu zitakapowekwa. Mwambie Bw. Mwikila akupe muhtasari wa hesabu.',
      en: 'Journal rows will surface here once records are posted. Ask Mr. Mwikila for the accounting summary in the meantime.',
    },
  },

  // ── ESGPanel → GET /api/v1/mining/esg/community ─────────────────────
  // Real rows: village_meetings (community engagement log).
  esg: {
    heroTitle: { sw: 'ESG — mazingira, jamii, urejeshaji', en: 'ESG — environment, community, reclamation' },
    heroSubtitle: {
      sw: 'Kumbukumbu ya mikutano ya jamii vijijini katika kila eneo la mgodi.',
      en: 'Minuted community engagement meetings across every mine site.',
    },
    colVillage: { sw: 'Kijiji', en: 'Village' },
    colDate: { sw: 'Tarehe', en: 'Date' },
    colStatus: { sw: 'Hali', en: 'Status' },
    colAttendees: { sw: 'Waliohudhuria', en: 'Attendees' },
    emptyTitle: { sw: 'Hakuna mikutano ya jamii bado', en: 'No community meetings yet' },
    emptyBody: {
      sw: 'Mikutano ya jamii vijijini itaonekana hapa mara tu itakaporekodiwa. Mwambie Bw. Mwikila aandae mkutano wa jamii.',
      en: 'Community meetings will surface here once they are logged. Ask Mr. Mwikila to schedule a community meeting.',
    },
  },

  // ── ProcurementPanel → GET /api/v1/mining/procurement/recommendations
  // Real rows: procurement_recommendations.
  procurement: {
    descriptorLabel: { sw: 'Manunuzi', en: 'Procurement' },
    descriptorDescription: {
      sw: 'Wauzaji, oda zilizo wazi na utaratibu wa nukuu tatu.',
      en: 'Suppliers, open purchase orders and 3-quote workflow.',
    },
    draftRfqTool: { sw: 'Tayarisha RFQ', en: 'Draft RFQ' },
    heroTitle: { sw: 'Manunuzi', en: 'Procurement' },
    heroSubtitle: {
      sw: 'Mapendekezo ya manunuzi yaliyotengenezwa na msaidizi wa manunuzi kwa kila eneo.',
      en: 'Procurement recommendations produced by the procurement junior, per site.',
    },
    colSummary: { sw: 'Pendekezo', en: 'Recommendation' },
    colSite: { sw: 'Eneo', en: 'Site' },
    colDate: { sw: 'Tarehe', en: 'Date' },
    // Fallback label when a recommendation row carries no summary headline.
    summaryFallback: { sw: 'Pendekezo la manunuzi', en: 'Procurement recommendation' },
    noSite: { sw: 'Maeneo yote', en: 'All sites' },
    emptyTitle: { sw: 'Hakuna mapendekezo ya manunuzi bado', en: 'No procurement recommendations yet' },
    emptyBody: {
      sw: 'Mapendekezo ya manunuzi yataonekana hapa msaidizi atakapoyatengeneza. Mwambie Bw. Mwikila kuhusu wauzaji na maagizo ya ununuzi.',
      en: 'Procurement recommendations will surface here once the junior produces them. Ask Mr. Mwikila about suppliers and purchase orders.',
    },
  },

  // ── LegalPanel → GET /api/v1/mining/legal/contracts ─────────────────
  // Empty contract: contracts-library domain table still needed.
  legal: {
    descriptorLabel: { sw: 'Sheria', en: 'Legal' },
    descriptorDescription: {
      sw: 'Maktaba ya mikataba, sanduku la rasimu na foleni ya majibu ya wakili.',
      en: 'Contracts library, draft inbox and counsel response queue.',
    },
    draftContractTool: { sw: 'Tayarisha mkataba', en: 'Draft contract' },
    heroTitle: { sw: 'Sheria', en: 'Legal' },
    heroSubtitle: {
      sw: 'Maktaba ya mikataba, sanduku la rasimu na foleni ya majibu ya wakili.',
      en: 'Contracts library, draft inbox and outside-counsel response queue.',
    },
    colTitle: { sw: 'Mkataba', en: 'Contract' },
    colCounterparty: { sw: 'Mhusika', en: 'Counterparty' },
    colStatus: { sw: 'Hali', en: 'Status' },
    emptyTitle: { sw: 'Hakuna mikataba bado', en: 'No contracts yet' },
    emptyBody: {
      sw: 'Maktaba ya mikataba itaonekana hapa mara tu mikataba itakapowekwa. Mwambie Bw. Mwikila akuonyeshe maktaba ya mikataba na rasimu.',
      en: 'The contracts library will surface here once contracts are filed. Ask Mr. Mwikila to show the contracts library and drafts.',
    },
  },

  // ── AncillaryBusinessesPanel → GET /api/v1/mining/ancillary/businesses
  // Empty contract: ancillary-business domain table still needed.
  ancillary: {
    heroTitle: { sw: 'Biashara za pembeni', en: 'Ancillary — side businesses and ventures' },
    heroSubtitle: {
      sw: 'Biashara zisizo za msingi: usafiri, upishi, rejareja na nyinginezo.',
      en: 'Non-core ventures: transport, catering, retail and more.',
    },
    colName: { sw: 'Biashara', en: 'Business' },
    colSector: { sw: 'Sekta', en: 'Sector' },
    colStatus: { sw: 'Hali', en: 'Status' },
    emptyTitle: { sw: 'Hakuna biashara za pembeni bado', en: 'No ancillary businesses yet' },
    emptyBody: {
      sw: 'Biashara zako za pembeni zitaonekana hapa mara tu zitakapoongezwa. Mwambie Bw. Mwikila aandikishe biashara mpya ya pembeni.',
      en: 'Your side businesses will surface here once they are added. Ask Mr. Mwikila to register a new side business.',
    },
  },
} as const;
