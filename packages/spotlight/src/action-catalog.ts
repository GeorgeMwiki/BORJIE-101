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
  readonly entityBinding?:
    | 'unit'
    | 'site'
    | 'counterparty'
    | 'offtake'
    | 'case'
    | 'invoice';
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
    id: 'nav.sites',
    title: 'Open mining sites',
    description: 'Browse your mining sites',
    keywords: ['sites', 'operations', 'concessions'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/sites',
  },
  {
    id: 'nav.units',
    title: 'Open units',
    description: 'Browse every unit',
    keywords: ['pits', 'blocks', 'shafts'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/units',
  },
  {
    id: 'nav.buyers',
    title: 'Open buyers',
    description: 'Browse buyers and counterparties',
    keywords: ['offtakers', 'counterparties', 'operators', 'wanunuzi'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/buyers',
  },
  {
    id: 'nav.outstanding_royalties',
    title: 'Show outstanding royalties',
    description: 'View outstanding royalty payments',
    keywords: ['overdue', 'debt', 'collections', 'royalty due'],
    kind: 'navigation',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/outstanding-royalties',
  },
  {
    id: 'nav.maintenance',
    title: 'Open maintenance',
    description: 'Work orders and equipment repair cases',
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
    id: 'mutate.offtake.draft',
    title: 'Draft an offtake agreement',
    description: 'Generate a new offtake / supply agreement',
    keywords: ['new offtake', 'supply agreement', 'contract'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/offtakes/new',
  },
  {
    id: 'mutate.letter.generate',
    title: 'Generate a letter',
    description: 'Draft royalty reminder, notice, or custom letter',
    keywords: ['notice', 'reminder', 'letter', 'barua'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/letters/new',
  },
  {
    id: 'mutate.invoice.create',
    title: 'Create invoice',
    description: 'Issue a new royalty or cooperative-levy invoice',
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
    description: 'Begin a mobilisation or closeout inspection',
    keywords: ['inspect', 'walkthrough', 'condition'],
    kind: 'mutation',
    requires: ['MANAGER', 'STATION_MASTER'],
    route: '/inspections/new',
  },
  {
    id: 'mutate.waitlist.add',
    title: 'Add to waitlist',
    description: 'Add a prospective buyer to a unit waitlist',
    keywords: ['waitlist', 'queue', 'interest list'],
    kind: 'mutation',
    requires: ['OWNER', 'MANAGER'],
    route: '/waitlist/new',
  },

  // Queries
  {
    id: 'query.royalty_roll',
    title: 'Show royalty roll',
    description: 'Current royalty roll with outstanding royalties',
    keywords: ['collections', 'royalty roll', 'report'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER', 'ADMIN'],
    route: '/reports/royalty-roll',
  },
  {
    id: 'query.counterparty_health',
    title: 'Counterparty 5P health check',
    description:
      'Score a counterparty on payment, production, purpose, person, protection',
    keywords: ['5p', 'counterparty risk', 'health score'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER'],
    entityBinding: 'counterparty',
  },
  {
    id: 'query.production_forecast',
    title: 'Production forecast',
    description: 'Project available-capacity for the next 12 months',
    keywords: ['production', 'available capacity', 'forecast'],
    kind: 'query',
    requires: ['OWNER', 'MANAGER'],
    route: '/reports/production',
  },

  // Persona handoffs
  {
    id: 'persona.offtake.ask',
    title: 'Ask the offtake persona',
    description: 'Get advice on offtake drafting, renewal, or negotiation',
    keywords: ['offtake', 'offtake advice', 'renewal'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'offtake',
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
    description: 'Reconciliation, outstanding-royalty strategy, cashflow',
    keywords: ['finance', 'money', 'reconciliation'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'finance',
  },
  {
    id: 'persona.compliance.ask',
    title: 'Ask the compliance persona',
    description: 'TRA, Mining Commission, Mining Act / royalty / licence questions',
    keywords: ['compliance', 'legal', 'tra', 'royalty', 'licence'],
    kind: 'persona_handoff',
    requires: [],
    persona: 'compliance',
  },
];

export function findActionById(id: string): CatalogAction | undefined {
  return ACTION_CATALOG.find((a) => a.id === id);
}
