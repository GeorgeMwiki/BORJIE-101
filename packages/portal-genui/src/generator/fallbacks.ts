/**
 * Deterministic fallback tab templates — used when the LLM is not
 * wired (dev / tests) or every proposer returns garbage. Each domain
 * gets a sensible default skeleton with 1-3 sections + the widgets
 * that domain typically needs. Generators MAY blend fallback data
 * with LLM output (e.g. cherry-pick widget configs) for resilience.
 */

import type { PortalTab, TabGenerationIntent } from '../types.js';

type DomainSkeleton = Pick<
  PortalTab,
  'sections' | 'icon' | 'permissions'
>;

const HR_SKELETON: DomainSkeleton = {
  icon: 'users',
  permissions: {
    visibleToPersonas: ['internal_admin', 'property_manager'],
  },
  sections: [
    {
      key: 'people',
      title: 'People',
      description: 'Roster of staff members and their key facts.',
      fields: [
        { key: 'full_name', label: 'Full name', kind: 'text', required: true, span: 6 },
        { key: 'role', label: 'Role', kind: 'text', span: 6 },
        { key: 'email', label: 'Work email', kind: 'email', span: 6 },
        { key: 'phone', label: 'Phone', kind: 'phone_number', span: 6 },
        { key: 'hire_date', label: 'Hire date', kind: 'date', span: 4 },
        {
          key: 'employment_type',
          label: 'Employment type',
          kind: 'dropdown',
          span: 4,
          options: [
            { value: 'full_time', label: 'Full time' },
            { value: 'part_time', label: 'Part time' },
            { value: 'contractor', label: 'Contractor' },
          ],
        },
      ],
      widgets: [
        {
          key: 'headcount',
          kind: 'kpi_card',
          title: 'Headcount',
          span: 4,
          config: { label: 'Staff on payroll', value: 0 },
        },
      ],
    },
    {
      key: 'payroll',
      title: 'Payroll',
      description: 'Pay cycles, gross / net, payslips.',
      fields: [
        { key: 'pay_period', label: 'Pay period', kind: 'date', required: true, span: 4 },
        { key: 'gross_pay', label: 'Gross pay', kind: 'currency', required: true, span: 4 },
        { key: 'net_pay', label: 'Net pay', kind: 'currency', required: true, span: 4 },
      ],
      widgets: [
        {
          key: 'payroll_trend',
          kind: 'chart_line',
          title: 'Monthly payroll',
          span: 8,
          config: { series: [] },
        },
      ],
    },
    {
      key: 'time_off',
      title: 'Time off',
      description: 'Leave balances, requests, approvals.',
      fields: [
        { key: 'start_date', label: 'Start date', kind: 'date', required: true, span: 3 },
        { key: 'end_date', label: 'End date', kind: 'date', required: true, span: 3 },
        {
          key: 'reason',
          label: 'Reason',
          kind: 'dropdown',
          span: 3,
          options: [
            { value: 'annual', label: 'Annual leave' },
            { value: 'sick', label: 'Sick leave' },
            { value: 'unpaid', label: 'Unpaid' },
          ],
        },
      ],
      widgets: [
        {
          key: 'leave_calendar',
          kind: 'calendar',
          title: 'Leave calendar',
          span: 12,
          config: { events: [] },
        },
      ],
    },
  ],
};

const FINANCE_SKELETON: DomainSkeleton = {
  icon: 'banknote',
  permissions: {
    visibleToPersonas: ['internal_admin', 'property_manager', 'owner'],
  },
  sections: [
    {
      key: 'budgets',
      title: 'Budgets',
      description: 'Annual or quarterly budget envelopes.',
      fields: [
        { key: 'budget_name', label: 'Budget name', kind: 'text', required: true, span: 6 },
        { key: 'period', label: 'Period', kind: 'text', span: 3 },
        { key: 'total_envelope', label: 'Envelope', kind: 'currency', required: true, span: 3 },
      ],
      widgets: [
        {
          key: 'spend_vs_budget',
          kind: 'chart_bar',
          title: 'Spend vs. budget',
          span: 8,
          config: { categories: [], series: [] },
        },
      ],
    },
    {
      key: 'expenses',
      title: 'Expenses',
      description: 'Inbound expenses, vendor invoices, receipts.',
      fields: [
        { key: 'vendor', label: 'Vendor', kind: 'text', required: true, span: 4 },
        { key: 'amount', label: 'Amount', kind: 'currency', required: true, span: 3 },
        { key: 'date', label: 'Date', kind: 'date', required: true, span: 3 },
        { key: 'receipt', label: 'Receipt', kind: 'file_upload', span: 12 },
      ],
      widgets: [],
    },
  ],
};

