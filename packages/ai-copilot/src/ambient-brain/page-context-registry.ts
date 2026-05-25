/**
 * Page context registry for ambient presence.
 *
 * Tells Mr. Mwikila which actions, questions, and hints are appropriate for
 * each screen. Keyed by canonical route path. Registry is append-only —
 * new pages add entries; existing entries stay backward-compatible.
 */

import type { PageContext } from './types.js';

type PartialContext = Omit<PageContext, 'pageId' | 'pageName'> & {
  readonly pageId: string;
  readonly pageName: string;
};

const REGISTRY: Readonly<Record<string, PartialContext>> = {
  '/owner/dashboard': {
    pageId: 'owner_dashboard',
    pageName: 'Owner Dashboard',
    pageType: 'dashboard',
    relevantFields: [],
    availableActions: [
      {
        id: 'open_arrears',
        label: 'Review arrears',
        description: 'Jump to the arrears cases needing action',
        actionType: 'navigate',
        enabled: true,
      },
      {
        id: 'review_maintenance',
        label: 'Review maintenance queue',
        description: 'See maintenance tickets awaiting triage',
        actionType: 'navigate',
        enabled: true,
      },
    ],
    commonQuestions: [
      {
        id: 'portfolio_health',
        question: 'How is my portfolio performing?',
        shortAnswer:
          'I can summarise occupancy, collections, and maintenance in one minute.',
      },
    ],
  },
  '/manager/properties': {
    pageId: 'property_list',
    pageName: 'Properties',
    pageType: 'property_list',
    relevantFields: ['district', 'occupancy_status'],
    availableActions: [
      {
        id: 'filter_vacant',
        label: 'Filter vacant units',
        description: 'Show only vacant units',
        actionType: 'navigate',
        enabled: true,
      },
    ],
    commonQuestions: [
      {
        id: 'vacancy_hotspots',
        question: 'Where are my vacancy hotspots?',
        shortAnswer: 'Let me group by district and surface the top three.',
      },
    ],
  },
  '/manager/leases/new': {
    pageId: 'lease_form',
    pageName: 'New Lease',
    pageType: 'lease_form',
    relevantFields: [
      'tenant_name',
      'monthly_rent',
      'security_deposit',
      'lease_start',
      'lease_end',
    ],
    availableActions: [
      {
        id: 'autofill_from_tenant',
        label: 'Auto-fill from tenant profile',
        description: 'Pull tenant data from the existing profile',
        actionType: 'autofill',
        enabled: true,
      },
      {
        id: 'explain_deposit',
        label: 'Explain security deposit rules',
        description: 'Tanzania deposit policy reminder',
        actionType: 'explain',
        enabled: true,
      },
    ],
    commonQuestions: [
      {
        id: 'deposit_amount',
        question: 'How much should the security deposit be?',
        shortAnswer:
          'Market standard is 2 months; for new tenants consider 3 months.',
      },
    ],
  },
  '/manager/arrears/:caseId': {
    pageId: 'arrears_case',
    pageName: 'Arrears Case',
    pageType: 'arrears_case',
    relevantFields: ['balance_due', 'days_overdue', 'last_payment_at'],
    availableActions: [
      {
        id: 'draft_notice',
        label: 'Draft notice',
        description: 'Generate the next arrears notice letter',
        actionType: 'generate',
        enabled: true,
      },
    ],
    commonQuestions: [
      {
        id: 'next_step',
        question: 'What is the next escalation step?',
        shortAnswer: 'Based on days overdue, I will recommend the right ladder step.',
      },
    ],
  },
  '/manager/maintenance': {
    pageId: 'maintenance_triage',
    pageName: 'Maintenance Triage',
    pageType: 'maintenance_triage',
    relevantFields: ['category', 'severity', 'vendor'],
    availableActions: [
      {
        id: 'auto_triage',
        label: 'Auto-triage new tickets',
        description: 'Let Mr. Mwikila rank unassigned tickets',
        actionType: 'generate',
        enabled: true,
      },
    ],
    commonQuestions: [
      {
        id: 'vendor_pick',
        question: 'Which vendor should I assign?',
        shortAnswer: 'I match vendors by specialty, SLA, and past performance.',
      },
    ],
  },
};

export function getPageContext(page: string): PageContext {
  const exact = REGISTRY[page];
  if (exact) return exact;

  for (const pattern of Object.keys(REGISTRY)) {
    if (matchesPattern(page, pattern)) {
      return REGISTRY[pattern];
    }
  }

  return {
    pageId: page.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'unknown',
    pageName: humaniseRoute(page),
    pageType: 'other',
    relevantFields: [],
    availableActions: [],
    commonQuestions: [],
  };
}

function matchesPattern(page: string, pattern: string): boolean {
  const patternParts = pattern.split('/');
  const pageParts = page.split('/');
  if (patternParts.length !== pageParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(':')) continue;
    if (pp !== pageParts[i]) return false;
  }
  return true;
}

function humaniseRoute(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'home';
  return last
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
