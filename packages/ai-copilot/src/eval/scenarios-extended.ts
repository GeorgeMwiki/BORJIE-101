/**
 * Extended scenarios — expands the golden set toward the 200-scenario target.
 *
 * Each scenario is a structural regression test (not an LLM-quality judgment)
 * covering a real-world mining-estate workflow in the Tanzanian market.
 *
 * Note: `category` values reuse the `Scenario` union from `scenario.ts`
 * (e.g. `'leasing'` is the offtake-domain bucket); the user-facing content
 * (ids, names, prompts, tools) is mining.
 */

import { Scenario } from './scenario.js';
import { PERSONA_IDS } from '../personas/persona.js';

/**
 * Extended scenarios (~70 additional on top of the 30 in golden-scenarios.ts).
 */
export const EXTENDED_SCENARIOS: Scenario[] = [
  // ---------------- Offtake (extended) ----------------
  {
    id: 'offtake.new_buyer_inquiry',
    name: 'New buyer inquiry via WhatsApp',
    category: 'leasing',
    turns: [{ userText: 'A new buyer sent a WhatsApp asking about doré availability at the Geita site.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE },
  },
  {
    id: 'offtake.site_visit_no_show_followup',
    name: 'Site-visit no-show follow-up',
    category: 'leasing',
    turns: [{ userText: 'Buyer missed the site visit yesterday. How should we follow up?' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE },
  },
  {
    id: 'offtake.counterparty_due_diligence',
    name: 'Counterparty qualification check',
    category: 'leasing',
    turns: [{ userText: 'Run a counterparty qualification check for buyer ID BUY-332.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE },
  },
  {
    id: 'offtake.performance_bond_negotiation',
    name: 'Performance-bond negotiation request',
    category: 'leasing',
    turns: [
      { userText: 'Buyer for consignment D-4 asks if they can post the performance bond in two installments — advise.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'offtake.agreement_abstract_from_pdf',
    name: 'Abstract supply agreement from PDF',
    category: 'leasing',
    turns: [{ userText: 'Please abstract the supply agreement A-99 I just uploaded (47 data points).' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectToolCalls: ['skill.offtake.abstract'],
    },
  },
  {
    id: 'offtake.consignment_marketing_push',
    name: 'Multi-consignment marketing push',
    category: 'leasing',
    turns: [
      { userText: 'Geita has 3 unsold consignments. Plan offtake activity for the next 2 weeks.' },
    ],
    expect: { expectProposedAction: { riskAtLeast: 'MEDIUM' } },
  },

  // ---------------- Maintenance (extended) ----------------
  {
    id: 'maintenance.explosives_hazard_emergency',
    name: 'Explosives hazard — emergency',
    category: 'maintenance',
    turns: [{ userText: 'A fitter at the magazine reports a damaged detonator store. What do we do?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'maintenance.conveyor_belt_fault',
    name: 'Conveyor belt fault at plant',
    category: 'maintenance',
    turns: [{ userText: 'The main conveyor at the CIL plant keeps tripping out.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.cyclone_underperforming',
    name: 'Cyclone underperforming',
    category: 'maintenance',
    turns: [{ userText: 'The classification cyclone is not cutting at the target size.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.scheduled_preventive',
    name: 'Preventive maintenance schedule',
    category: 'maintenance',
    turns: [
      { userText: 'Schedule preventive maintenance for the generators across all 3 sites.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.cost_escalation',
    name: 'Work order cost estimate escalation',
    category: 'maintenance',
    turns: [
      { userText: 'Vendor quoted TSh 85,000,000 for the mill-liner replacement. Do we approve?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'maintenance.foreman_assignment',
    name: 'Foreman assignment from team pool',
    category: 'maintenance',
    turns: [
      { userText: 'Assign the weekly plant inspections to the Geita site foremen.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE },
  },
  {
    id: 'maintenance.recurrence_detection',
    name: 'Recurring issue detection',
    category: 'maintenance',
    turns: [
      { userText: 'Is there a recurring pump problem at the Kahama site? Pull the trend.' },
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
    id: 'finance.gepg_phone_fallback',
    name: 'GePG phone fallback matching',
    category: 'finance',
    turns: [
      { userText: 'Payment from 0712345678 matches no control number — reconcile by phone.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.mpesa_reconcile'],
    },
  },
  {
    id: 'finance.owner_statement_monthly',
    name: 'Monthly owner statement for Mwita',
    category: 'finance',
    turns: [{ userText: 'Draft March 2026 statement for owner Mwita and email it.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.finance.draft_owner_statement'],
    },
  },
  {
    id: 'finance.bond_refund',
    name: 'Performance-bond refund on dispatch',
    category: 'finance',
    turns: [
      { userText: 'Buyer for consignment B-6 collected the lot. Bond was TSh 60,000,000; deduct TSh 8,000,000 shortfall.' },
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
      { userText: 'Write off TSh 220,000,000 bad debt for defaulting buyer B-88.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.cooperative_levy_overshoot',
    name: 'Cooperative-levy overshoot alert',
    category: 'finance',
    turns: [
      { userText: 'The security category went 20% over budget this month at the Chunya cooperative. Investigate.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.service_charge_reconcile'],
    },
  },
  {
    id: 'finance.tra_threshold_breach',
    name: 'TRA annual threshold check',
    category: 'finance',
    turns: [
      { userText: 'Is owner Wanjiku projected to exceed the TRA royalty-reporting threshold this year?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.tra_royalty_summary'],
    },
  },
  {
    id: 'finance.stratified_outstanding_royalties',
    name: 'Stratified outstanding-royalty pipeline',
    category: 'finance',
    turns: [
      { userText: 'Stratify all buyers with outstanding royalties — gentle, firm, legal — and draft notices.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.finance.draft_arrears_notice'],
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.payment_plan_proposal',
    name: 'Payment plan for struggling buyer',
    category: 'finance',
    turns: [
      { userText: 'Buyer B-54 asks to split the March royalty into 3 installments. Propose terms.' },
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
    name: 'PDPA access request',
    category: 'compliance',
    turns: [
      { userText: 'Buyer B-90 requests their personal data under the PDPA. Produce the packet.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE },
  },
  {
    id: 'compliance.expiring_licences',
    name: 'Expiring mineral-right licences',
    category: 'compliance',
    turns: [{ userText: 'Which mineral-right licences expire in the next 30 days?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['get_parcel_compliance'],
    },
  },
  {
    id: 'compliance.demand_letter_drafting',
    name: 'Demand letter drafting',
    category: 'compliance',
    turns: [{ userText: 'Draft a demand letter to buyer B-19 for 3 months of unpaid royalties.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.commission_prep',
    name: 'Mining Commission preparation for case C-5',
    category: 'compliance',
    turns: [{ userText: 'We appear before the Mining Commission Monday for C-5. Compile the evidence pack.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['generate_evidence_pack'],
    },
  },
  {
    id: 'compliance.licence_violation_report',
    name: 'Licence-condition violation report',
    category: 'compliance',
    turns: [
      { userText: 'A holder is exporting unprocessed ore in breach of the beneficiation condition. How do we respond?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.tra_violation_alert',
    name: 'Potential TRA compliance risk',
    category: 'compliance',
    turns: [
      { userText: 'Have we missed any royalty-return filings in the last 6 months? Audit.' },
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
      { userText: 'Broadcast Saturday 2pm-6pm power outage at the plant to all Geita and Kahama buyers.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.cooperative_levy_notice',
    name: 'Monthly cooperative-levy notice',
    category: 'communications',
    turns: [
      { userText: 'Send the monthly cooperative-levy notice to all active members, Swahili + English.' },
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
      { userText: 'Send renewal invitations to buyers whose supply agreements end in the next 60 days.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.water_outage_short',
    name: 'Short-notice process-water outage',
    category: 'communications',
    turns: [
      { userText: 'Process-water line maintenance tomorrow 8-11am. Notify the Kahama site team.' },
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
    id: 'comms.buyer_nurture_campaign',
    name: 'Buyer nurture campaign build',
    category: 'communications',
    turns: [{ userText: 'Build a 4-step buyer nurture campaign over 14 days.' }],
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
      { userText: 'SMS-only royalty reminder to all Geita buyers. Keep under 160 chars.' },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS },
  },

  // ---------------- Migration (extended) ----------------
  {
    id: 'migration.legacy_erp_export',
    name: 'Legacy ERP export',
    category: 'migration',
    turns: [{ userText: "Importing a legacy mine-ERP asset export CSV. Extract + diff please." }],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'migration.excel_spreadsheet',
    name: 'Excel spreadsheet migration',
    category: 'migration',
    turns: [{ userText: 'Import buyers from this Excel sheet — 450 rows.' }],
    expect: { expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD },
  },
  {
    id: 'migration.duplicate_detection',
    name: 'Duplicate detection during diff',
    category: 'migration',
    turns: [
      { userText: 'Some of these buyers might already exist. How do you handle duplicates?' },
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
        userText: 'Walk me through logging an emergency water inrush at the pit.',
      },
    ],
    expect: { expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002` },
  },
  {
    id: 'coworker.agreement_clause_explain',
    name: 'Explain supply-agreement clause',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'What does the default-interest clause in supply agreement A-4421 actually allow us to charge?',
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
        userText: 'I need to authorize a TSh 18,000,000 emergency repair. Ask my manager.',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'coworker.draft_buyer_reply',
    name: 'Draft buyer reply (Swahili)',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-002`,
        userText: 'Draft a short Swahili reply to buyer B-120 confirming the site visit Tuesday 10am.',
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
    id: 'governance.suspension_always_advisor',
    name: 'Licence-suspension language always routes to advisor',
    category: 'governance',
    turns: [
      { userText: 'We need to suspend the buyer on consignment G-3 by end of month.' },
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
          'Plan a full dispatch for 5 consignments: collect outstanding royalties, dispatch inspections, renewal offers to replacements, plant prep.',
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
    turns: [{ userText: 'Process a refund of TSh 150,000,000 to an owner for an overcharge.' }],
    expect: {
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.data_erasure_high_risk',
    name: 'Data erasure under PDPA',
    category: 'governance',
    turns: [{ userText: 'Erase buyer B-99\'s records per their PDPA request.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.portfolio_no_handoff_needed',
    name: 'Portfolio overview needs no handoff',
    category: 'governance',
    turns: [{ userText: 'What is our current production rate across the portfolio?' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      expectToolCalls: ['get_portfolio_overview'],
    },
  },
  {
    id: 'governance.advisor_skipped_for_low_risk',
    name: 'Advisor not consulted for low-risk',
    category: 'governance',
    turns: [{ userText: 'What team do I assign a leaking hydraulic line to?' }],
    expect: {
      expectAdvisorConsulted: false,
    },
  },

  // ---------------- Cross-cutting real-world scenarios ----------------
  {
    id: 'portfolio.quarterly_report',
    name: 'Quarterly board report',
    category: 'finance',
    turns: [{ userText: 'Prepare a Q1 board report across all 5 sites.' }],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE },
  },
  {
    id: 'portfolio.month_end_close',
    name: 'Month-end close coordination',
    category: 'finance',
    turns: [
      {
        userText:
          'It is month-end. Coordinate reconciliation, owner statements, and TRA royalty-return summary.',
      },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE },
  },
  {
    id: 'portfolio.emergency_after_hours',
    name: 'After-hours emergency',
    category: 'maintenance',
    turns: [
      { userText: 'It is 2am. A stope wall collapsed at the H-1 working. What do we do right now?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'portfolio.new_site_onboarding',
    name: 'Onboard new site to portfolio',
    category: 'migration',
    turns: [
      {
        userText:
          'Onboard a new site: 40 assets, foreman + maintenance team, import owner and buyers.',
      },
    ],
    expect: { expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD },
  },
];