const COMPLIANCE_SKELETON: DomainSkeleton = {
  icon: 'shield-check',
  permissions: {
    visibleToPersonas: ['internal_admin'],
  },
  sections: [
    {
      key: 'controls',
      title: 'Controls',
      description: 'Tracked control objectives and their owners.',
      fields: [
        { key: 'control_id', label: 'Control id', kind: 'text', required: true, span: 4 },
        { key: 'description', label: 'Description', kind: 'long_text', required: true, span: 8 },
        {
          key: 'status',
          label: 'Status',
          kind: 'dropdown',
          span: 4,
          options: [
            { value: 'pass', label: 'Pass' },
            { value: 'fail', label: 'Fail' },
            { value: 'na', label: 'N/A' },
          ],
        },
        { key: 'last_reviewed', label: 'Last reviewed', kind: 'date', span: 4 },
      ],
      widgets: [
        {
          key: 'coverage',
          kind: 'gauge',
          title: 'Control coverage',
          span: 4,
          config: { value: 0, min: 0, max: 100 },
        },
      ],
    },
    {
      key: 'evidence',
      title: 'Evidence',
      description: 'Documents + artefacts for audit.',
      fields: [
        { key: 'control_id', label: 'Linked control', kind: 'text', required: true, span: 4 },
        { key: 'file', label: 'File', kind: 'file_upload', required: true, span: 8 },
      ],
      widgets: [],
    },
  ],
};

const PROCUREMENT_SKELETON: DomainSkeleton = {
  icon: 'shopping-cart',
  permissions: {
    visibleToPersonas: ['internal_admin', 'property_manager'],
  },
  sections: [
    {
      key: 'suppliers',
      title: 'Suppliers',
      description: 'Approved supplier list with key facts.',
      fields: [
        { key: 'name', label: 'Supplier name', kind: 'text', required: true, span: 6 },
        { key: 'category', label: 'Category', kind: 'text', span: 3 },
        { key: 'rating', label: 'Rating', kind: 'rating', span: 3, min: 1, max: 5 },
        { key: 'kyc_doc', label: 'KYC document', kind: 'file_upload', span: 12 },
      ],
      widgets: [],
    },
    {
      key: 'purchase_orders',
      title: 'Purchase orders',
      description: 'Outstanding and recent POs.',
      fields: [
        { key: 'po_number', label: 'PO number', kind: 'text', required: true, span: 3 },
        { key: 'supplier', label: 'Supplier', kind: 'text', required: true, span: 4 },
        { key: 'amount', label: 'Amount', kind: 'currency', required: true, span: 3 },
        { key: 'due_date', label: 'Due date', kind: 'date', span: 2 },
      ],
      widgets: [
        {
          key: 'po_kanban',
          kind: 'kanban',
          title: 'POs by stage',
          span: 12,
          config: { columns: [] },
        },
      ],
    },
  ],
};

const GENERIC_SKELETON: DomainSkeleton = {
  icon: 'sparkles',
  permissions: {
    visibleToPersonas: ['internal_admin', 'property_manager'],
  },
  sections: [
    {
      key: 'overview',
      title: 'Overview',
      description: 'Top-line facts for this area.',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', required: true, span: 6 },
        { key: 'description', label: 'Description', kind: 'long_text', span: 12 },
        { key: 'owner', label: 'Owner', kind: 'text', span: 4 },
        { key: 'status', label: 'Status', kind: 'text', span: 4 },
      ],
      widgets: [
        {
          key: 'recent_activity',
          kind: 'timeline',
          title: 'Recent activity',
          span: 8,
          config: { items: [] },
        },
      ],
    },
  ],
};

const SKELETONS: Readonly<Record<PortalTab['domain'], DomainSkeleton>> = {
  hr: HR_SKELETON,
  finance: FINANCE_SKELETON,
  compliance: COMPLIANCE_SKELETON,
  procurement: PROCUREMENT_SKELETON,
  operations: GENERIC_SKELETON,
  sales: GENERIC_SKELETON,
  marketing: GENERIC_SKELETON,
  engineering: GENERIC_SKELETON,
  legal: GENERIC_SKELETON,
  sustainability: GENERIC_SKELETON,
  custom: GENERIC_SKELETON,
};

export function getDomainSkeleton(
  domain: PortalTab['domain'],
): DomainSkeleton {
  return SKELETONS[domain];
}

export function getDefaultIcon(domain: PortalTab['domain']): string {
  return SKELETONS[domain].icon;
}

export interface BuildFallbackArgs {
  readonly intent: TabGenerationIntent;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly actorId: string;
  readonly nowIso: string;
  readonly id: string;
  readonly sourceConversationId: string | undefined;
}

/**
 * Build a fully-validated `PortalTab` from the domain skeleton. Used
 * when no LLM is available, or as a hard fallback when every LLM
 * proposer returns invalid JSON.
 */
export function buildFallbackTab(args: BuildFallbackArgs): PortalTab {
  const skeleton = getDomainSkeleton(args.intent.domain);
  const tab: PortalTab = {
    id: args.id,
    version: 1,
    tenantId: args.tenantId,
    userId: args.userId,
    tabKey: args.intent.proposedTabKey,
    title: args.intent.proposedTabTitle,
    description: `Auto-generated tab for ${args.intent.proposedTabTitle}.`,
    icon: skeleton.icon,
    domain: args.intent.domain,
    sections: skeleton.sections,
    permissions: skeleton.permissions,
    audit: {
      createdBy: args.actorId,
      updatedBy: args.actorId,
      history: [
        {
          actor: 'system',
          actorId: args.actorId,
          action: 'created',
          at: args.nowIso,
          note: `Generated from intent: "${args.intent.sourceMessage.slice(0, 100)}"`,
        },
      ],
      ...(args.sourceConversationId !== undefined
        ? { sourceConversationId: args.sourceConversationId }
        : {}),
    },
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
  };
  return tab;
}
