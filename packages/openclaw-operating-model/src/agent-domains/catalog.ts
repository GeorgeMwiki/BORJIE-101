/**
 * Pre-shipped agent task-domain catalog for BORJIE.
 *
 * Each domain encodes its risk class and default autonomy level. Tenants
 * may register additional domains via `registerDomain(spec)`.
 *
 * Mapping (NemoClaw-style YAML policy semantics):
 *   - critical → defaults to L2 (require approval on high-stakes)
 *   - high     → defaults to L3 (within-envelope autonomous)
 *   - med      → defaults to L3
 *   - low      → defaults to L4
 *
 * Tools and dataAccessScope are deliberately scoped narrowly. They are
 * the names of MCP tools (P57) — this package does not import that
 * package; the runtime composer maps tool names to live tools.
 */

import type { AgentDomain } from '../types.js';

export const SHIPPED_DOMAIN_VERSION = '2026.05.24';

export const SHIPPED_DOMAINS: ReadonlyArray<AgentDomain> = [
  {
    id: 'lease-renewal',
    name: 'Lease Renewal',
    description:
      'Renew expiring leases: notify tenant 60d ahead, propose new terms, draft renewal document, collect signature.',
    riskClass: 'critical',
    defaultAutonomyLevel: 'L2',
    allowedTools: [
      'propose_lease_renewal',
      'draft_lease_document',
      'send_tenant_notification',
      'request_signature',
    ],
    dataAccessScope: ['leases', 'tenants', 'units', 'rent_rolls'],
    escalationOwner: 'property_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'rent-collection',
    name: 'Rent Collection',
    description:
      'Send rent reminders, reconcile inbound payments, mark invoices paid, escalate arrears.',
    riskClass: 'high',
    defaultAutonomyLevel: 'L3',
    allowedTools: [
      'send_rent_reminder',
      'reconcile_mpesa_payment',
      'reconcile_bank_payment',
      'mark_invoice_paid',
      'flag_arrears',
    ],
    dataAccessScope: [
      'invoices',
      'payments',
      'tenants',
      'units',
      'rent_rolls',
    ],
    escalationOwner: 'finance_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'maintenance-dispatch',
    name: 'Maintenance Dispatch',
    description:
      'Triage maintenance requests, dispatch contractors, follow up on completion, close work orders.',
    riskClass: 'med',
    defaultAutonomyLevel: 'L3',
    allowedTools: [
      'create_work_order',
      'dispatch_contractor',
      'send_tenant_notification',
      'close_work_order',
      'request_inspection_photo',
    ],
    dataAccessScope: [
      'work_orders',
      'contractors',
      'units',
      'tenants',
      'inventory',
    ],
    escalationOwner: 'maintenance_supervisor',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'tenant-onboarding',
    name: 'Tenant Onboarding',
    description:
      'Collect tenant docs, run background/credit checks, prepare lease, schedule key handover.',
    riskClass: 'high',
    defaultAutonomyLevel: 'L2',
    allowedTools: [
      'collect_tenant_documents',
      'run_background_check',
      'draft_lease_document',
      'schedule_key_handover',
    ],
    dataAccessScope: [
      'applicants',
      'tenants',
      'leases',
      'units',
      'background_checks',
    ],
    escalationOwner: 'leasing_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'marketplace-listing',
    name: 'Marketplace Listing',
    description:
      'Generate listing copy + photos, syndicate to portals, manage inquiries, schedule viewings.',
    riskClass: 'low',
    defaultAutonomyLevel: 'L4',
    allowedTools: [
      'generate_listing_copy',
      'publish_listing',
      'syndicate_to_portal',
      'respond_to_inquiry',
      'schedule_viewing',
    ],
    dataAccessScope: ['units', 'listings', 'inquiries', 'viewings'],
    escalationOwner: 'marketing_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'procurement-rfq',
    name: 'Procurement / RFQ',
    description:
      'Run RFQ cycles for materials and contractor services, compare bids, recommend award.',
    riskClass: 'high',
    defaultAutonomyLevel: 'L2',
    allowedTools: [
      'create_rfq',
      'invite_bidders',
      'compare_bids',
      'recommend_award',
    ],
    dataAccessScope: ['rfqs', 'bids', 'vendors', 'contracts'],
    escalationOwner: 'procurement_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'inspection-scheduling',
    name: 'Inspection Scheduling',
    description:
      'Schedule move-in, move-out and periodic inspections; coordinate inspector + tenant calendars.',
    riskClass: 'med',
    defaultAutonomyLevel: 'L3',
    allowedTools: [
      'schedule_inspection',
      'send_tenant_notification',
      'book_inspector',
      'reschedule_inspection',
    ],
    dataAccessScope: [
      'inspections',
      'inspectors',
      'units',
      'tenants',
      'calendars',
    ],
    escalationOwner: 'operations_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'report-generation',
    name: 'Report Generation',
    description:
      'Generate monthly owner reports, occupancy reports, regulator filings; assemble + format.',
    riskClass: 'low',
    defaultAutonomyLevel: 'L4',
    allowedTools: [
      'query_database',
      'generate_chart',
      'compose_report',
      'send_report_email',
    ],
    dataAccessScope: [
      'analytics',
      'reports',
      'owners',
      'rent_rolls',
      'occupancy',
    ],
    escalationOwner: 'reporting_lead',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'payment-reconciliation',
    name: 'Payment Reconciliation',
    description:
      'Match inbound payments (M-Pesa / Tigo Pesa / bank / cash) to outstanding invoices.',
    riskClass: 'critical',
    defaultAutonomyLevel: 'L2',
    allowedTools: [
      'fetch_bank_statement',
      'fetch_mpesa_statement',
      'match_payment_to_invoice',
      'mark_invoice_paid',
      'flag_unmatched_payment',
    ],
    dataAccessScope: [
      'invoices',
      'payments',
      'bank_transactions',
      'mpesa_transactions',
    ],
    escalationOwner: 'finance_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
  {
    id: 'marketing-content',
    name: 'Marketing Content',
    description:
      'Draft social media posts, email campaigns, newsletter content; A/B test variants.',
    riskClass: 'low',
    defaultAutonomyLevel: 'L4',
    allowedTools: [
      'draft_social_post',
      'draft_email_campaign',
      'schedule_post',
      'run_ab_test',
    ],
    dataAccessScope: ['marketing', 'campaigns', 'subscribers'],
    escalationOwner: 'marketing_manager',
    version: SHIPPED_DOMAIN_VERSION,
  },
];

/** Map riskClass → recommended default autonomy level. */
export function recommendedDefaultAutonomy(
  riskClass: AgentDomain['riskClass'],
): AgentDomain['defaultAutonomyLevel'] {
  switch (riskClass) {
    case 'critical':
      return 'L2';
    case 'high':
      return 'L3';
    case 'med':
      return 'L3';
    case 'low':
      return 'L4';
  }
}
