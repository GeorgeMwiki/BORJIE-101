import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_10_FIRST_90_DAYS = defineCaseStudy({
  id: 'cs-10-first-90-days-post-mine-acquisition',
  title: 'First 90 days after a mine acquisition: what a professional operator does week by week',
  wordCount: 1120,
  country: 'BOTH',
  tags: ['post-acquisition', 'playbook', 'stabilisation', 'week-by-week', 'operations'],
  difficulty: 'advanced',
  narrative: `A regional institutional investor closes on a mining acquisition on 1 June 2026 — a producing gold operation in the Lake Zone comprising one Mining Licence with an open pit and a 600 tpd CIL plant, plus two satellite PMLs worked under cooperative tribute. Combined steady-state cash flow at close supports an enterprise valuation of roughly TZS 14.2 billion, struck at a small-producer multiple. The newly appointed general manager, Wanjala, has 90 days to deliver week-12 milestones: a reconciled production-and-sales ledger, a named superintendent for pit / plant / gold-room, a live maintenance-and-defect system, a refreshed unit-cost baseline, a rationalised contractor bench, a workforce-and-community baseline, and a board book showing month-4 onward steady-state.

Week 1 (the "take control" week) is the most important. Wanjala has to: (1) personally visit the pit, the plant, and the gold room, meet every superintendent, and photograph every critical area; (2) mirror-copy all production, metallurgical, and sales records from the seller's systems; (3) change signatories on all bank, royalty-portal, fuel, and reagent accounts, and re-register as the gold-export and royalty filer of record; (4) re-confirm the chain of custody and re-seal the gold room under dual control; (5) freeze all discretionary spend; (6) inventory the gold-room safe, the firearms register, blasting-magazine keys, and weighbridge calibration certificates; (7) take control of the explosives and reagent stores. Missing any of these creates a 90-day drag and, in the gold room and magazine, a real loss-and-safety exposure.

Week 2 — the production-and-sales reconciliation. Wanjala runs the seller's gold poured against refiner settlements and against royalty returns filed for the last 12 months. Three typical discrepancies surface: (a) poured bars whose weights do not tie to declared-and-royalty-paid value; (b) reagent and fuel consumption that exceeds the metallurgical and fleet models; (c) tonnes mined per the survey versus tonnes milled, revealing stockpile and grade-control gaps.

Weeks 3-4 — physical and metallurgical condition audit. An independent engineer and metallurgist walk the plant and inspect the tailings storage facility (TSF). They produce a defects schedule and a metallurgical balance. Wanjala cross-checks against the pre-close technical due diligence; any defect not in the diligence (a worn SAG liner set, a TSF freeboard shortfall) goes into the year-1 sustaining-capital plan.

Week 5 — superintendent reset. Either re-hire the incumbent superintendents under new terms, or replace. The reset is critical: the gold-room and stores supervisors will test the new GM in the first 30 days with small asks (advances, "preferred" suppliers, favours). Wanjala has to set the precedent that discretionary spend and any gold-room procedure change require written approval.

Week 6 — contractor bench. Audit every mining-services and supply contract. Terminate phantom or single-sourced ones. Issue tenders for the top recurring categories (load-and-haul, drill-and-blast, fuel, reagents). Set quarterly performance reviews tied to survey-verified volumes.

Weeks 7-8 — workforce and community outreach. Wanjala holds shift briefings, meets the union/workers' representatives, and sits down with the cooperative leaders on the two tribute PMLs and the ward leadership. Open question to each: "What one thing about this operation should be better?" Local-content and grievance issues surface here, not in the data room.

Week 9 — unit-cost reset. Rebase the all-in cost per ounce using actual 8-week post-close data annualised. Identify the 3 biggest surprises versus the seller's representation. Typical surprise: cash cost is higher than the model because the seller deferred liner changes and ran the plant hard before sale.

Week 10 — receivables-and-royalty sweep. Categorise every unsettled parcel and open royalty return as (a) collectable on plan, (b) escalation, (c) write-down. Bring every royalty filing current on the Mining Commission portal. Set targets per category.

Week 11 — systems. Production-accounting, metallurgical-balance, maintenance, and the gold-room reconciliation platforms all live with full data. No shadow spreadsheets in the gold room.

Week 12 — board book. Wanjala presents the 90-day summary, the rebased unit cost, the year-1 sustaining-capital plan, the workforce-and-community baseline, the contractor-bench changes, and the year-2 steady-state production-and-cash projection.

The 90-day plan always sounds simple in theory. In practice it has three failure modes: gold-room and stores politics (week 5), production-and-sales surprise pockets (week 2), and board drift (week 12). Wanjala's predecessor on a similar deal burned 6 months because he skipped week 1 and let the gold-room supervisor set the cadence.`,
  dataTable: {
    title: 'First 90 days — 12 milestones',
    rows: [
      { label: 'Week 1', value: 'Take control: site visits, record mirror, signatories, gold-room re-seal' },
      { label: 'Week 2', value: 'Production-and-sales reconciliation vs refiner + royalty returns' },
      { label: 'Weeks 3-4', value: 'Physical + metallurgical audit; TSF inspection; defects schedule' },
      { label: 'Week 5', value: 'Superintendent reset + discretionary-spend policy' },
      { label: 'Week 6', value: 'Contractor bench audit + tenders' },
      { label: 'Weeks 7-8', value: 'Workforce + community + cooperative outreach' },
      { label: 'Week 9', value: 'All-in unit-cost rebase' },
      { label: 'Week 10', value: 'Receivables + royalty sweep, bring filings current' },
      { label: 'Week 11', value: 'Production / metallurgical / gold-room systems go-live' },
      { label: 'Week 12', value: 'Board book + year-2 plan' },
      { label: 'Assets', value: '1 ML (pit + 600 tpd CIL) + 2 tribute PMLs' },
      { label: 'Enterprise value at close', value: 'TZS 14.2 B' },
    ],
  },
  decisionQuestion:
    'What are the week-1 non-negotiables Wanjala cannot skip, and what is her contingency if she finds a major surprise in the week-2 production-and-sales reconciliation?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the purpose of the week-1 gold-room re-seal under dual control?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why does changing signatories and the royalty-filer-of-record rank so high on week-1 priorities?',
      idealAnswerSketch:
        'Because a missed change means the seller\'s staff retain spend and gold-dispatch authority and the royalty obligation sits with the wrong filer. The financial-and-statutory control gap is the single biggest source of post-close surprise and compliance exposure in mining.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design the week-1 checklist for an operation with a pit, a 600 tpd plant, a gold room, and two tribute PMLs.',
      idealAnswerSketch:
        'A 20-item list covering: site visits, signatory + royalty-filer change, gold-room re-seal under dual control, safe/firearms/magazine inventory, weighbridge calibration check, freeze on discretionary spend, mirror production-metallurgical-sales records, first superintendent standup, cooperative-leader courtesy call, and bookings for the week-2 reconciliation and week-3 metallurgical/TSF audit.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If week 2 reveals TZS 1 billion of poured gold that does not tie to declared-and-royalty-paid value, what are Wanjala\'s next 3 steps?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Why must the superintendent reset (week 5) happen before the contractor bench (week 6)?',
      idealAnswerSketch:
        'Because superintendents drive contractor introductions. Resetting them first ensures the contractor tenders are not biased toward existing kickback relationships at the pit or in stores.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three failure modes (gold-room/stores politics, production-and-sales surprise, board drift) is hardest to recover from mid-stride?',
      idealAnswerSketch:
        'Gold-room and stores politics. It compounds: every delayed reset entrenches the supervisor\'s authority over the metal and consumables and weakens the new GM\'s control of the highest-value, easiest-to-skim point in the operation.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is it ever right to skip the week-1 site visit in favour of a "paper start"?',
      idealAnswerSketch:
        'No. The site visit is a signalling act as much as an informational one. Skipping it tells the crews, the gold room, and the community that the new owner is an absentee — exactly the impression that lets a skim survive.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design the board-book outline for week 12.',
      idealAnswerSketch:
        'Executive summary; pre-close vs post-close cash-flow walk; year-1 sustaining-capital and TSF plan; contractor-bench changes with savings; workforce-and-community baseline; receivables-and-royalty waterfall with all filings current; 3 risks + mitigations; year-2 steady-state production and cash with price and recovery sensitivities.',
    },
  ],
  activity: {
    prompt:
      'You are Wanjala. Produce the full 90-day plan as a Gantt chart + the week-1 non-negotiables as a 15-item checklist + the escalation protocol for a mid-period gold-discrepancy surprise.',
    deliverable: 'Gantt + checklist + escalation protocol.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: 'Cost of delay',
    setup:
      'If Wanjala delays week-1 take-control by 14 days, quantify the expected loss via (a) continued discretionary spend at the seller\'s rate, (b) gold-room skim before the re-seal, and (c) the reagent/fuel over-billing window.',
    expectedAnswer:
      'A 14-day delay on this operation can cost TZS 150-350 M once gold-room skim and reagent over-billing are included — typically several days of margin and, in the gold room, potentially much more.',
    solutionSketch:
      'The cost is almost never in the IC model; it is in the gap between close and take-control. In mining specifically, the gold room and the reagent store are the high-velocity leakage points — the cost of a delayed re-seal is not linear, it is a tail risk on the single most valuable point in the operation.',
  },
  discussionQuestions: [
    'How does Wanjala balance workforce-reassurance outreach with the production-and-sales scrutiny in week 2?',
    'What signals tell her a superintendent is cooperative versus defensive?',
    'How does the plan change if the operation is in a boundary dispute with an artisanal community or a neighbouring licence?',
    'What metrics does Wanjala commit to report to the board weekly during the first 90 days?',
    'At week 12, what is the ONE question the board chair should ask Wanjala?',
  ],
});
