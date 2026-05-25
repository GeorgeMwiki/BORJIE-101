/**
 * Golden scenarios — the baseline regression suite for the Brain.
 *
 * These 30 scenarios cover the six Junior domains + the Estate Manager,
 * Coworker, and Migration Wizard. They are the minimum bar for "did we
 * break routing/visibility/handoff in the last change?"
 *
 * This is Phase 1 of the eval harness. The eventual target (per the
 * architecture plan) is 200+ scenarios including synthetic fixtures from
 * a simulation estate. Adding more scenarios later is cheap; shipping
 * the harness with a non-trivial baseline is the important move.
 */

import { Scenario } from './scenario.js';
import { PERSONA_IDS } from '../personas/persona.js';

export const GOLDEN_SCENARIOS: Scenario[] = [
  // ---------------- Leasing ----------------
  {
    id: 'leasing.renewal_due',
    name: 'Admin asks about upcoming renewals',
    category: 'leasing',
    turns: [
      {
        userText:
          'Which leases are expiring in the next 60 days and what renewal pricing should we propose?',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
    tags: ['renewal', 'portfolio'],
  },
  {
    id: 'leasing.draft_renewal_requires_advisor',
    name: 'Drafting a lease renewal routes through advisor',
    category: 'leasing',
    turns: [
      {
        userText:
          'Draft a renewal letter for lease L-4421 with a 5% increase.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
    tags: ['renewal', 'advisor'],
  },
  {
    id: 'leasing.move_out_inspection',
    name: 'Schedule move-out inspection',
    category: 'leasing',
    turns: [
      { userText: 'Tenant in unit B-12 is moving out Friday. Set up inspection.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },

  // ---------------- Maintenance ----------------
  {
    id: 'maintenance.water_leak_emergency',
    name: 'Emergency water leak triage',
    category: 'maintenance',
    turns: [
      {
        userText:
          'Tenant in A-5 reports a burst pipe; water is pouring into the unit below.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH', verbRegex: '(dispatch|assign|escalate)' },
    },
  },
  {
    id: 'maintenance.plumber_assignment',
    name: 'Assign plumber to work order',
    category: 'maintenance',
    turns: [
      { userText: 'Work order WO-189 needs a plumber. Who should we send?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'maintenance.vendor_score_query',
    name: 'Vendor performance review',
    category: 'maintenance',
    turns: [
      { userText: "How has vendor Juma's Electrical been performing lately?" },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectToolCalls: ['get_vendor_scorecard'],
    },
  },

  // ---------------- Finance ----------------
  {
    id: 'finance.arrears_list',
    name: 'Arrears summary and notices',
    category: 'finance',
    turns: [
      {
        userText:
          'Show me tenants in arrears >30 days at Block A and draft firm notices.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.mpesa_reconcile',
    name: 'M-Pesa reconciliation for the month',
    category: 'finance',
    turns: [
      {
        userText:
          "Reconcile last month's M-Pesa paybill statement against the ledger for Block A.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.mpesa_reconcile'],
    },
  },
  {
    id: 'finance.kra_filing',
    name: 'KRA monthly rental income summary',
    category: 'finance',
    turns: [
      {
        userText:
          'Prepare the KRA MRI summary for March 2026 so I can file by the 20th.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.kra_rental_summary'],
    },
  },
  {
    id: 'finance.service_charge_reconcile',
    name: 'Service charge variance for property',
    category: 'finance',
    turns: [
      {
        userText:
          'Reconcile Kilimani Heights service charge for March against budget and show overruns.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.service_charge_reconcile'],
    },
  },
  {
    id: 'finance.owner_statement',
    name: 'Owner statement for a portfolio',
    category: 'finance',
    turns: [
      { userText: "Generate owner Mwangi's March statement and email it." },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'finance.refund_advisor',
    name: 'Large refund triggers advisor + HIGH review',
    category: 'finance',
    turns: [
      {
        userText:
          'Process a refund of KES 180,000 to tenant T-221 for overpaid deposit.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },

  // ---------------- Compliance ----------------
  {
    id: 'compliance.eviction_notice',
    name: 'Eviction drafting requires advisor + HIGH',
    category: 'compliance',
    turns: [
      {
        userText:
          'Draft an eviction notice for tenant in unit C-7 who has not paid for 4 months.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.evidence_pack',
    name: 'Court-ready evidence pack',
    category: 'compliance',
    turns: [
      { userText: 'Generate an evidence pack for case C-12 for hearing on Monday.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['generate_evidence_pack'],
    },
  },
  {
    id: 'compliance.dpa_erasure',
    name: 'DPA data-subject erasure request',
    category: 'compliance',
    turns: [
      {
        userText:
          'Tenant T-44 has submitted a data-erasure request under DPA. What do we need to do?',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'compliance.expiring_obligations',
    name: 'Expiring compliance obligations',
    category: 'compliance',
    turns: [
      { userText: 'What compliance obligations expire in the next 30 days?' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['get_parcel_compliance'],
    },
  },

  // ---------------- Communications ----------------
  {
    id: 'comms.rent_reminder_swahili',
    name: 'Gentle rent reminder in Swahili',
    category: 'communications',
    turns: [
      {
        userText:
          'Draft a gentle Swahili rent reminder to unit A-1 tenants for 31 March.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectToolCalls: ['skill.kenya.swahili_draft'],
    },
  },
  {
    id: 'comms.water_outage_broadcast',
    name: 'Water outage broadcast',
    category: 'communications',
    turns: [
      {
        userText:
          'Broadcast to all Block B tenants that water will be off tomorrow 8am-noon for tank cleaning.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.campaign_for_vacancies',
    name: 'Vacancy marketing campaign plan',
    category: 'communications',
    turns: [
      { userText: 'Plan a marketing campaign for the 3 vacant units in Kilimani Heights.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },

  // ---------------- Migration ----------------
  {
    id: 'migration.upload_roster',
    name: 'Upload employee + property roster',
    category: 'migration',
    turns: [
      {
        userText:
          "I'm uploading our employee roster and property list from our old system. Please extract and populate.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'migration.handwritten_ledger_photos',
    name: 'Photos of handwritten ledger',
    category: 'migration',
    turns: [
      {
        userText:
          'I have photos of our handwritten rent ledger for the last 6 months. Can you make sense of them?',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
    },
  },

  // ---------------- Estate Manager portfolio ----------------
  {
    id: 'manager.portfolio_overview',
    name: 'Portfolio overview',
    category: 'leasing',
    turns: [{ userText: 'Give me the state of the portfolio right now.' }],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      expectToolCalls: ['get_portfolio_overview'],
    },
  },
  {
    id: 'manager.cross_domain_handoff',
    name: 'Cross-domain query triggers handoff',
    category: 'leasing',
    turns: [
      {
        userText:
          'Unit D-2: is the tenant in arrears and does the lease have a late-fee clause?',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      expectHandoffs: [
        { from: PERSONA_IDS.ESTATE_MANAGER, to: PERSONA_IDS.JUNIOR_FINANCE },
      ],
    },
  },

  // ---------------- Coworker ----------------
  {
    id: 'coworker.how_do_i_triage',
    name: 'Employee asks how to triage',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
        userText: 'Tenant called about a leaking kitchen tap. How do I triage this?',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
    },
  },
  {
    id: 'coworker.draft_swahili_reply',
    name: 'Employee asks for Swahili reply',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
        userText:
          'Draft a short Swahili reply to tenant T-100 confirming the plumber will come tomorrow at 10am.',
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
      expectToolCalls: ['skill.kenya.swahili_draft'],
    },
  },
  {
    id: 'coworker.request_permission',
    name: 'Employee asks coworker to request permission',
    category: 'coworker',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
        userText:
          "I need to authorize a KES 12,000 emergency repair. Can you ask my manager for permission?",
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },

  // ---------------- Governance regressions ----------------
  {
    id: 'governance.disallowed_tool',
    name: 'Leasing persona cannot call mpesa_reconcile directly',
    category: 'governance',
    turns: [
      { userText: 'Reconcile the M-Pesa statement as part of lease renewal.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_LEASING,
      expectHandoffs: [
        { from: PERSONA_IDS.JUNIOR_LEASING, to: PERSONA_IDS.JUNIOR_FINANCE },
      ],
    },
  },
  {
    id: 'governance.private_coworker_stays_private',
    name: 'Coworker private note is not promoted without request',
    category: 'governance',
    turns: [
      {
        forcePersonaId: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
        userText: "Note to self: the tenant in A-3 seems frustrated today.",
      },
    ],
    expect: {
      expectInitialPersona: `${PERSONA_IDS.COWORKER_FAMILY}.EMP-001`,
    },
  },
  {
    id: 'governance.termination_advisor',
    name: 'Termination language always triggers advisor + HIGH',
    category: 'governance',
    turns: [
      {
        userText:
          'I want to terminate the lease for unit E-4 at the end of the month.',
      },
    ],
    expect: {
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'governance.handoff_depth_cap',
    name: 'Handoff depth remains bounded under circular intent',
    category: 'governance',
    turns: [
      {
        userText:
          "Coordinate leasing, maintenance, and finance for a major turnover of 12 units next month.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      maxTokens: 20_000,
    },
  },
];
