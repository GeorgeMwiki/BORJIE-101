/**
 * Extended scenarios — expands the golden set toward the 200-scenario target.
 *
 * Each scenario is a structural regression test (not an LLM-quality judgment)
 * covering a real-world estate-management workflow in the Kenyan market.
 */

import { Scenario } from './scenario.js';
import { PERSONA_IDS } from '../personas/persona.js';

/**
 * Extended scenarios (~70 additional on top of the 30 in golden-scenarios.ts).
 */
export const EXTENDED_SCENARIOS: Scenario[] = [
  // ---------------- Leasing (extended) ----------------
  {
    id: 'leasing.new_applicant_inquiry',
    name: 'New applicant inquiry via WhatsApp',
    category: 'leasing',
    turns: [{ userText: 'A new applicant sent a WhatsApp asking about availability at Block A.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING },
  },
  {
    id: 'leasing.viewing_no_show_followup',
    name: 'Viewing no-show follow-up',
    category: 'leasing',
    turns: [{ userText: 'Applicant missed viewing yesterday. How should we follow up?' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING },
  },
  {
    id: 'leasing.background_check',
    name: 'Tenant screening background check',
    category: 'leasing',
    turns: [{ userText: 'Run a tenant screening check for applicant ID APP-332.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING },
  },
  {
    id: 'leasing.security_deposit_negotiation',
    name: 'Deposit negotiation request',
    category: 'leasing',
    turns: [
      { userText: 'Applicant for D-4 asks if they can pay deposit in two installments — advise.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'leasing.lease_abstract_from_pdf',
    name: 'Abstract lease from PDF',
    category: 'leasing',
    turns: [{ userText: 'Please abstract the lease L-99 I just uploaded (47 data points).' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectToolCalls: ['skill.leasing.abstract'],
    },
  },
  {
    id: 'leasing.vacancy_marketing_push',
    name: 'Multi-unit vacancy push',
    category: 'leasing',
    turns: [
      { userText: 'Kilimani has 3 vacancies. Plan leasing activity for the next 2 weeks.' },
    ],
    expect: { expectProposedAction: { riskAtLeast: 'MEDIUM' } },
  },

  // ---------------- Maintenance (extended) ----------------
  {
    id: 'maintenance.gas_leak_emergency',
    name: 'Gas leak — emergency',
    category: 'maintenance',
    turns: [{ userText: 'Tenant in F-2 smells gas in the kitchen. What do we do?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'maintenance.pest_infestation',
    name: 'Pest infestation at property',
    category: 'maintenance',
    turns: [{ userText: 'Multiple units at Block C are reporting cockroach infestation.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.ac_not_cooling',
    name: 'AC not cooling',
    category: 'maintenance',
    turns: [{ userText: 'Unit E-9 reports their AC is not cooling properly.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.scheduled_preventive',
    name: 'Preventive maintenance schedule',
    category: 'maintenance',
    turns: [
      { userText: 'Schedule preventive maintenance for generators across all 3 properties.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.cost_escalation',
    name: 'Work order cost estimate escalation',
    category: 'maintenance',
    turns: [
      { userText: 'Vendor quoted KES 85,000 for the roof repair. Do we approve?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'maintenance.caretaker_assignment',
    name: 'Caretaker assignment from team pool',
    category: 'maintenance',
    turns: [
      { userText: 'Assign the weekly common-area inspections to Block A caretakers.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.recurrence_detection',
    name: 'Recurring issue detection',
    category: 'maintenance',
    turns: [
      { userText: 'Is there a recurring plumbing problem at Block B? Pull the trend.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.vendor_sla_miss',
    name: 'Vendor SLA miss — escalate',
    category: 'maintenance',
    turns: [
      { userText: 'Vendor missed the 24h SLA on work order WO-201. What now?' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },

  // ---------------- Finance (extended) ----------------
  {
    id: 'finance.mpesa_phone_fallback',
    name: 'M-Pesa phone fallback matching',
    category: 'finance',
    turns: [
      { userText: 'Payment from 0712345678 matches no account ref — reconcile by phone.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.mpesa_reconcile'],
    },
  },
  {
    id: 'finance.owner_statement_monthly',
    name: 'Monthly owner statement for Mwangi',
    category: 'finance',
    turns: [{ userText: 'Draft March 2026 statement for owner Mwangi and email it.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.finance.draft_owner_statement'],
    },
  },
  {
    id: 'finance.deposit_refund',
    name: 'Deposit refund on move-out',
    category: 'finance',
    turns: [
      { userText: 'Tenant in B-6 moved out. Deposit was KES 60,000; deduct KES 8,000 damages.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.write_off_bad_debt',
    name: 'Write off bad debt — CRITICAL review',
    category: 'finance',
    turns: [
      { userText: 'Write off KES 220,000 bad debt for abscondee tenant T-88.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.service_charge_overshoot',
    name: 'Service charge overshoot alert',
    category: 'finance',
    turns: [
      { userText: 'Security category went 20% over budget this month at Kilimani. Investigate.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.service_charge_reconcile'],
    },
  },
  {
    id: 'finance.kra_threshold_breach',
    name: 'KRA annual threshold breach',
    category: 'finance',
    turns: [
      { userText: 'Is owner Wanjiku projected to exceed the KRA MRI threshold this year?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.kra_rental_summary'],
    },
  },
  {
    id: 'finance.stratified_arrears',
    name: 'Stratified arrears pipeline',
    category: 'finance',
    turns: [
      { userText: 'Stratify all tenants in arrears — gentle, firm, legal — and draft notices.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.finance.draft_arrears_notice'],
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.payment_plan_proposal',
    name: 'Payment plan for struggling tenant',
    category: 'finance',
    turns: [
      { userText: 'Tenant T-54 asks to split March rent into 3 installments. Propose terms.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'finance.owner_payout_schedule',
    name: 'Owner payout schedule',
    category: 'finance',
    turns: [{ userText: 'When is the next owner payout batch? List recipients and amounts.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE },
  },

  // ---------------- Compliance (extended) ----------------
  {
    id: 'compliance.dpa_access_request',
    name: 'DPA access request',
    category: 'compliance',
    turns: [
      { userText: 'Tenant T-90 requests their personal data under DPA. Produce the packet.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE },
  },
  {
    id: 'compliance.expiring_licenses',
    name: 'Expiring licenses',
    category: 'compliance',
    turns: [{ userText: 'Which property licenses expire in the next 30 days?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['get_parcel_compliance'],
    },
  },
  {
    id: 'compliance.demand_letter_drafting',
    name: 'Demand letter drafting',
    category: 'compliance',
    turns: [{ userText: 'Draft a demand letter to tenant T-19 for 3 months unpaid rent.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.court_prep',
    name: 'Court preparation for case C-5',
    category: 'compliance',
    turns: [{ userText: 'We go to court Monday for C-5. Compile the evidence pack.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['generate_evidence_pack'],
    },
  },
  {
    id: 'compliance.license_violation_report',
    name: 'Tenant license-violation report',
    category: 'compliance',
    turns: [
      { userText: 'Tenant T-77 running a business from a residential unit. How do we respond?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.kra_violation_alert',
    name: 'Potential KRA compliance risk',
    category: 'compliance',
    turns: [
      { userText: 'Have we missed any MRI filings in the last 6 months? Audit.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE },
  },
  {
    id: 'compliance.document_expiry_batch',
    name: 'Batch document expiry scan',
    category: 'compliance',
    turns: [{ userText: 'List all compliance documents expiring in the next 90 days.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE },
  },

  // ---------------- Communications (extended) ----------------
  {
    id: 'comms.power_outage_broadcast',
    name: 'Planned power outage broadcast',
    category: 'communications',
    turns: [
      { userText: 'Broadcast Saturday 2pm-6pm power outage to Block A and Block C tenants.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.service_charge_notice',
    name: 'Monthly service charge notice',
    category: 'communications',
    turns: [
      { userText: 'Send the monthly service charge notice to all active tenants, Swahili + English.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.renewal_invitation_batch',
    name: 'Renewal invitation batch',
    category: 'communications',
    turns: [
      { userText: 'Send renewal invitations to tenants whose leases end in the next 60 days.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.water_outage_short',
    name: 'Short-notice water outage',
    category: 'communications',
    turns: [
      { userText: 'Water tank cleaning tomorrow 8-11am. Notify Block B tenants.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS },
  },
  {
    id: 'comms.owner_quarterly_update',
    name: 'Owner quarterly update',
    category: 'communications',
    turns: [{ userText: 'Draft a Q1 update email to all owners.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.lead_nurture_campaign',
    name: 'Lead nurture campaign build',
    category: 'communications',
    turns: [{ userText: 'Build a 4-step lead nurture campaign over 14 days.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectToolCalls: ['skill.comms.draft_campaign'],
    },
  },
  {
    id: 'comms.sms_truncation',
    name: 'SMS-only blast with truncation',
    category: 'communications',
    turns: [
      { userText: 'SMS-only rent reminder to all Block D tenants. Keep under 160 chars.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS },
  },

  // ---------------- Migration (extended) ----------------
  {
    id: 'migration.legacy_yardi_export',
    name: 'Legacy Yardi export',
    category: 'migration',
    turns: [{ userText: "Importing a Yardi property export CSV. Extract + diff please." }],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'migration.excel_spreadsheet',
    name: 'Excel spreadsheet migration',
    category: 'migration',
    turns: [{ userText: 'Import tenants from this Excel sheet — 450 rows.' }],
    expect: { expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD },
  },
  {
    id: 'migration.duplicate_detection',
    name: 'Duplicate detection during diff',
    category: 'migration',
    turns: [
      { userText: 'Some of these tenants might already exist. How do you handle duplicates?' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD },
  },
  {
    id: 'migration.rollback_request',
    name: 'Migration rollback request',
    category: 'migration',
    turns: [
      { userText: 'We committed the migration yesterday but realized an error. Can we roll back?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },

  // ---------------- Coworker (extended) ----------------
  {
    id: 'coworker.how_to_log_emergency',
    name: 'How to log emergency',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'Walk me through logging an emergency water leak.',
      },
    ],
    expect: { expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002` },
  },
  {
    id: 'coworker.lease_clause_explain',
    name: 'Explain lease clause',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'What does the late-fee clause in lease L-4421 actually allow us to charge?',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
      expectAdvisorConsulted: true,
    },
  },
  {
    id: 'coworker.task_status',
    name: 'Task status query',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'What assignments do I have open this week?',
      },
    ],
    expect: { expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002` },
  },
  {
    id: 'coworker.request_permission_large_cost',
    name: 'Permission request for large cost',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'I need to authorize a KES 18,000 emergency repair. Ask my manager.',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'coworker.draft_tenant_reply',
    name: 'Draft tenant reply (Swahili)',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'Draft a short Swahili reply to tenant T-120 confirming inspection Tuesday 10am.',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
      expectToolCalls: ['skill.kenya.swahili_draft'],
    },
  },
  {
    id: 'coworker.stuck_on_task',
    name: 'Employee stuck on task',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'I don\'t know how to close this work order — the vendor didn\'t give me a receipt.',
      },
    ],
    expect: { expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002` },
  },

  // ---------------- Governance (extended) ----------------
  {
    id: 'governance.eviction_always_advisor',
    name: 'Eviction language always routes to advisor',
    category: 'governance',
    turns: [
      { userText: 'We need to evict the tenant in unit G-3 by end of month.' },
    ],
    expect: {
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.multi_domain_complex',
    name: 'Multi-domain complex planning',
    category: 'governance',
    turns: [
      {
        userText:
          'Plan a full turnover for 5 units: collect arrears, move-out inspections, renewal offers to replacements, maintenance prep.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      maxTokens: 30_000,
    },
  },
  {
    id: 'governance.refund_advisor_required',
    name: 'Refund above threshold triggers advisor',
    category: 'governance',
    turns: [{ userText: 'Process a refund of KES 150,000 to owner for an overcharge.' }],
    expect: {
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.data_erasure_high_risk',
    name: 'Data erasure under DPA',
    category: 'governance',
    turns: [{ userText: 'Erase tenant T-99\'s records per their DPA request.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.portfolio_no_handoff_needed',
    name: 'Portfolio overview needs no handoff',
    category: 'governance',
    turns: [{ userText: 'What is our current occupancy rate across the portfolio?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      expectToolCalls: ['get_portfolio_overview'],
    },
  },
  {
    id: 'governance.advisor_skipped_for_low_risk',
    name: 'Advisor not consulted for low-risk',
    category: 'governance',
    turns: [{ userText: 'What team do I assign a leaky tap to?' }],
    expect: {
      expectAdvisorConsulted: false,
    },
  },

  // ---------------- Cross-cutting real-world scenarios ----------------
  {
    id: 'portfolio.quarterly_report',
    name: 'Quarterly board report',
    category: 'finance',
    turns: [{ userText: 'Prepare a Q1 board report across all 5 properties.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE },
  },
  {
    id: 'portfolio.month_end_close',
    name: 'Month-end close coordination',
    category: 'finance',
    turns: [
      {
        userText:
          'It is month-end. Coordinate reconciliation, owner statements, and KRA MRI summary.',
      },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE },
  },
  {
    id: 'portfolio.emergency_after_hours',
    name: 'After-hours emergency',
    category: 'maintenance',
    turns: [
      { userText: 'It is 2am. Ceiling collapsed in unit H-1. What do we do right now?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'portfolio.new_property_onboarding',
    name: 'Onboard new property to portfolio',
    category: 'migration',
    turns: [
      {
        userText:
          'Onboard a new property: 40 units, caretaker + maintenance team, import owner and tenants.',
      },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD },
  },
];
