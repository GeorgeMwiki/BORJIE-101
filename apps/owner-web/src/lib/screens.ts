/**
 * Owner-web screen catalogue — O-W-01 through O-W-22.
 *
 * Single source of truth for every owner-facing surface. Mirrors
 * docs/build/UI_SCREEN_CATALOGUE.md section B verbatim. The sidebar,
 * the route stubs, and the cockpit homepage all read from this list
 * so renaming or regrouping a screen is a one-file change.
 */

export type ScreenGroup =
  | 'overview'
  | 'field'
  | 'operations'
  | 'money'
  | 'compliance'
  | 'community'
  | 'estate'
  | 'settings';

export interface OwnerScreen {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly titleSw: string;
  readonly intent: string;
  readonly persona: string;
  readonly group: ScreenGroup;
}

export const OWNER_SCREENS: ReadonlyArray<OwnerScreen> = [
  {
    id: 'O-W-00',
    slug: 'home',
    title: 'Home — chat with Borjie',
    titleSw: 'Nyumbani — ongea na Borjie',
    intent:
      'Chat-first home. Persona greeting, suggestion chips, transcript, and a sidebar of orchestrator tool calls.',
    persona: 'Borjie Brain',
    group: 'overview',
  },
  {
    id: 'O-W-01',
    slug: 'cockpit',
    title: 'Cockpit dashboard',
    titleSw: 'Dashibodi ya Mkurugenzi',
    intent: '10-card daily cockpit per BOJI_AI_SPEC §13.',
    persona: 'Report Writer + Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-02',
    slug: 'master-brain',
    title: 'Conversational Master Brain',
    titleSw: 'Akili Kuu',
    intent: 'Full chat surface with agent-call breadcrumbs and 8 CEO modes.',
    persona: 'Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-03',
    slug: 'lmbm',
    title: 'LMBM graph explorer',
    titleSw: 'Ramani ya Biashara',
    intent: 'Clickable graph nodes across the Living Mining Business Map; provenance trace.',
    persona: 'Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-04',
    slug: 'documents',
    title: 'Document chat (full PDF view)',
    titleSw: 'Hati na Mazungumzo',
    intent: 'Bounding-box highlights and comparison view across PDFs.',
    persona: 'Document agent',
    group: 'field',
  },
  {
    id: 'O-W-05',
    slug: 'portfolio-map',
    title: 'Portfolio map',
    titleSw: 'Ramani ya Kampuni',
    intent: 'PostGIS + Mapbox layers: licences, sites, settlements, water, protected areas, roads.',
    persona: 'Licence + Mine Planner',
    group: 'field',
  },
  {
    id: 'O-W-06',
    slug: 'site-cockpit',
    title: 'Site cockpit',
    titleSw: 'Kituo cha Mgodi',
    intent: 'Shift reconciliation, geology score, unit economics by site.',
    persona: 'Operations + Geology + Cost Engineer',
    group: 'field',
  },
  {
    id: 'O-W-07',
    slug: 'licence',
    title: 'Licence cockpit',
    titleSw: 'Leseni',
    intent: 'Renewal pack, dormancy score, payment history per mineral right.',
    persona: 'Licence + Compliance',
    group: 'field',
  },
  {
    id: 'O-W-07a',
    slug: 'licences',
    title: 'Licences index',
    titleSw: 'Leseni zote',
    intent: 'Every licence under the active tenant; click through to a cockpit.',
    persona: 'Licence + Compliance',
    group: 'field',
  },
  {
    id: 'O-W-06a',
    slug: 'sites',
    title: 'Sites index',
    titleSw: 'Migodi yote',
    intent: 'Every physical site under the active tenant; click through to a cockpit.',
    persona: 'Operations',
    group: 'field',
  },
  {
    id: 'O-W-08',
    slug: 'people',
    title: 'People & roles',
    titleSw: 'Watu na Majukumu',
    intent: 'Org chart, advances ledger, productivity by phase.',
    persona: 'HR',
    group: 'field',
  },
  {
    id: 'O-W-09',
    slug: 'fleet',
    title: 'Assets & fleet',
    titleSw: 'Mali na Magari',
    intent: 'Match-factor visualisation and predictive-maintenance flags.',
    persona: 'Asset + Maintenance',
    group: 'operations',
  },
  {
    id: 'O-W-10',
    slug: 'inventory',
    title: 'Inventory & procurement',
    titleSw: 'Bidhaa na Manunuzi',
    intent: 'Reorder timeline; supplier ITC compliance status.',
    persona: 'Procurement',
    group: 'operations',
  },
  {
    id: 'O-W-11',
    slug: 'geology',
    title: 'Geology workbench',
    titleSw: 'Jiolojia',
    intent: '3D site view, vein triangulation, assay QA/QC charts.',
    persona: 'Geology + Drill-hole Logger + Lab',
    group: 'operations',
  },
  {
    id: 'O-W-12',
    slug: 'finance',
    title: 'Cost & finance',
    titleSw: 'Gharama na Fedha',
    intent: 'Full P&L, unit economics, break-even sensitivity.',
    persona: 'Cost Engineer + FX/Treasury',
    group: 'money',
  },
  {
    id: 'O-W-13',
    slug: 'sales',
    title: 'Sales & pipeline',
    titleSw: 'Mauzo',
    intent: 'Net-price comparison per buyer; payment trace.',
    persona: 'Sales',
    group: 'money',
  },
  {
    id: 'O-W-14',
    slug: 'compliance',
    title: 'Compliance centre',
    titleSw: 'Uzingatiaji',
    intent: 'Regulator citation library; action checklist.',
    persona: 'Compliance',
    group: 'compliance',
  },
  {
    id: 'O-W-15',
    slug: 'safety',
    title: 'Safety & EHS',
    titleSw: 'Usalama na Afya',
    intent: 'Critical controls; incident heatmap.',
    persona: 'Safety',
    group: 'compliance',
  },
  {
    id: 'O-W-16',
    slug: 'community',
    title: 'Community & CSR',
    titleSw: 'Jamii na CSR',
    intent: 'Minutes archive; delivery dashboard; grievance map.',
    persona: 'Community + Village CSR',
    group: 'community',
  },
  {
    id: 'O-W-17',
    slug: 'treasury',
    title: 'FX & treasury',
    titleSw: 'Hazina na FX',
    intent: 'Live rates; sell-vs-stockpile simulator; 27-Mar cliff tracker.',
    persona: 'FX/Treasury',
    group: 'money',
  },
  {
    id: 'O-W-18',
    slug: 'reports',
    title: 'Reports & exports',
    titleSw: 'Ripoti',
    intent: 'Daily, weekly, monthly, investor, bank, board, audit packs.',
    persona: 'Report Writer',
    group: 'settings',
  },
  {
    id: 'O-W-19',
    slug: 'group',
    title: 'Multi-company group view',
    titleSw: 'Kampuni Nyingi',
    intent: 'Cross-tenant rollup for kampuni / group plan tenants.',
    persona: 'Master + Cost Engineer',
    group: 'settings',
  },
  {
    id: 'O-W-20',
    slug: 'marketplace',
    title: 'Marketplace & external partners',
    titleSw: 'Soko na Washirika',
    intent: 'Dual-direction partner discovery and offers.',
    persona: 'External-Stakeholder Window',
    group: 'settings',
  },
  {
    id: 'O-W-21',
    slug: 'onboarding',
    title: 'Onboarding & data import',
    titleSw: 'Kuanza na Kuingiza Data',
    intent: 'Bulk-upload PML PDFs, ledgers, prior reports.',
    persona: 'Document + Build-mode Master',
    group: 'settings',
  },
  {
    id: 'O-W-22',
    slug: 'settings',
    title: 'Settings — users, roles, plan, billing, autonomy',
    titleSw: 'Mipangilio',
    intent: 'RBAC editor, billing, autonomy policy, plan upgrades.',
    persona: 'Boji internal proxy',
    group: 'settings',
  },
  {
    id: 'O-W-23',
    slug: 'ask',
    title: 'Ask Borjie Brain',
    titleSw: 'Uliza Borjie',
    intent:
      'Live wire to POST /api/v1/brain/turn — full chat with corpus-cited evidence.',
    persona: 'Borjie Brain',
    group: 'overview',
  },
  {
    id: 'D-W-01',
    slug: 'dashboard',
    title: 'Dashboard',
    titleSw: 'Dashibodi',
    intent:
      'Structured-status secondary view. Seven slots from /api/v1/owner/brief: AI brief, alert queue, KPI strip, production, cash + USD cliff, compliance, safety.',
    persona: 'Report Writer + Master Brain',
    group: 'overview',
  },
  // Wave OPS-WIDE — full end-to-end mining operations scope.
  {
    id: 'O-W-24',
    slug: 'counterparties',
    title: 'Counterparties',
    titleSw: 'Washirika wa Nje',
    intent:
      'Every counterparty the operation touches (upstream, downstream, adjacent) with a scorecard and full engagement timeline.',
    persona: 'External-Stakeholder Window',
    group: 'operations',
  },
  {
    id: 'O-W-25',
    slug: 'chain-of-custody',
    title: 'Chain of custody',
    titleSw: 'Mlolongo wa Mali',
    intent:
      'Pit-to-buyer custody trail per ore parcel, hash-chain-audited so the regulator can verify nothing was reordered.',
    persona: 'Compliance + Auditor',
    group: 'operations',
  },
  {
    id: 'O-W-26',
    slug: 'regulatory-calendar',
    title: 'Regulatory calendar',
    titleSw: 'Kalenda ya Wakaguzi',
    intent:
      'Every Mining Commission, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC filing on one calendar, color-coded by status.',
    persona: 'Compliance',
    group: 'compliance',
  },
  // Wave ESTATE-OS — family-office shell above on-mine ops.
  {
    id: 'O-W-27',
    slug: 'estate',
    title: 'Estate overview',
    titleSw: 'Muonekano wa Miliki',
    intent:
      'Family-office shell, tree view of every entity, total asset value, recent capital flows, succession status.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-28',
    slug: 'estate/entities',
    title: 'Estate entities',
    titleSw: 'Kampuni za Miliki',
    intent:
      'Every business under the family-office shell with kind, ownership percentage, and lifecycle status.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-29',
    slug: 'estate/capital-movements',
    title: 'Capital flows',
    titleSw: 'Mitiririko ya Mtaji',
    intent:
      'Chronological intercompany money flows: dividends, intercompany loans, capital injections, JV distributions.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-30',
    slug: 'estate/succession',
    title: 'Succession',
    titleSw: 'Urithi',
    intent:
      'Succession plan per group, designated successor, contingency, next review due chip, draft-will affordance.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-31',
    slug: 'estate/assets',
    title: 'Asset register',
    titleSw: 'Daftari la Mali',
    intent:
      'Consolidated asset register filterable by class with current valuation and encumbrances.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
];

export function getScreenBySlug(slug: string): OwnerScreen | undefined {
  return OWNER_SCREENS.find((s) => s.slug === slug);
}

export function getScreensByGroup(group: ScreenGroup): ReadonlyArray<OwnerScreen> {
  return OWNER_SCREENS.filter((s) => s.group === group);
}
