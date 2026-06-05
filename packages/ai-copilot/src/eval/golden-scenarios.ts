/**
 * Golden scenarios — the baseline regression suite for the Brain.
 *
 * These 30 scenarios cover the six Junior domains + the Estate Manager,
 * Coworker, and Migration Wizard. They are the minimum bar for "did we
 * break routing/visibility/handoff in the last change?"
 *
 * This is Phase 1 of the eval harness. The eventual target (per the
 * architecture plan) is 200+ scenarios including synthetic fixtures from
 * a simulation mining estate. Adding more scenarios later is cheap; shipping
 * the harness with a non-trivial baseline is the important move.
 *
 * Note: `category` values reuse the `Scenario` union from `scenario.ts`
 * (e.g. `'leasing'` is the offtake-domain bucket); the user-facing content
 * (ids, names, prompts, tools) is mining.
 */

import { Scenario } from './scenario.js';
import { PERSONA_IDS } from '../personas/persona.js';

export const GOLDEN_SCENARIOS: Scenario[] = [
  // ---------------- Offtake ----------------
  {
    id: 'offtake.renewal_due',
    name: 'Admin asks about upcoming supply-agreement renewals',
    category: 'leasing',
    turns: [
      {
        userText:
          'Which supply agreements are expiring in the next 60 days and what renewal pricing should we propose against the LBMA fix?',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
    tags: ['renewal', 'portfolio'],
  },
  {
    id: 'offtake.draft_renewal_requires_advisor',
    name: 'Drafting a supply-agreement renewal routes through advisor',
    category: 'leasing',
    turns: [
      {
        userText:
          'Draft a renewal letter for supply agreement A-4421 with a 5% premium increase.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectAdvisorConsulted: true,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
    tags: ['renewal', 'advisor'],
  },
  {
    id: 'offtake.dispatch_inspection',
    name: 'Schedule consignment dispatch inspection',
    category: 'leasing',
    turns: [
      { userText: 'Buyer for consignment C-12 is collecting Friday. Set up the dispatch inspection.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },

  // ---------------- Maintenance ----------------
  {
    id: 'maintenance.water_inrush_emergency',
    name: 'Emergency dewatering-pump failure triage',
    category: 'maintenance',
    turns: [
      {
        userText:
          'The dewatering pump at the pit has failed; water is rising fast on the lower bench.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectProposedAction: { riskAtLeast: 'HIGH', verbRegex: '(dispatch|assign|escalate)' },
    },
  },
  {
    id: 'maintenance.fitter_assignment',
    name: 'Assign fitter to work order',
    category: 'maintenance',
    turns: [
      { userText: 'Work order WO-189 needs a fitter for the crusher. Who should we send?' },
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
      { userText: "How has vendor Juma's Engineering been performing lately?" },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_MAINTENANCE,
      expectToolCalls: ['get_vendor_scorecard'],
    },
  },

  // ---------------- Finance ----------------
  {
    id: 'finance.outstanding_royalty_list',
    name: 'Outstanding-royalty summary and notices',
    category: 'finance',
    turns: [
      {
        userText:
          'Show me buyers with royalties outstanding >30 days at the Geita site and draft firm notices.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'finance.gepg_reconcile',
    name: 'GePG reconciliation for the month',
    category: 'finance',
    turns: [
      {
        userText:
          "Reconcile last month's GePG royalty payments against the ledger for the Geita site.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.mpesa_reconcile'],
    },
  },
  {
    id: 'finance.tra_filing',
    name: 'TRA monthly royalty-return summary',
    category: 'finance',
    turns: [
      {
        userText:
          'Prepare the TRA royalty-return summary for March 2026 so I can file on time.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_FINANCE,
      expectToolCalls: ['skill.kenya.tra_royalty_summary'],
    },
  },
  {
    id: 'finance.cooperative_levy_reconcile',
    name: 'Cooperative-levy variance for site',
    category: 'finance',
    turns: [
      {
        userText:
          'Reconcile the Chunya cooperative levy for March against budget and show overruns.',
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
      { userText: "Generate owner Mwita's March statement and email it." },
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
          'Process a refund of TSh 180,000,000 to buyer B-221 for an overpaid performance bond.',
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
    id: 'compliance.suspension_notice',
    name: 'Licence-suspension drafting requires advisor + HIGH',
    category: 'compliance',
    turns: [
      {
        userText:
          'Draft a default notice for buyer B-7 who has not settled royalties for 4 months.',
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
    name: 'Regulator-ready evidence pack',
    category: 'compliance',
    turns: [
      { userText: 'Generate an evidence pack for case C-12 for the Mining Commission hearing on Monday.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMPLIANCE,
      expectToolCalls: ['generate_evidence_pack'],
    },
  },
  {
    id: 'compliance.dpa_erasure',
    name: 'PDPA data-subject erasure request',
    category: 'compliance',
    turns: [
      {
        userText:
          'Buyer B-44 has submitted a data-erasure request under the PDPA. What do we need to do?',
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
    id: 'comms.royalty_reminder_swahili',
    name: 'Gentle royalty reminder in Swahili',
    category: 'communications',
    turns: [
      {
        userText:
          'Draft a gentle Swahili royalty reminder to buyer B-1 for 31 March.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectToolCalls: ['skill.kenya.swahili_draft'],
    },
  },
  {
    id: 'comms.plant_shutdown_broadcast',
    name: 'Plant-shutdown broadcast',
    category: 'communications',
    turns: [
      {
        userText:
          'Broadcast to all Geita buyers that the gold room will be closed tomorrow 8am-noon for an audit.',
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },
  {
    id: 'comms.campaign_for_consignments',
    name: 'Consignment marketing campaign plan',
    category: 'communications',
    turns: [
      { userText: 'Plan a marketing campaign for the 3 unsold doré consignments at the Geita site.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
      expectProposedAction: { riskAtLeast: 'MEDIUM' },
    },
  },

  // ---------------- Migration ----------------
  {
    id: 'migration.upload_roster',
    name: 'Upload employee + asset roster',
    category: 'migration',
    turns: [
      {
        userText:
          "I'm uploading our employee roster and asset list from our old system. Please extract and populate.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.MIGRATION_WIZARD,
      expectProposedAction: { riskAtLeast: 'HIGH' },
    },
  },
  {
    id: 'migration.handwritten_ledger_photos',
    name: 'Photos of handwritten production ledger',
    category: 'migration',
    turns: [
      {
        userText:
          'I have photos of our handwritten production ledger for the last 6 months. Can you make sense of them?',
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
          'Consignment C-2: is the buyer behind on royalties and does the agreement have a default-interest clause?',
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
        userText: 'A fitter called about a leaking hydraulic line on the excavator. How do I triage this?',
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
          'Draft a short Swahili reply to buyer B-100 confirming the fitter will come tomorrow at 10am.',
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
          "I need to authorize a TSh 12,000,000 emergency repair. Can you ask my manager for permission?",
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
    name: 'Offtake persona cannot call gepg_reconcile directly',
    category: 'governance',
    turns: [
      { userText: 'Reconcile the GePG payments as part of the supply-agreement renewal.' },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.JUNIOR_OFFTAKE,
      expectHandoffs: [
        { from: PERSONA_IDS.JUNIOR_OFFTAKE, to: PERSONA_IDS.JUNIOR_FINANCE },
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
        userText: "Note to self: the buyer at the gold room seems frustrated today.",
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
          'I want to terminate the supply agreement for consignment E-4 at the end of the month.',
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
          "Coordinate offtake, maintenance, and finance for a major dispatch of 12 consignments next month.",
      },
    ],
    expect: {
      expectInitialPersona: PERSONA_IDS.ESTATE_MANAGER,
      maxTokens: 20_000,
    },
  },
];
