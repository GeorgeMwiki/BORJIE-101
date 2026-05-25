import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_09_DAR_REFURB_DIVEST = defineCaseStudy({
  id: 'cs-09-dar-block-refurb-or-divest',
  title: 'Refurbish or divest? The 40-year-old Dar block decision',
  wordCount: 940,
  country: 'TZ',
  tags: ['refurb', 'divest', 'capex', 'roi', 'sensitivity'],
  difficulty: 'advanced',
  narrative: `Upanga Heights is a 48-unit apartment block built in 1984 on a 0.35-hectare plot near the Upanga corridor in Dar es Salaam. Current owner: the Mkapa family trust, third generation. Weighted average rent: Tsh 420,000 per month. Occupancy: 71 percent. Gross potential rent: Tsh 242 M per year. Effective gross: Tsh 172 M. OPEX: Tsh 78 M. NOI: Tsh 94 M. The block has a tired 1980s aesthetic, a borehole that fails monthly, split-AC units the tenants installed themselves, and no lift (the lift shaft exists but the equipment was never installed).

The trustees face five scenarios presented by their advisor, Abdul.

Scenario A — status quo. Do nothing. NOI stays roughly flat (2 percent growth per year). Occupancy drifts down to 65 percent by year 5 as the block ages out relative to competing stock. Terminal value at year 10: Tsh 1.15 B.

Scenario B — light refurb. Tsh 280 M. New borehole + water treatment + repaint + shared AC retrofit + landscape. Timeline: 6 months. Uplift: Tsh 60k per unit on renewals, occupancy to 85 percent within 12 months. Year-2 NOI: Tsh 146 M. Terminal value at year 10: Tsh 1.85 B.

Scenario C — heavy refurb. Tsh 720 M. Full MEP redesign, lift installation, unit-level renovation, external modernisation. Timeline: 14 months + 6-month lease-up. Uplift: Tsh 180k per unit on renewal, occupancy 92 percent. Year-3 NOI: Tsh 228 M. Terminal value at year 10: Tsh 2.82 B.

Scenario D — redevelopment. Demolish and build a new 96-unit mid-market block on the same plot. Budget: Tsh 6.8 B all-in including demolition, 3-year timeline. Year-4 stabilised NOI: Tsh 576 M. Terminal value at year 10: Tsh 6.9 B. Requires project finance + family capital call of Tsh 2.5 B.

Scenario E — divest. Sell the block as-is. Indicative valuation at 8.2% cap on current NOI: Tsh 1.15 B. Transaction costs: 4%. Net: Tsh 1.10 B.

The trust has Tsh 650 M of liquid reserves, moderate appetite for debt (max 45 percent LTV on any refurb), and no appetite for project finance. Three of five trustees are over 70 and want income now. Two are in their 40s and want growth + legacy. The chairman, Mr. Mkapa Jr., has called a decision meeting in 10 days.

Abdul\'s job is to rank the scenarios with explicit NPV, IRR, and narrative, honouring both the financial case and the family\'s internal tensions.`,
  dataTable: {
    title: 'Upanga Heights — 5 scenarios',
    rows: [
      { label: 'Current NOI', value: 'Tsh 94 M' },
      { label: 'A: Status quo Y10 terminal', value: 'Tsh 1.15 B' },
      { label: 'B: Light refurb capex / Y10 terminal', value: 'Tsh 280 M / Tsh 1.85 B' },
      { label: 'C: Heavy refurb capex / Y10 terminal', value: 'Tsh 720 M / Tsh 2.82 B' },
      { label: 'D: Redevelop capex / Y10 terminal', value: 'Tsh 6.8 B / Tsh 6.9 B' },
      { label: 'E: Divest net proceeds', value: 'Tsh 1.10 B' },
      { label: 'Trust liquidity', value: 'Tsh 650 M' },
      { label: 'Max LTV tolerance', value: '45%' },
      { label: 'Trustee generational split', value: '3 income-now / 2 growth' },
    ],
  },
  decisionQuestion:
    'Which scenario does Abdul recommend, and how does he present it to a split family board?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the difference between NPV and IRR, in one sentence each?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is Scenario D (redevelop) essentially a different asset class from the other four?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the IRR of Scenario B (light refurb) over 10 years at 12% discount.',
      idealAnswerSketch:
        'Cash out -280 year 0; NOI ramp 94 -> 146 (year 2) -> 3% growth; terminal 1.85B year 10. Unlevered IRR ~18-20%.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the IRR of Scenario C with 40% debt at 14% interest and 10-year amortisation.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which scenario dominates on risk-adjusted return, and why?',
      idealAnswerSketch:
        'Scenario B usually wins on risk-adjusted basis: moderate capex, proven playbook, 18-20% unlevered IRR, within liquidity envelope, no project-finance dependence. C is higher return but higher execution risk.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'How does the trustee split (3 income / 2 growth) change the ranking?',
      idealAnswerSketch:
        'A family weighted 3-2 toward income-now will reject Scenarios C and D on dividend-suppression grounds during the refurb years. Scenario B becomes the consensus path because it restores dividends within 18 months.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is Scenario E (divest) ever the right answer?',
      idealAnswerSketch:
        'Yes if: (a) the family has better uses for Tsh 1.10 B elsewhere, or (b) the underlying thesis on Upanga-corridor rents is bearish. Absent those, divesting at status-quo cap is leaving value on the table.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a governance proposal that lets the family do Scenario B now and Scenario C in year 5 as a second phase.',
      idealAnswerSketch:
        'Phase-1 Scenario B funded from liquidity. Phase-2 decision triggered by year-4 NOI > Tsh 140 M + occupancy > 88%. Phase-2 financed 50/50 reinvested NOI + modest debt. Family vote required at phase-2 trigger.',
    },
  ],
  activity: {
    prompt:
      'You are Abdul. Produce the 2-page board memo with ranked scenarios, financial summary, and a recommended path that bridges the generational split.',
    deliverable: 'Memo + 5-scenario NPV/IRR table + 1-slide decision tree.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: '5-scenario sensitivity to occupancy and rent uplift',
    setup:
      'Build a sensitivity grid on occupancy (70/80/85/90/92) against rent uplift (Tsh 40k/60k/100k/150k/180k). Compute year-3 NOI for each cell.',
    expectedAnswer:
      'Heatmap with status-quo, light-refurb, and heavy-refurb regions visible.',
    solutionSketch:
      'The sensitivity shows that occupancy uplift is worth more than rent uplift per 10% move at current rent levels. Prioritise occupancy-driving capex.',
  },
  discussionQuestions: [
    'How does Abdul handle a trustee who insists on Scenario D despite the capital constraint?',
    'What is the communication plan to tenants during a 6-month refurb?',
    'Should the family consider a joint-venture partner for Scenario C or D?',
    'How does tax treatment of the capex differ between light refurb and heavy refurb?',
    'If Upanga corridor rents fall 10% over 5 years, which scenarios survive?',
  ],
});
