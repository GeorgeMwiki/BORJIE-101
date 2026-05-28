/**
 * Finance — 12 sub-areas covering income statement, balance sheet,
 * cash flow and treasury linkages.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 2.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'profit_and_loss',
    label: { en: 'Profit and loss by site', sw: 'Faida na hasara kwa tovuti' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'No P&L visibility makes pricing, hedging and capex impossible to time.',
      sw: 'Bila kuona P&L, bei, ulinzi na uwekezaji haviwezi kupangwa kwa wakati.',
    },
    dataResolverKey: 'finance.profit_and_loss',
  },
  {
    id: 'cash_flow',
    label: { en: 'Cash flow (operating, investing, financing)', sw: 'Mtiririko wa fedha (uendeshaji, uwekezaji, fedha)' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Running out of cash mid-month forces emergency financing at distressed rates.',
      sw: 'Kukosa fedha katikati ya mwezi kunalazimisha mikopo ya dharura kwa viwango vya juu.',
    },
    dataResolverKey: 'finance.cash_flow',
  },
  {
    id: 'working_capital',
    label: { en: 'Working capital (receivables, payables, inventory)', sw: 'Mtaji wa uendeshaji (madeni, malipo, hifadhi)' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Working capital tied up in slow receivables starves growth capex.',
      sw: 'Mtaji uliotumika katika madeni yanayochelewa unanyima ukuaji.',
    },
    dataResolverKey: 'finance.working_capital',
  },
  {
    id: 'capex',
    label: { en: 'Capex (equipment, drilling, plant, exploration)', sw: 'Capex (vifaa, uchimbaji, kiwanda, utafiti)' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Deferred replacement capex eventually shows up as unplanned downtime.',
      sw: 'Capex ya kuahirishwa hatimaye inaonekana kama kusimama kusiko pangwa.',
    },
    dataResolverKey: 'finance.capex',
  },
  {
    id: 'opex',
    label: { en: 'Opex (fuel, payroll, security, transport, processing)', sw: 'Opex (mafuta, mishahara, ulinzi, usafiri)' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Unchecked opex creep erodes EBITDA two basis points at a time.',
      sw: 'Opex isiyodhibitiwa inapunguza EBITDA kidogo kidogo.',
    },
    dataResolverKey: 'finance.opex',
  },
  {
    id: 'tax_provisioning',
    label: { en: 'Tax provisioning (royalty, CIT, VAT, WHT)', sw: 'Akiba ya kodi (mrabaha, CIT, VAT, WHT)' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Under-provisioned tax creates a year-end cash shock and TRA audit risk.',
      sw: 'Akiba ndogo ya kodi inaleta mshtuko wa fedha na hatari ya ukaguzi wa TRA.',
    },
    dataResolverKey: 'finance.tax_provisioning',
  },
  {
    id: 'treasury_position',
    label: { en: 'Treasury position (TZS, USD, KES)', sw: 'Hali ya hazina (TZS, USD, KES)' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Idle TZS in a single account is a security risk and a yield loss.',
      sw: 'TZS isiyofanya kazi katika akaunti moja ni hatari na hasara ya faida.',
    },
    dataResolverKey: 'finance.treasury_position',
  },
  {
    id: 'fx_exposure',
    label: { en: 'FX exposure vs LBMA', sw: 'Uwazi wa FX dhidi ya LBMA' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Unhedged USD/TZS swings of 2.4% per day translate to TZS millions of unforced loss.',
      sw: 'Mabadiliko ya USD/TZS yasiyolindwa ya 2.4% kwa siku yanaleta hasara ya TZS milioni.',
    },
    dataResolverKey: 'finance.fx_exposure',
  },
  {
    id: 'receivables_aging',
    label: { en: 'Receivables aging by buyer', sw: 'Umri wa madeni kwa mnunuzi' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Buyer slow-pay becomes buyer default if not chased within 30 days.',
      sw: 'Ucheleweshaji wa mnunuzi unakuwa kushindwa kulipa bila kufuatilia ndani ya siku 30.',
    },
    dataResolverKey: 'finance.receivables_aging',
  },
  {
    id: 'payables_aging',
    label: { en: 'Payables aging by supplier', sw: 'Umri wa malipo kwa mtoa huduma' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Late supplier payments freeze fuel and explosives deliveries.',
      sw: 'Malipo ya kuchelewa yanazuia mafuta na milipuko.',
    },
    dataResolverKey: 'finance.payables_aging',
  },
  {
    id: 'inventory_stockpile',
    label: { en: 'Inventory and ore stockpile mark-to-LBMA', sw: 'Hifadhi na mafusho dhidi ya LBMA' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Mis-valued stockpile distorts EBITDA and tax provisioning.',
      sw: 'Mafusho yenye thamani potofu yanapotosha EBITDA na akiba ya kodi.',
    },
    dataResolverKey: 'finance.inventory_stockpile',
  },
  {
    id: 'debt_covenants',
    label: { en: 'Debt service and covenants', sw: 'Huduma ya deni na masharti' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A covenant breach can trigger an acceleration clause and call in the facility.',
      sw: 'Uvunjaji wa sharti unaweza kuamsha sharti la kuongeza kasi na kuita mkopo.',
    },
    dataResolverKey: 'finance.debt_covenants',
  },
]);

export const FINANCE_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'finance',
  label: { en: 'Finance', sw: 'Fedha' },
  headline: {
    en: 'Full P&L, balance-sheet and cash picture: 12 sub-areas.',
    sw: 'Picha kamili ya P&L, mizania na fedha: maeneo 12.',
  },
  subAreas: SUB_AREAS,
});
