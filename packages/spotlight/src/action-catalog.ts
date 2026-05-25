/**
 * Action Catalog — every discoverable action across BORJIE.
 *
 * Each entry has:
 *  - id:        unique slug used in routing and audit logs
 *  - title:     human label shown in the palette
 *  - keywords:  extra search terms for fuzzy matching
 *  - kind:      navigation | mutation | query | persona-handoff
 *  - requires:  RBAC roles required to execute; empty = any authed user
 *  - route:     Next.js route to navigate to (optional — mutation-only actions omit this)
 *  - persona:   persona id to invoke for persona-handoff actions
 */

import { z } from 'zod';

export const ActionKindSchema = z.enum([
  'navigation',
  'mutation',
  'query',
  'persona_handoff',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export interface CatalogAction {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly kind: ActionKind;
  readonly requires: readonly string[];
  readonly route?: string;
  readonly persona?: string;
  readonly entityBinding?: 'unit' | 'property' | 'tenant' | 'lease' | 'case' | 'invoice';
}

export const ACTION_CATALOG: readonly CatalogAction[] = [
  // Navigation
  {
    id: 'nav.dashboard',
    title: 'Go to dashboard',
    description: 'Open your home dashboard',
    keywords: ['home', 'overview', 'summary'],
    kind: 'navigation',
    requires: [],
    route: '/dashboard',
  },
  {
    id: 'nav.properties',
    title: 'Open properties',
    description: 'Browse your properties',
    keywords: ['buildings', 'estates'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/properties',
  },
  {
    id: 'nav.units',
    title: 'Open units',
    description: 'Browse every unit',
    keywords: ['apartments', 'flats', 'doors'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/units',
  },
  {
    id: 'nav.tenants',
    title: 'Open tenants',
    description: 'Browse tenants',
    keywords: ['residents', 'customers', 'wapangaji'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/customers',
  },
  {
    id: 'nav.arrears',
    title: 'Show arrears',
    description: 'View outstanding rent',
    keywords: ['overdue', 'debt', 'collections', 'rent due'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/arrears',
  },
  {
    id: 'nav.maintenance',
    title: 'Open maintenance',
    description: 'Work orders and repair cases',
    keywords: ['repairs', 'work orders', 'kurekebisha'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN', 'TENANT'],
    route: '/maintenance',
  },

  // Mutations
  {
    id: 'mutate.case.create',
    title: 'Create maintenance case',
    description: 'Open a new repair or complaint case',
    keywords: ['new case', 'complaint', 'repair', 'log issue'],
    kind: 'mutation',
    requires: [],
    route: '/maintenance/new',
  },
  {
    id: 'mutate.lease.draft',
    title: 'Draft a lease',
    description: 'Generate a new lease agreement',
    keywords: ['new lease', 'contract', 'tenancy'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/leases/new',
  },
  {
    id: 'mutate.letter.generate',
    title: 'Generate a letter',
    description: 'Draft rent reminder, notice, or custom letter',
    keywords: ['notice', 'reminder', 'letter', 'barua'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/letters/new',
  },
  {
    id: 'mutate.invoice.create',
    title: 'Create invoice',
    description: 'Issue a new rent or service-charge invoice',
    keywords: ['bill', 'invoice', 'ankara'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/invoices/new',
  },
  {
    id: 'mutate.payment.record',
    title: 'Record a payment',
    description: 'Log an M-Pesa, cash, or bank payment',
    keywords: ['payment', 'receipt', 'mpesa', 'malipo'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/payments/new',
  },
  {
    id: 'mutate.inspection.start',
    title: 'Start inspection',
    description: 'Begin a move-in or move-out inspection',
    keywords: ['inspect', 'walkthrough', 'condition'],
    kind: 'mutation',
    requires: ['MANAGER', 'STATION_MASTER'],
    route: '/inspections/new',
  },
  {
    id: 'mutate.waitlist.add',
    title: 'Add to waitlist',
    description: 'Add a prospect to a unit waitlist',
    keywords: ['waitlist', 'queue', 'interest list'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/waitlist/new',
  },

  // Queries
  {
    id: 'query.rent_roll',
    title: 'Show rent roll',
    description: 'Current rent roll with arrears',
    keywords: ['collections', 'rent roll', 'report'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/reports/rent-roll',
  },
  {
    id: 'query.tenant_health',
    title: 'Tenant 5P health check',
    description: 'Score a tenancy on payment, property, purpose, person, protection',
    keywords: ['5p', 'tenant risk', 'health score'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER'],
    entityBinding: 'tenant',
  },
  {
    id: 'query.occupancy_forecast',
    title: 'Occupancy forecast',
    description: 'Project vacancy rates for the next 12 months',
    keywords: ['occupancy', 'vacancy', 'forecast'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER'],
    route: '/reports/occupancy',
  },

  // Persona handoffs
  {
    id: 'persona.leasing.ask',
    title: 'Ask the leasing persona',
    description: 'Get advice on lease drafting, renewal, or negotiation',
    keywords: ['leasing', 'lease advice', 'renewal'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'leasing',
  },
  {
    id: 'persona.maintenance.ask',
    title: 'Ask the maintenance persona',
    description: 'Triage a repair or plan preventative work',
    keywords: ['maintenance advice', 'repair plan'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'maintenance',
  },
  {
    id: 'persona.finance.ask',
    title: 'Ask the finance persona',
    description: 'Reconciliation, arrears strategy, cashflow',
    keywords: ['finance', 'money', 'reconciliation'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'finance',
  },
  {
    id: 'persona.compliance.ask',
    title: 'Ask the compliance persona',
    description: 'KRA, TRA, URA, landlord-tenant act questions',
    keywords: ['compliance', 'legal', 'kra', 'tra'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'compliance',
  },
];

export function findActionById(id: string): CatalogAction | undefined {
  return ACTION_CATALOG.find((a) => a.id === id);
}
