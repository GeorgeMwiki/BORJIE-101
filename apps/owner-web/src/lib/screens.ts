/**
 * Owner-web screen catalogue — O-W-01 through O-W-22.
 *
 * Single source of truth for every owner-facing surface. Mirrors
 * docs/build/UI_SCREEN_CATALOGUE.md section B verbatim. The sidebar,
 * the route stubs, and the cockpit homepage all read from this list
 * so renaming or regrouping a screen is a one-file change.
 *
 * Swahili `titleSw` values live in the guard-exempt
 * `i18n/strings/tail.ts` table (keyed by screen id); this file keeps
 * the English `title` source-of-truth and references the Swahili.
 */

import { tailStrings as S } from '@/i18n/strings/tail';

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
    titleSw: S.screens['O-W-00'].sw,
    intent:
      'Chat-first home. Persona greeting, suggestion chips, transcript, and a sidebar of orchestrator tool calls.',
    persona: 'Borjie Brain',
    group: 'overview',
  },
  {
    id: 'O-W-01',
    slug: 'cockpit',
    title: 'Cockpit dashboard',
    titleSw: S.screens['O-W-01'].sw,
    intent: '10-card daily cockpit per BOJI_AI_SPEC §13.',
    persona: 'Report Writer + Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-02',
    slug: 'master-brain',
    title: 'Conversational Master Brain',
    titleSw: S.screens['O-W-02'].sw,
    intent: 'Full chat surface with agent-call breadcrumbs and 8 CEO modes.',
    persona: 'Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-03',
    slug: 'lmbm',
    title: 'LMBM graph explorer',
    titleSw: S.screens['O-W-03'].sw,
    intent: 'Clickable graph nodes across the Living Mining Business Map; provenance trace.',
    persona: 'Master Brain',
    group: 'overview',
  },
  {
    id: 'O-W-04',
    slug: 'documents',
    title: 'Document chat (full PDF view)',
    titleSw: S.screens['O-W-04'].sw,
    intent: 'Bounding-box highlights and comparison view across PDFs.',
    persona: 'Document agent',
    group: 'field',
  },
  {
    id: 'O-W-05',
    slug: 'portfolio-map',
    title: 'Portfolio map',
    titleSw: S.screens['O-W-05'].sw,
    intent: 'PostGIS + Mapbox layers: licences, sites, settlements, water, protected areas, roads.',
    persona: 'Licence + Mine Planner',
    group: 'field',
  },
  {
    id: 'O-W-06',
    slug: 'site-cockpit',
    title: 'Site cockpit',
    titleSw: S.screens['O-W-06'].sw,
    intent: 'Shift reconciliation, geology score, unit economics by site.',
    persona: 'Operations + Geology + Cost Engineer',
    group: 'field',
  },
  {
    id: 'O-W-07',
    slug: 'licence',
    title: 'Licence cockpit',
    titleSw: S.screens['O-W-07'].sw,
    intent: 'Renewal pack, dormancy score, payment history per mineral right.',
    persona: 'Licence + Compliance',
    group: 'field',
  },
  {
    id: 'O-W-07a',
    slug: 'licences',
    title: 'Licences index',
    titleSw: S.screens['O-W-07a'].sw,
    intent: 'Every licence under the active tenant; click through to a cockpit.',
    persona: 'Licence + Compliance',
    group: 'field',
  },
  {
    id: 'O-W-06a',
    slug: 'sites',
    title: 'Sites index',
    titleSw: S.screens['O-W-06a'].sw,
    intent: 'Every physical site under the active tenant; click through to a cockpit.',
    persona: 'Operations',
    group: 'field',
  },
  {
    id: 'O-W-08',
    slug: 'people',
    title: 'People & roles',
    titleSw: S.screens['O-W-08'].sw,
    intent: 'Org chart, advances ledger, productivity by phase.',
    persona: 'HR',
    group: 'field',
  },
  {
    id: 'O-W-09',
    slug: 'fleet',
    title: 'Assets & fleet',
    titleSw: S.screens['O-W-09'].sw,
    intent: 'Match-factor visualisation and predictive-maintenance flags.',
    persona: 'Asset + Maintenance',
    group: 'operations',
  },
  {
    id: 'O-W-10',
    slug: 'inventory',
    title: 'Inventory & procurement',
    titleSw: S.screens['O-W-10'].sw,
    intent: 'Reorder timeline; supplier ITC compliance status.',
    persona: 'Procurement',
    group: 'operations',
  },
  {
    id: 'O-W-11',
    slug: 'geology',
    title: 'Geology workbench',
    titleSw: S.screens['O-W-11'].sw,
    intent: '3D site view, vein triangulation, assay QA/QC charts.',
    persona: 'Geology + Drill-hole Logger + Lab',
    group: 'operations',
  },
  {
    id: 'O-W-12',
    slug: 'finance',
    title: 'Cost & finance',
    titleSw: S.screens['O-W-12'].sw,
    intent: 'Full P&L, unit economics, break-even sensitivity.',
    persona: 'Cost Engineer + FX/Treasury',
    group: 'money',
  },
  {
    id: 'O-W-13',
    slug: 'sales',
    title: 'Sales & pipeline',
    titleSw: S.screens['O-W-13'].sw,
    intent: 'Net-price comparison per buyer; payment trace.',
    persona: 'Sales',
    group: 'money',
  },
  {
    id: 'O-W-14',
    slug: 'compliance',
    title: 'Compliance centre',
    titleSw: S.screens['O-W-14'].sw,
    intent: 'Regulator citation library; action checklist.',
    persona: 'Compliance',
    group: 'compliance',
  },
  {
    id: 'O-W-15',
    slug: 'safety',
    title: 'Safety & EHS',
    titleSw: S.screens['O-W-15'].sw,
    intent: 'Critical controls; incident heatmap.',
    persona: 'Safety',
    group: 'compliance',
  },
  {
    id: 'O-W-16',
    slug: 'community',
    title: 'Community & CSR',
    titleSw: S.screens['O-W-16'].sw,
    intent: 'Minutes archive; delivery dashboard; grievance map.',
    persona: 'Community + Village CSR',
    group: 'community',
  },
  {
    id: 'O-W-17',
    slug: 'treasury',
    title: 'FX & treasury',
    titleSw: S.screens['O-W-17'].sw,
    intent: 'Live rates; sell-vs-stockpile simulator; 27-Mar cliff tracker.',
    persona: 'FX/Treasury',
    group: 'money',
  },
  {
    id: 'O-W-18',
    slug: 'reports',
    title: 'Reports & exports',
    titleSw: S.screens['O-W-18'].sw,
    intent: 'Daily, weekly, monthly, investor, bank, board, audit packs.',
    persona: 'Report Writer',
    group: 'settings',
  },
  {
    id: 'O-W-19',
    slug: 'group',
    title: 'Multi-company group view',
    titleSw: S.screens['O-W-19'].sw,
    intent: 'Cross-tenant rollup for kampuni / group plan tenants.',
    persona: 'Master + Cost Engineer',
    group: 'settings',
  },
  {
    id: 'O-W-20',
    slug: 'marketplace',
    title: 'Marketplace & external partners',
    titleSw: S.screens['O-W-20'].sw,
    intent: 'Dual-direction partner discovery and offers.',
    persona: 'External-Stakeholder Window',
    group: 'settings',
  },
  {
    id: 'O-W-21',
    slug: 'onboarding',
    title: 'Onboarding & data import',
    titleSw: S.screens['O-W-21'].sw,
    intent: 'Bulk-upload PML PDFs, ledgers, prior reports.',
    persona: 'Document + Build-mode Master',
    group: 'settings',
  },
  {
    id: 'O-W-22',
    slug: 'settings',
    title: 'Settings — users, roles, plan, billing, autonomy',
    titleSw: S.screens['O-W-22'].sw,
    intent: 'RBAC editor, billing, autonomy policy, plan upgrades.',
    persona: 'Boji internal proxy',
    group: 'settings',
  },
  {
    id: 'O-W-23',
    slug: 'ask',
    title: 'Ask Borjie Brain',
    titleSw: S.screens['O-W-23'].sw,
    intent:
      'Live wire to POST /api/v1/brain/turn — full chat with corpus-cited evidence.',
    persona: 'Borjie Brain',
    group: 'overview',
  },
  {
    id: 'D-W-01',
    slug: 'dashboard',
    title: 'Dashboard',
    titleSw: S.screens['D-W-01'].sw,
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
    titleSw: S.screens['O-W-24'].sw,
    intent:
      'Every counterparty the operation touches (upstream, downstream, adjacent) with a scorecard and full engagement timeline.',
    persona: 'External-Stakeholder Window',
    group: 'operations',
  },
  {
    id: 'O-W-25',
    slug: 'chain-of-custody',
    title: 'Chain of custody',
    titleSw: S.screens['O-W-25'].sw,
    intent:
      'Pit-to-buyer custody trail per ore parcel, hash-chain-audited so the regulator can verify nothing was reordered.',
    persona: 'Compliance + Auditor',
    group: 'operations',
  },
  {
    id: 'O-W-26',
    slug: 'regulatory-calendar',
    title: 'Regulatory calendar',
    titleSw: S.screens['O-W-26'].sw,
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
    titleSw: S.screens['O-W-27'].sw,
    intent:
      'Family-office shell, tree view of every entity, total asset value, recent capital flows, succession status.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-28',
    slug: 'estate/entities',
    title: 'Estate entities',
    titleSw: S.screens['O-W-28'].sw,
    intent:
      'Every business under the family-office shell with kind, ownership percentage, and lifecycle status.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-29',
    slug: 'estate/capital-movements',
    title: 'Capital flows',
    titleSw: S.screens['O-W-29'].sw,
    intent:
      'Chronological intercompany money flows: dividends, intercompany loans, capital injections, JV distributions.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-30',
    slug: 'estate/succession',
    title: 'Succession',
    titleSw: S.screens['O-W-30'].sw,
    intent:
      'Succession plan per group, designated successor, contingency, next review due chip, draft-will affordance.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  {
    id: 'O-W-31',
    slug: 'estate/assets',
    title: 'Asset register',
    titleSw: S.screens['O-W-31'].sw,
    intent:
      'Consolidated asset register filterable by class with current valuation and encumbrances.',
    persona: 'Family-Office Chief of Staff',
    group: 'estate',
  },
  // Wave 9 — thin surfaces over already-mounted gateway routes.
  {
    id: 'O-W-32',
    slug: 'head-briefing',
    title: 'Head briefing',
    titleSw: S.screens['O-W-32'].sw,
    intent:
      'First-login head screen: overnight autonomous activity, pending approvals, escalations, KPI deltas, recommendations, and anomalies as one curated document.',
    persona: 'Master Brain + Report Writer',
    group: 'overview',
  },
  {
    id: 'O-W-33',
    slug: 'agentic',
    title: 'Agentic plans & sandbox',
    titleSw: S.screens['O-W-33'].sw,
    intent:
      'MD-agentic review queue: staged sandbox writes the brain proposed, with a four-eye commit (applies atomically) and reject. Read-first; commit is the high-stakes path.',
    persona: 'Master Brain',
    group: 'overview',
  },
];

export function getScreenBySlug(slug: string): OwnerScreen | undefined {
  return OWNER_SCREENS.find((s) => s.slug === slug);
}

export function getScreensByGroup(group: ScreenGroup): ReadonlyArray<OwnerScreen> {
  return OWNER_SCREENS.filter((s) => s.group === group);
}
