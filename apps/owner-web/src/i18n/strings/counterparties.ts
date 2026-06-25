/**
 * Counterparties surface (O-W-24) — per-file {en, sw} string module.
 *
 * Single language per active locale (zero-mix canon). Every key carries a
 * REAL Swahili translation; no machine-translation stubs, no English value
 * sitting in the `sw` slot.
 */

export const counterpartiesStrings = {
  searchPlaceholder: { en: 'Search by name', sw: 'Tafuta kwa jina' },
  filterAll: { en: 'All', sw: 'Zote' },
  colName: { en: 'Name', sw: 'Jina' },
  colType: { en: 'Type', sw: 'Aina' },
  colCountry: { en: 'Country', sw: 'Nchi' },
  colScorecard: { en: 'Scorecard', sw: 'Alama' },
  colActions: { en: '', sw: '' },
  open: { en: 'Open', sw: 'Fungua' },
  emptyTitle: { en: 'No counterparties yet', sw: 'Hakuna washirika bado' },
  emptyBody: {
    en: 'Use Mr. Mwikila to add the first external party your operation touches.',
    sw: 'Tumia Bw. Mwikila kuongeza mshirika wa kwanza wa nje anayehusika na shughuli zako.',
  },
  tileCounterparties: { en: 'Counterparties', sw: 'Washirika' },
  tileDownstream: { en: 'Downstream', sw: 'Mnyororo wa chini' },
  tileRegulators: { en: 'Regulators', sw: 'Wadhibiti' },
  tileAdjacent: { en: 'Adjacent', sw: 'Wa karibu' },
  drawerEyebrow: { en: 'Counterparty', sw: 'Mshirika' },
  timeline: { en: 'Engagement timeline', sw: 'Ratiba ya ushirikiano' },
  timelineEmpty: { en: 'No engagements logged yet.', sw: 'Hakuna ushirikiano uliorekodiwa bado.' },
  audit: { en: 'audit', sw: 'ukaguzi' },
  loadFailedTitle: { en: 'Could not load counterparties', sw: 'Imeshindwa kupakia washirika' },
  loadFailedBody: {
    en: 'The counterparties feed did not respond. Check your connection and try again.',
    sw: 'Mlisho wa washirika haukujibu. Angalia muunganisho wako kisha jaribu tena.',
  },
  engagementsLoadFailed: {
    en: 'Could not load this engagement timeline. Try again.',
    sw: 'Imeshindwa kupakia ratiba hii ya ushirikiano. Jaribu tena.',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
} as const;

/**
 * Party-type labels (external_parties.party_type) + the 'all' filter
 * sentinel. One canonical Swahili term per concept; mirrors the
 * party-type taxonomy. Single source of truth for both the filter
 * dropdown and the row/drawer type label — no hardcoded literals in the
 * component (zero-mix canon: the SW value must never sit inline in TSX).
 */
export const partyTypeLabels: Record<
  string,
  { readonly en: string; readonly sw: string }
> = {
  all: { en: 'All', sw: 'Zote' },
  licensing_office: { en: 'Licensing office', sw: 'Ofisi ya leseni' },
  survey_firm: { en: 'Survey firm', sw: 'Kampuni ya upimaji' },
  transport_co: { en: 'Transport', sw: 'Usafirishaji' },
  processor: { en: 'Processor', sw: 'Msindikaji' },
  smelter: { en: 'Smelter', sw: 'Kiyeyushaji' },
  refiner: { en: 'Refiner', sw: 'Kisafishaji' },
  assayer: { en: 'Assayer', sw: 'Mpima madini' },
  exporter: { en: 'Exporter', sw: 'Msafirishaji nje' },
  bank: { en: 'Bank', sw: 'Benki' },
  regulator: { en: 'Regulator', sw: 'Mdhibiti' },
  off_taker: { en: 'Off-taker', sw: 'Mnunuzi wa jumla' },
  logistics_co: { en: 'Logistics', sw: 'Usambazaji' },
  csr_community: { en: 'CSR community', sw: 'Jamii ya CSR' },
  env_monitor: { en: 'Env monitor', sw: 'Mfuatiliaji mazingira' },
  gov_liaison: { en: 'Gov liaison', sw: 'Mwakilishi wa serikali' },
  legal_counsel: { en: 'Legal counsel', sw: 'Mshauri wa sheria' },
  insurance: { en: 'Insurance', sw: 'Bima' },
  security_firm: { en: 'Security', sw: 'Usalama' },
};

/**
 * The party-type filter order (drives the <Select> options). The 'all'
 * sentinel leads; the rest mirror the schema taxonomy. Labels resolve via
 * `partyTypeLabels` so no Swahili literal lives in the component.
 */
export const partyTypeFilterOrder: ReadonlyArray<string> = [
  'all',
  'licensing_office',
  'survey_firm',
  'transport_co',
  'processor',
  'smelter',
  'refiner',
  'assayer',
  'exporter',
  'bank',
  'regulator',
  'off_taker',
  'logistics_co',
  'csr_community',
  'env_monitor',
  'gov_liaison',
  'legal_counsel',
  'insurance',
  'security_firm',
];

/**
 * Engagement kind labels (external_party_engagements.kind). One canonical
 * Swahili term per concept; mirrors ENGAGEMENT_KINDS in the schema.
 */
export const engagementKindLabels: Record<
  string,
  { readonly en: string; readonly sw: string }
> = {
  meeting: { en: 'Meeting', sw: 'Mkutano' },
  inspection: { en: 'Inspection', sw: 'Ukaguzi' },
  shipment: { en: 'Shipment', sw: 'Usafirishaji' },
  payment: { en: 'Payment', sw: 'Malipo' },
  application: { en: 'Application', sw: 'Maombi' },
  dispute: { en: 'Dispute', sw: 'Mgogoro' },
  community_event: { en: 'Community event', sw: 'Tukio la jamii' },
  audit: { en: 'Audit', sw: 'Ukaguzi wa hesabu' },
  site_visit: { en: 'Site visit', sw: 'Ziara ya eneo' },
  document_request: { en: 'Document request', sw: 'Ombi la hati' },
  other: { en: 'Other', sw: 'Nyingine' },
};

/**
 * Engagement status labels (external_party_engagements.status). Mirrors
 * ENGAGEMENT_STATUSES in the schema.
 */
export const engagementStatusLabels: Record<
  string,
  { readonly en: string; readonly sw: string }
> = {
  open: { en: 'Open', sw: 'Wazi' },
  in_progress: { en: 'In progress', sw: 'Inaendelea' },
  closed: { en: 'Closed', sw: 'Imefungwa' },
  cancelled: { en: 'Cancelled', sw: 'Imeghairiwa' },
};
