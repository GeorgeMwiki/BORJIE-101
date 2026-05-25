import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_03_MIXED_USE_FLIP = defineCaseStudy({
  id: 'cs-03-nairobi-mixed-use-zoning-flip',
  title: 'The Nairobi mixed-use zoning flip: a value-add playbook',
  wordCount: 1050,
  country: 'KE',
  tags: ['value-add', 'zoning', 'conversion', 'mixed-use', 'playbook'],
  difficulty: 'expert',
  narrative: `In early 2026 the Nairobi County zoning policy update extends mixed-use allowances along an upper stretch of Ngong Road. What was a C1 (commercial office / retail) band for 40 years can now host R2 (high-density residential) on floors 2 and above, with ground-floor retail retained. A value-add fund, Njia Capital, spots the opportunity three weeks before most brokers do.

The target: Aspen House, a 9-storey commercial block built 1998, total NLA 6,800 sqm, 65 percent leased, weighted lease term 1.8 years. Six tenants; two anchor (a law firm and an auditing firm), four smaller. The building sits on a 0.4-hectare corner plot next to a Nakumatt-era retail plaza now trading as a Quickmart. The seller is a mid-tier pension fund rebalancing out of legacy office.

Asking price: Ksh 920 million. In-place NOI: Ksh 48 million (Ksh 42 M office rent, Ksh 12 M gross, Ksh 12 M opex, plus Ksh 6 M utility recoveries). Going-in cap: 5.2 percent — rich, reflecting tired office and patchy occupancy. Njia's hypothesis: convert floors 3-9 to 84 residential units (12 per floor, avg 62 sqm), retain floors 1-2 as retail + serviced office, capture the arbitrage between office trading yield (6.5-8 percent) and stabilised residential (7.5-8.5 percent) PLUS the demand pull of the Junction-adjacent residential catchment.

Capex budget, internal estimate: Ksh 680 million all-in. Soft costs, design, permits, MEP redesign (residential plumbing stacks do not exist above floor 2), fit-out, leasing commissions, and a 15 percent contingency. Timeline: 14 months construction, 8 months lease-up to 85 percent occupancy. Total hold through stabilisation: 24 months from close.

Njia's model: post-stabilisation NOI Ksh 168 M (Ksh 140 M residential on Ksh 95,000 avg rent * 84 units * 12 months * 92 percent occupancy net of opex, plus Ksh 28 M from retail and serviced office). Cap out at 7.75 percent residential-dominant = Ksh 2.17 B. Less cost base (Ksh 920 M + Ksh 680 M = Ksh 1.6 B) = Ksh 570 M value creation, roughly 36 percent on unleveraged cost, before time value.

The analyst, Kiptoo, is asked to pressure-test this before IC. He finds four weak spots. First, two of the six tenants have break clauses in month 4 and month 9 — if exercised, NOI drops to Ksh 22 M for the hold-through period. Second, the building's lift bank is end-of-life; residential conversion triggers a Ksh 42 M lift retrofit not in the capex budget. Third, the zoning update has a 9-month public-objection window during which development permissions can be challenged; Njia would close before the window expires. Fourth, residential rent comps at Ksh 95,000 for 62 sqm assume the Junction as comparable; Aspen House is 1.2 km uphill and lacks the Junction's retail catchment.

The IC meeting is Tuesday. Kiptoo has to present a go/no-go recommendation with explicit sensitivities.`,
  dataTable: {
    title: 'Aspen House — conversion underwriting',
    rows: [
      { label: 'Current use', value: '9-storey commercial office' },
      { label: 'NLA', value: '6,800 sqm' },
      { label: 'Occupancy', value: '65%' },
      { label: 'WAULT', value: '1.8 years' },
      { label: 'Asking price', value: 'Ksh 920 M' },
      { label: 'In-place NOI', value: 'Ksh 48 M' },
      { label: 'Going-in cap', value: '5.2%' },
      { label: 'Capex budget', value: 'Ksh 680 M (pre-lift)' },
      { label: 'Omitted lift retrofit', value: 'Ksh 42 M' },
      { label: 'Construction timeline', value: '14 months' },
      { label: 'Lease-up to 85%', value: '8 months' },
      { label: 'Post-stab residential units', value: '84 (floors 3-9)' },
      { label: 'Assumed residential rent / unit', value: 'Ksh 95,000 / month' },
      { label: 'Post-stab NOI (plan)', value: 'Ksh 168 M' },
      { label: 'Exit cap (plan)', value: '7.75%' },
      { label: 'Plan exit value', value: 'Ksh 2.17 B' },
    ],
  },
  decisionQuestion:
    'Kiptoo walks into IC on Tuesday. Go, no-go, or go with conditions? What is the floor price below which the deal must be?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question: 'What is a going-in cap rate, and how is it computed?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why would a fund be willing to buy at 5.2% cap when stabilised office trades at 7-8%?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the levered IRR at 55% LTV, 13% interest-only for 24 months, 1% arrangement fee.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If both break clauses are exercised, what happens to the 24-month cash flow, and what is the financing covenant impact?',
      idealAnswerSketch:
        'NOI drops to Ksh 22 M, interest cover ratio falls below 1.1x under most covenants. The deal then requires an equity top-up or an interest reserve built into close. The IC should demand the reserve.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Is the residential rent comp of Ksh 95,000 defensible given the Junction is 1.2 km downhill?',
      hint: 'Comp selection: walkability, catchment, transit.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Which of the four weak spots (break clauses, lift, zoning window, rent comp) most threatens the IRR, and why?',
      idealAnswerSketch:
        'The zoning public-objection window. All the others are bounded; zoning reversal kills the thesis outright. The IRR under a reversed conversion is negative.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'What price reduction would you need to accept all four risks and still hit a 22% unlevered IRR?',
    },
    {
      bloomLevel: 'create',
      question:
        'Design 3 conditions precedent that let Njia proceed without overpaying for the zoning risk.',
      idealAnswerSketch:
        '(1) Deferred consideration tied to zoning window expiry (Ksh 150 M of price held in escrow for 9 months); (2) lift retrofit seller-funded via price reduction; (3) break-clause termination fees assigned to buyer.',
    },
  ],
  activity: {
    prompt:
      'You are Kiptoo. Prepare IC memo (1 page) + scenario table (base / bear / bull) with explicit break-clause outcomes and a go/no-go ladder by price.',
    deliverable: 'Memo + 3-scenario NOI and IRR grid.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: '5-scenario sensitivity to residential rent and lease-up pace',
    setup:
      'Build a 5x5 sensitivity grid of residential rent (Ksh 75k / 85k / 95k / 105k / 115k) against lease-up months to 85% (6 / 8 / 10 / 12 / 14). Solve for unlevered IRR at each cell.',
    expectedAnswer:
      'Base case at Ksh 95k / 8 months ~16% IRR; plan case unrealistic without recovery of break-clause space.',
    solutionSketch:
      'The sensitivity shows the deal is most sensitive to rent per sqm (slope ~1.1% IRR per 5k rent), moderately sensitive to lease-up (slope ~0.6% IRR per 2 months), and invariant to reasonable retail rent assumptions.',
  },
  discussionQuestions: [
    'How does the strategy change if Njia holds Aspen for 7 years instead of exiting at stabilisation?',
    'Would you prefer to partner with a local developer or in-source the conversion?',
    'How do you price the zoning reversal risk explicitly rather than implicitly?',
    'What is the ESG angle here, and does it matter to the LP base?',
    'If the Nairobi County zoning policy is reversed at year 3, what is your mitigation playbook?',
  ],
});
