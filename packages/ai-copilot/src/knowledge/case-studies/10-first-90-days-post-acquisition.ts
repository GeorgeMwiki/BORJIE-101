import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_10_FIRST_90_DAYS = defineCaseStudy({
  id: 'cs-10-first-90-days-post-acquisition',
  title: 'First 90 days after acquisition: what a professional asset-manager does week by week',
  wordCount: 1100,
  country: 'BOTH',
  tags: ['post-acquisition', 'playbook', 'stabilisation', 'week-by-week', 'operations'],
  difficulty: 'advanced',
  narrative: `A regional institutional investor closes on a 90-unit portfolio acquisition on 1 June 2026 — three blocks in Westlands, a single 5-storey block in Kilimani, and a 24-unit walk-up in Parklands. Combined in-place NOI at close: Ksh 118 M. Purchase price: Ksh 1.42 B. Going-in cap: 8.3 percent.

The newly appointed asset manager, Wanjala, has 90 days to deliver week-12 milestones: reconciled rent roll, named caretaker at each block, live maintenance-ticket system, refreshed OPEX baseline, vendor bench rationalisation, tenant-satisfaction baseline, and an investment committee board book showing month-4 onward steady-state.

Week 1 (the "take control" week) is the most important. Wanjala has to: (1) personally visit every block, introduce herself to every caretaker, and photograph every common area; (2) mirror-copy all financial records from seller\'s systems; (3) change signatory on all utility and service-charge accounts; (4) send the "new management" letter to every tenant via WhatsApp, SMS, and physical notice; (5) freeze all discretionary spend; (6) inventory keys, masters, and overrides; (7) re-key the letting office. Missing any of these creates a 90-day drag.

Week 2 — the rent-roll reconciliation. Wanjala runs the seller\'s rent roll against bank statements for the last 12 months. Three typical discrepancies surface: (a) tenants paying off-schedule with side-deals unknown to seller; (b) 4-6 "ghost" payments that cannot be matched to a tenant; (c) 2-3 legitimate tenants whose leases are expired but who have been paying at the same rate.

Week 3-4 — physical condition audit. Independent building surveyor walks every unit. Produces a defects schedule by unit, by common area. Wanjala cross-checks against the pre-close capex audit. Any defects that were not in the audit get added to the year-1 capex plan.

Week 5 — caretaker reset. Either re-hire the incumbent caretakers under new terms, or replace. The reset is critical: caretakers will test the new asset manager in the first 30 days with small requests (salary advances, vendor recommendations, favours). Wanjala has to set the precedent that discretionary spend requires written approval.

Week 6 — vendor bench. Audit all existing maintenance vendors. Terminate the phantom ones. Issue RFPs for the top-3 recurring trades (plumbing, electrical, security). Set up quarterly performance reviews.

Week 7-8 — tenant outreach. Wanjala personally calls every tenant in the 30-unit Kilimani block (it is the most problematic). Shorter outreach for Westlands and Parklands. Open-ended question: "What one thing about this building should be better?"

Week 9 — OPEX reset. Rebase OPEX using actual 8-week post-close data annualised. Identify the 3 biggest surprises vs seller\'s representation. Typical surprise: utility pass-throughs are 12-18 percent lower than seller\'s P&L because seller was cross-subsidising service charge from rent.

Week 10 — arrears sweep. Categorize every arrears case as (a) payment plan viable, (b) legal escalation, (c) write-off. Set targets per category.

Week 11 — systems. Portfolio management system, tenant-portal app, maintenance ticket platform — all live with full data. No shadow spreadsheets.

Week 12 — IC board book. Wanjala presents the 90-day summary, the rebased OPEX, the year-1 capex plan, the tenant-satisfaction baseline, the vendor-bench changes, and the year-2 stabilised NOI projection.

The 90-day plan always sounds simple in theory. In practice it has three failure modes: caretaker politics (week 5), rent-roll surprise pockets (week 2), and board drift (week 12). Wanjala\'s predecessor on a similar deal burned 6 months because he skipped week 1 and let caretakers set the cadence.`,
  dataTable: {
    title: 'First 90 days — 12 milestones',
    rows: [
      { label: 'Week 1', value: 'Take control: site visits, record mirror, signatories' },
      { label: 'Week 2', value: 'Rent-roll reconciliation vs bank statements' },
      { label: 'Weeks 3-4', value: 'Physical-condition audit + defects schedule' },
      { label: 'Week 5', value: 'Caretaker reset + discretionary-spend policy' },
      { label: 'Week 6', value: 'Vendor bench audit + RFPs' },
      { label: 'Weeks 7-8', value: 'Tenant outreach (personal calls)' },
      { label: 'Week 9', value: 'OPEX rebase' },
      { label: 'Week 10', value: 'Arrears sweep + categorisation' },
      { label: 'Week 11', value: 'Systems go-live' },
      { label: 'Week 12', value: 'IC board book + year-2 plan' },
      { label: 'Units total', value: '90 across 3 blocks + 1 walk-up' },
      { label: 'In-place NOI at close', value: 'Ksh 118 M' },
      { label: 'Going-in cap', value: '8.3%' },
    ],
  },
  decisionQuestion:
    'What are the week-1 non-negotiables Wanjala cannot skip, and what is her contingency if she finds a major surprise in week 2?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the purpose of the week-1 site visit?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why does changing signatories on utility accounts rank so high on week-1 priorities?',
      idealAnswerSketch:
        'Because a missed signatory change means the seller\'s staff retain spend authority. Financial control gap is the single biggest source of post-close surprise.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design the week-1 checklist for a 90-unit portfolio across 4 buildings.',
      idealAnswerSketch:
        '20-item list covering: site visits, signatory change, key inventory, letter to tenants, freeze on discretionary spend, mirror financials, first caretaker standup, week-2 surveyor booking, week-3 rent-roll audit booking, week-4 vendor-audit booking.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If week-2 reveals Ksh 3 M of unexplained "ghost" payments, what are Wanjala\'s next 3 steps?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Why does caretaker reset (week 5) have to happen before vendor bench (week 6)?',
      idealAnswerSketch:
        'Because caretakers drive vendor introduction. Resetting caretakers first ensures vendor RFPs are not biased toward existing kickback relationships.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three failure modes (caretaker politics, rent-roll surprise, board drift) is hardest to recover from mid-stride?',
      idealAnswerSketch:
        'Caretaker politics. It compounds: every delayed reset entrenches the caretaker\'s authority and weakens the new manager.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is it ever right to skip the week-1 site visit in favour of a "paper start"?',
      idealAnswerSketch:
        'No. The site visit is a signalling act more than an informational one. Skipping it tells caretakers and tenants that the new owner is an absentee.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design the IC board book outline for week 12.',
      idealAnswerSketch:
        'Exec summary; pre-close vs post-close NOI walk; capex plan year 1-3; vendor-bench changes with savings; tenant-satisfaction baseline; arrears waterfall; 3 risks + mitigations; year-2 stabilised NOI with sensitivities.',
    },
  ],
  activity: {
    prompt:
      'You are Wanjala. Produce the full 90-day plan as a Gantt chart + the week-1 non-negotiables as a 15-item checklist + the escalation protocol for a mid-period surprise.',
    deliverable: 'Gantt + checklist + escalation protocol.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: 'Cost of delay',
    setup:
      'If Wanjala delays week-1 take-control by 14 days, quantify the expected loss via (a) continued discretionary spend at seller\'s rate, (b) unbanked rent, (c) vendor over-billing window.',
    expectedAnswer:
      'Typical 14-day delay costs Ksh 800k-1.4 M on a 90-unit portfolio — equivalent to 2-3 weeks of NOI.',
    solutionSketch:
      'The cost is almost never in the IC model; it is in the gap between close and take-control.',
  },
  discussionQuestions: [
    'How does Wanjala balance tenant-reassurance outreach with rent-roll scrutiny in week 2?',
    'What signals tell her a caretaker is cooperative vs defensive?',
    'How does the plan change if one building is in structural dispute with its neighbours?',
    'What metrics does Wanjala commit to report to IC weekly during the first 90 days?',
    'At week 12, what is the ONE question the IC chair should ask Wanjala?',
  ],
});
