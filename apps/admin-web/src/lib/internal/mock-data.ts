/**
 * Mock data for Borjie Console stubs.
 *
 * Tanzanian mining context only — Swahili / Kiswahili tenant names,
 * gold / copper / coltan / tanzanite commodities, common TZ regulators
 * (TMAA, NEMC, BoT, MoM). All numbers are placeholders; nothing here
 * touches a real database. Replace as services come online.
 */

export interface MockTenant {
  readonly id: string;
  readonly name: string;
  readonly commodity: string;
  readonly region: string;
  readonly plan: 'Starter' | 'Growth' | 'Enterprise';
  readonly status: 'Active' | 'Trial' | 'Past due' | 'Suspended';
  readonly mrrUsd: number;
}

export const MOCK_TENANTS: ReadonlyArray<MockTenant> = [
  {
    id: 'tnt_kiwira',
    name: 'Kiwira Coltan Cooperative',
    commodity: 'Coltan',
    region: 'Mbeya',
    plan: 'Growth',
    status: 'Active',
    mrrUsd: 1480,
  },
  {
    id: 'tnt_geita_dhahabu',
    name: 'Geita Dhahabu Mines',
    commodity: 'Gold',
    region: 'Geita',
    plan: 'Enterprise',
    status: 'Active',
    mrrUsd: 4920,
  },
  {
    id: 'tnt_kahama_shaba',
    name: 'Kahama Shaba Holdings',
    commodity: 'Copper',
    region: 'Shinyanga',
    plan: 'Enterprise',
    status: 'Active',
    mrrUsd: 6100,
  },
  {
    id: 'tnt_mererani',
    name: 'Mererani Tanzanite Cluster',
    commodity: 'Tanzanite',
    region: 'Manyara',
    plan: 'Growth',
    status: 'Trial',
    mrrUsd: 0,
  },
  {
    id: 'tnt_kabanga',
    name: 'Kabanga Nickel Society',
    commodity: 'Nickel',
    region: 'Kagera',
    plan: 'Starter',
    status: 'Past due',
    mrrUsd: 320,
  },
];

export interface MockJunior {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly model: string;
  readonly status: 'Active' | 'Canary' | 'Suspended';
}

export const MOCK_JUNIORS: ReadonlyArray<MockJunior> = [
  { id: 'jr_master', name: 'Master Brain', role: 'Orchestrator', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_geology', name: 'Geology', role: 'Mineralogy & assays', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_compliance', name: 'Compliance', role: 'TZ regulatory', model: 'claude-opus-4-7', status: 'Active' },
  { id: 'jr_cost', name: 'Cost Engineer', role: 'Mine economics', model: 'claude-sonnet-4-5', status: 'Active' },
  { id: 'jr_sales', name: 'Sales', role: 'Buyer match + LoI', model: 'claude-haiku-4-5', status: 'Canary' },
  { id: 'jr_fx', name: 'FX / Treasury', role: 'TZS / USD hedging', model: 'claude-haiku-4-5', status: 'Active' },
  { id: 'jr_hr', name: 'HR', role: 'Attendance & payroll', model: 'claude-haiku-4-5', status: 'Active' },
  { id: 'jr_report', name: 'Report Writer', role: 'Letters & filings', model: 'claude-sonnet-4-5', status: 'Suspended' },
];

export interface MockCitation {
  readonly id: string;
  readonly statute: string;
  readonly section: string;
  readonly publishedOn: string;
  readonly source: 'Gazette' | 'NEMC' | 'BoT' | 'TMAA';
}

export const MOCK_CITATIONS: ReadonlyArray<MockCitation> = [
  { id: 'cit_mma_2010', statute: 'Mining Act, 2010', section: 's.42 — Royalty', publishedOn: '2010-04-21', source: 'Gazette' },
  { id: 'cit_eia_2018', statute: 'Environmental Mgmt (EIA) Regs', section: 'reg.7', publishedOn: '2018-11-09', source: 'NEMC' },
  { id: 'cit_fx_2024', statute: 'Foreign Exchange Circular 12', section: 'art.3', publishedOn: '2024-08-02', source: 'BoT' },
  { id: 'cit_pmtl_2023', statute: 'Primary Mining Licence Notice', section: 'PML-2023-417', publishedOn: '2023-06-14', source: 'TMAA' },
  { id: 'cit_local_2022', statute: 'Local Content Regs', section: 'reg.18', publishedOn: '2022-02-28', source: 'Gazette' },
];

