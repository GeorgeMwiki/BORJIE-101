/**
 * Mocks for the commercial-side stubs: sales pipeline, marketplace,
 * group rollup, multi-tenant settings.
 */

export const SALES_MOCK = {
  buyers: [
    { name: 'Geita Gold Refinery', netTzsPerG: 187_400, payDays: 5, rating: 4.7 },
    { name: 'Dar Broker Group', netTzsPerG: 181_900, payDays: 14, rating: 4.1 },
    { name: 'Mwanza Direct Refiner', netTzsPerG: 178_300, payDays: 7, rating: 4.4 },
  ],
  openOffers: 6,
  pipelineTzsM: 412,
  paymentTrace: [
    {
      invoice: 'INV-2026-041',
      buyer: 'Geita Gold Refinery',
      gross: 92_400_000,
      receivedTzs: 91_870_000,
      ageDays: 3,
    },
    {
      invoice: 'INV-2026-038',
      buyer: 'Dar Broker Group',
      gross: 64_100_000,
      receivedTzs: 0,
      ageDays: 12,
    },
  ],
} as const;

export const MARKETPLACE_MOCK = {
  outbound: [
    { listing: 'Doré bars · 18kg', priceUsd: 1_322_000, status: 'open' },
    { listing: 'Coltan concentrate · 2.4t', priceUsd: 188_000, status: 'counter' },
  ],
  inbound: [
    { partner: 'Zanzibar Logistics', service: 'Bullion courier', rating: 4.6 },
    { partner: 'Geita Heavy Plant', service: 'Excavator hire (weekly)', rating: 4.4 },
  ],
} as const;

export const COMPLIANCE_MOCK = {
  citations: [
    { ref: 'Mining Act 2010 §44', label: 'Dormancy clock & forfeiture' },
    { ref: 'BoT FX Circular 14/2025', label: 'TZS-only conversion rule' },
    { ref: 'EMA 2004 §82', label: 'Tailings dam freeboard' },
    { ref: 'TMAA Circular Q2-2026', label: 'LSM quarterly return format' },
  ],
  actions: [
    { id: 'a1', title: 'File Q2 LSM by 31 Jul', dueDays: 67, status: 'on-track' },
    { id: 'a2', title: 'Pay PML 25434 annual rent (overdue)', dueDays: -32, status: 'overdue' },
    { id: 'a3', title: 'Submit NEMC EPP compliance report', dueDays: 19, status: 'at-risk' },
  ],
} as const;

export const SAFETY_MOCK = {
  criticalControls: [
    { control: 'Ground support inspection', site: 'Nyakabale', status: 'green' },
    { control: 'Tailings freeboard >= 1m', site: 'Kakola', status: 'amber' },
    { control: 'PPE issuance complete', site: 'All', status: 'green' },
    { control: 'Underground ventilation', site: 'Nyakabale', status: 'green' },
  ],
  recentIncidents: [
    { date: '2026-05-21', site: 'Mbeya', severity: 'first-aid', note: 'Slip on wet stairs.' },
    { date: '2026-04-30', site: 'Kakola', severity: 'near-miss', note: 'Reverse alarm fault on HL-2.' },
  ],
} as const;

export const COMMUNITY_MOCK = {
  commitments: [
    { project: 'Borehole · Nyarugusu primary school', pledgedTzs: 18_000_000, deliveredTzs: 18_000_000, status: 'delivered' },
    { project: 'Class block · Kakola', pledgedTzs: 38_000_000, deliveredTzs: 14_000_000, status: 'in-progress' },
    { project: 'Road repair · Mbeya Ridge access', pledgedTzs: 12_000_000, deliveredTzs: 0, status: 'pending' },
  ],
  grievances: [
    { id: 'g1', ward: 'Nyarugusu', topic: 'Dust on village road', status: 'open', daysOpen: 14 },
    { id: 'g2', ward: 'Kakola', topic: 'Borehole sediment', status: 'resolved', daysOpen: 0 },
  ],
} as const;

export const GROUP_MOCK = {
  tenants: [
    {
      id: 'tnt_mawebora',
      name: 'Mawe Bora Mining Ltd',
      cashTzsM: 412.6,
      productionGTopMtd: 28_640,
      complianceGreen: 14,
      complianceAmber: 5,
      complianceRed: 2,
    },
    {
      id: 'tnt_kibondo',
      name: 'Kibondo Gemstones Ltd',
      cashTzsM: 188.3,
      productionGTopMtd: 4_310,
      complianceGreen: 9,
      complianceAmber: 3,
      complianceRed: 0,
    },
  ],
} as const;

export const ONBOARDING_MOCK = {
  uploadQueue: [
    { file: 'PML_25434_grant.pdf', status: 'classified', confidence: 0.97, type: 'PML' },
    { file: 'EPP_2025_Nyakabale.pdf', status: 'extracted', confidence: 0.93, type: 'EPP' },
    { file: 'invoice_geita_refinery_apr.pdf', status: 'queued', confidence: null, type: 'invoice' },
  ],
} as const;

export const SETTINGS_MOCK = {
  users: [
    { name: 'Mzee Mwanaidi Komba', role: 'owner', email: 'owner@mawebora.tz' },
    { name: 'Hawa Shabani', role: 'manager', email: 'manager@mawebora.tz' },
    { name: 'Sospeter Mlay', role: 'accountant', email: 'acct@mawebora.tz' },
  ],
  plan: { tier: 'kampuni', seats: 8, renewsAt: '2026-12-01' },
  autonomy: [
    { agent: 'Document', level: 'execute-with-approval' },
    { agent: 'Treasury', level: 'advise' },
    { agent: 'Sales', level: 'propose' },
    { agent: 'Procurement', level: 'execute-with-approval' },
  ],
} as const;
