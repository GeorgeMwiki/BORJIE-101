/**
 * Query key factories for all Wave 2 resource hooks.
 *
 * Keys follow the convention:
 *   [resource, tenantId, orgId?, ...filters]
 *
 * Keeping them in one file makes invalidation patterns easy to audit
 * and prevents drift between list / detail / child queries.
 */

export type TenantScope = {
  readonly tenantId: string;
  readonly orgId?: string;
};

type KeyFragment = string | number | boolean | null | undefined | Record<string, unknown>;

function scope(s: TenantScope): readonly KeyFragment[] {
  return s.orgId ? [s.tenantId, s.orgId] : [s.tenantId];
}

export const queryKeys = {
  approvalPolicies: {
    all: (s: TenantScope) => ['approval-policies', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['approval-policies', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, id: string) =>
      ['approval-policies', ...scope(s), 'detail', id] as const,
  },
  negotiations: {
    all: (s: TenantScope) => ['negotiations', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['negotiations', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, id: string) =>
      ['negotiations', ...scope(s), 'detail', id] as const,
    audit: (s: TenantScope, id: string) =>
      ['negotiations', ...scope(s), 'audit', id] as const,
  },
  marketplaceListings: {
    all: (s: TenantScope) => ['marketplace-listings', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['marketplace-listings', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, id: string) =>
      ['marketplace-listings', ...scope(s), 'detail', id] as const,
  },
  tenders: {
    all: (s: TenantScope) => ['tenders', ...scope(s)] as const,
    detail: (s: TenantScope, id: string) =>
      ['tenders', ...scope(s), 'detail', id] as const,
    bids: (s: TenantScope, tenderId: string) =>
      ['tenders', ...scope(s), 'bids', tenderId] as const,
  },
  waitlist: {
    all: (s: TenantScope) => ['waitlist', ...scope(s)] as const,
    forUnit: (s: TenantScope, unitId: string) =>
      ['waitlist', ...scope(s), 'unit', unitId] as const,
    forCustomer: (s: TenantScope, customerId: string) =>
      ['waitlist', ...scope(s), 'customer', customerId] as const,
  },
  gamification: {
    all: (s: TenantScope) => ['gamification', ...scope(s)] as const,
    policy: (s: TenantScope) => ['gamification', ...scope(s), 'policy'] as const,
    customer: (s: TenantScope, customerId: string) =>
      ['gamification', ...scope(s), 'customer', customerId] as const,
  },
  arrears: {
    all: (s: TenantScope) => ['arrears', ...scope(s)] as const,
    projection: (s: TenantScope, caseId: string) =>
      ['arrears', ...scope(s), 'projection', caseId] as const,
  },
  gepg: {
    all: (s: TenantScope) => ['gepg', ...scope(s)] as const,
    controlNumber: (s: TenantScope, controlNumber: string, billId: string) =>
      ['gepg', ...scope(s), 'control-number', controlNumber, billId] as const,
  },
  letterRequests: {
    all: (s: TenantScope) => ['letter-requests', ...scope(s)] as const,
    detail: (s: TenantScope, id: string) =>
      ['letter-requests', ...scope(s), 'detail', id] as const,
  },
  docChat: {
    all: (s: TenantScope) => ['doc-chat', ...scope(s)] as const,
    session: (s: TenantScope, sessionId: string) =>
      ['doc-chat', ...scope(s), 'session', sessionId] as const,
    messages: (s: TenantScope, sessionId: string) =>
      ['doc-chat', ...scope(s), 'messages', sessionId] as const,
  },
  scans: {
    all: (s: TenantScope) => ['scans', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['scans', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, id: string) =>
      ['scans', ...scope(s), 'detail', id] as const,
  },
  interactiveReports: {
    all: (s: TenantScope) => ['interactive-reports', ...scope(s)] as const,
    latest: (s: TenantScope, reportId: string) =>
      ['interactive-reports', ...scope(s), 'latest', reportId] as const,
  },
  occupancyTimeline: {
    all: (s: TenantScope) => ['occupancy-timeline', ...scope(s)] as const,
    forUnit: (
      s: TenantScope,
      unitId: string,
      pagination?: { page?: number; limit?: number },
    ) =>
      [
        'occupancy-timeline',
        ...scope(s),
        'unit',
        unitId,
        pagination ?? {},
      ] as const,
  },
  stationMasterCoverage: {
    all: (s: TenantScope) => ['station-master-coverage', ...scope(s)] as const,
    forStaff: (s: TenantScope, staffId: string) =>
      ['station-master-coverage', ...scope(s), 'staff', staffId] as const,
  },
  migration: {
    all: (s: TenantScope) => ['migration', ...scope(s)] as const,
    run: (s: TenantScope, runId: string) =>
      ['migration', ...scope(s), 'run', runId] as const,
  },
  riskReports: {
    all: (s: TenantScope) => ['risk-reports', ...scope(s)] as const,
    latest: (s: TenantScope, customerId: string) =>
      ['risk-reports', ...scope(s), 'latest', customerId] as const,
  },
  compliance: {
    all: (s: TenantScope) => ['compliance', ...scope(s)] as const,
    exports: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['compliance', ...scope(s), 'exports', filters ?? {}] as const,
    export: (s: TenantScope, id: string) =>
      ['compliance', ...scope(s), 'export', id] as const,
  },
  financialProfile: {
    all: (s: TenantScope) => ['financial-profile', ...scope(s)] as const,
    statement: (s: TenantScope, id: string) =>
      ['financial-profile', ...scope(s), 'statement', id] as const,
  },
  renewals: {
    all: (s: TenantScope) => ['renewals', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['renewals', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, leaseId: string) =>
      ['renewals', ...scope(s), 'detail', leaseId] as const,
  },
  notificationPreferences: {
    all: (s: TenantScope) => ['notification-preferences', ...scope(s)] as const,
    current: (s: TenantScope) =>
      ['notification-preferences', ...scope(s), 'current'] as const,
  },
  conditionalSurveys: {
    all: (s: TenantScope) => ['conditional-surveys', ...scope(s)] as const,
    list: (s: TenantScope, filters?: Record<string, unknown>) =>
      ['conditional-surveys', ...scope(s), 'list', filters ?? {}] as const,
    detail: (s: TenantScope, id: string) =>
      ['conditional-surveys', ...scope(s), 'detail', id] as const,
  },
  applications: {
    all: (s: TenantScope) => ['applications', ...scope(s)] as const,
    detail: (s: TenantScope, id: string) =>
      ['applications', ...scope(s), 'detail', id] as const,
  },
} as const;