export interface MockAuditEvent {
  readonly id: string;
  readonly at: string;
  readonly tenant: string;
  readonly actor: string;
  readonly action: string;
}

export const MOCK_AUDIT_EVENTS: ReadonlyArray<MockAuditEvent> = [
  { id: 'evt_001', at: '2026-05-25T09:14:22Z', tenant: 'Geita Dhahabu Mines', actor: 'op_grace', action: 'prompt.promote: geology-v17 → production' },
  { id: 'evt_002', at: '2026-05-25T08:51:03Z', tenant: 'Kahama Shaba Holdings', actor: 'op_mwita', action: 'tenant.impersonate.start' },
  { id: 'evt_003', at: '2026-05-25T08:30:00Z', tenant: 'Mererani Tanzanite Cluster', actor: 'system', action: 'compliance.flag: missing NEMC renewal' },
  { id: 'evt_004', at: '2026-05-25T07:58:41Z', tenant: 'Kiwira Coltan Cooperative', actor: 'op_grace', action: 'flag.toggle: sales.draftLoI ON' },
  { id: 'evt_005', at: '2026-05-25T07:12:09Z', tenant: 'Kabanga Nickel Society', actor: 'system', action: 'killswitch.degraded: fx-junior' },
];

export interface MockPromptRow {
  readonly id: string;
  readonly junior: string;
  readonly version: string;
  readonly gepaScore: number;
  readonly status: 'Production' | 'Canary' | 'Archived';
}

export const MOCK_PROMPTS: ReadonlyArray<MockPromptRow> = [
  { id: 'p_geo_17', junior: 'Geology', version: 'v17', gepaScore: 0.842, status: 'Production' },
  { id: 'p_geo_18', junior: 'Geology', version: 'v18-rc', gepaScore: 0.871, status: 'Canary' },
  { id: 'p_comp_09', junior: 'Compliance', version: 'v9', gepaScore: 0.793, status: 'Production' },
  { id: 'p_sales_04', junior: 'Sales', version: 'v4', gepaScore: 0.688, status: 'Production' },
  { id: 'p_fx_11', junior: 'FX / Treasury', version: 'v11', gepaScore: 0.812, status: 'Production' },
];

export interface MockTicket {
  readonly id: string;
  readonly tenant: string;
  readonly subject: string;
  readonly slaHoursLeft: number;
  readonly csat: number | null;
}

export const MOCK_TICKETS: ReadonlyArray<MockTicket> = [
  { id: 'tk_8821', tenant: 'Geita Dhahabu Mines', subject: 'Driver letter signing fails offline', slaHoursLeft: 6, csat: null },
  { id: 'tk_8819', tenant: 'Mererani Tanzanite Cluster', subject: 'Onboarding stuck on NEMC upload', slaHoursLeft: 22, csat: null },
  { id: 'tk_8804', tenant: 'Kahama Shaba Holdings', subject: 'Cost Engineer numbers off vs SAP', slaHoursLeft: -4, csat: 3 },
  { id: 'tk_8772', tenant: 'Kiwira Coltan Cooperative', subject: 'How do we add a third operator?', slaHoursLeft: 14, csat: 5 },
];

export interface MockFlag {
  readonly key: string;
  readonly description: string;
  readonly rolloutPct: number;
}

export const MOCK_FLAGS: ReadonlyArray<MockFlag> = [
  { key: 'sales.draftLoI', description: 'Auto-draft buyer Letter of Intent', rolloutPct: 35 },
  { key: 'geology.satelliteOverlay', description: 'Sentinel-2 overlay on tenement map', rolloutPct: 100 },
  { key: 'fx.hedgeSuggest', description: 'TZS hedging suggestions', rolloutPct: 10 },
  { key: 'compliance.autoRenewWarn', description: 'Auto-warn 30d before NEMC expiry', rolloutPct: 80 },
];
