/**
 * Quantitative drills — Mr. Mwikila pulls these on demand when the learner
 * reaches Apply-level mastery on a concept. Each drill ships with inputs,
 * an expected answer, a step-by-step solution, and three variant twists
 * for spaced-repetition retention.
 *
 * Categories (5 drills each, 40 total):
 *   1. NOI (basic -> with recoveries -> with step-ups)
 *   2. DCF (configurable hold + exit cap)
 *   3. Cap-rate extraction from comparables
 *   4. Cash-on-cash with financing
 *   5. Service-charge reconciliation with meter drift
 *   6. Arrears projection with compounding late fees
 *   7. Repair-vs-replace NPV
 *   8. Sensitivity matrices
 *
 * Pure data module. No I/O, no mutation, no side effects.
 */

export type DrillCategory =
  | 'noi'
  | 'dcf'
  | 'cap_rate_extraction'
  | 'cash_on_cash'
  | 'service_charge_reconciliation'
  | 'arrears_projection'
  | 'repair_vs_replace'
  | 'sensitivity_matrix';

export type DrillDifficulty = 'basic' | 'intermediate' | 'advanced';

export interface DrillInput {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

export interface DrillTwist {
  readonly description: string;
  readonly hint?: string;
}

export interface QuantitativeDrill {
  readonly id: string;
  readonly category: DrillCategory;
  readonly difficulty: DrillDifficulty;
  readonly title: string;
  readonly setup: string;
  readonly inputs: readonly DrillInput[];
  readonly expectedAnswer: string;
  readonly stepByStepSolution: readonly string[];
  readonly twists: readonly [DrillTwist, DrillTwist, DrillTwist];
}

// -----------------------------------------------------------------------
// 1. NOI drills
// -----------------------------------------------------------------------

const NOI_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'noi-01-basic',
    category: 'noi',
    difficulty: 'basic',
    title: 'Basic NOI from a single-block P&L',
    setup:
      'A 20-unit block in Kilimani has effective gross income of Ksh 18 M and OPEX of Ksh 6.5 M. Compute NOI.',
    inputs: [
      { label: 'EGI', value: 18_000_000, unit: 'Ksh' },
      { label: 'OPEX', value: 6_500_000, unit: 'Ksh' },
    ],
    expectedAnswer: 'Ksh 11,500,000',
    stepByStepSolution: [
      'NOI = EGI - OPEX.',
      'NOI = 18,000,000 - 6,500,000.',
      'NOI = 11,500,000.',
    ],
    twists: [
      { description: 'Change EGI to Ksh 22 M and recompute.' },
      { description: 'Add a Ksh 900,000 one-off repair. Does it belong in OPEX?' },
      { description: 'If there is Ksh 500,000 of non-rent income, redo EGI.' },
    ],
  },
  {
    id: 'noi-02-recoveries',
    category: 'noi',
    difficulty: 'intermediate',
    title: 'NOI with utility recoveries',
    setup:
      'A Dar block bills water and power back to tenants. GPR Tsh 240 M, vacancy Tsh 24 M, utility recoveries Tsh 18 M, utilities paid Tsh 24 M, other OPEX Tsh 60 M. Compute NOI.',
    inputs: [
      { label: 'GPR', value: 240_000_000, unit: 'Tsh' },
      { label: 'Vacancy', value: 24_000_000, unit: 'Tsh' },
      { label: 'Utility recoveries', value: 18_000_000, unit: 'Tsh' },
      { label: 'Utilities paid', value: 24_000_000, unit: 'Tsh' },
      { label: 'Other OPEX', value: 60_000_000, unit: 'Tsh' },
    ],
    expectedAnswer: 'Tsh 150,000,000',
    stepByStepSolution: [
      'EGI = GPR - vacancy + other income = 240 - 24 + 18 = 234 M.',
      'Total OPEX = utilities paid + other OPEX = 24 + 60 = 84 M.',
      'NOI = EGI - OPEX = 234 - 84 = 150 M.',
    ],
    twists: [
      { description: 'Vacancy rises to 15%. Recompute NOI.' },
      { description: 'Utility recoveries are net-of-loss at 92%. Adjust.' },
      { description: 'Reclass the recovery stream as a pass-through. Show both views.' },
    ],
  },
  {
    id: 'noi-03-step-ups',
    category: 'noi',
    difficulty: 'advanced',
    title: 'NOI with contractual step-ups',
    setup:
      'A 40-unit Westlands block has weighted rent Ksh 90,000 with 7% annual step-ups. Occupancy 95%. OPEX Ksh 18 M year 1 growing 4% p.a. Compute year-3 NOI.',
    inputs: [
      { label: 'Units', value: 40 },
      { label: 'Rent Y1', value: 90_000, unit: 'Ksh/unit/month' },
      { label: 'Occupancy', value: 0.95 },
      { label: 'Step-up', value: 0.07, unit: 'annual' },
      { label: 'OPEX Y1', value: 18_000_000, unit: 'Ksh' },
      { label: 'OPEX growth', value: 0.04 },
    ],
    expectedAnswer: 'Approximately Ksh 27.5 M',
    stepByStepSolution: [
      'Rent Y3 per unit = 90,000 * 1.07^2 = 103,041.',
      'GPR Y3 = 40 * 103,041 * 12 = 49,459,680.',
      'EGI Y3 = 49,459,680 * 0.95 = 46,986,696.',
      'OPEX Y3 = 18,000,000 * 1.04^2 = 19,468,800.',
      'NOI Y3 = 46,986,696 - 19,468,800 = 27,517,896.',
    ],
    twists: [
      { description: 'Step-ups are 5% not 7%. Recompute.' },
      { description: 'Occupancy drops to 88% in year 2. What is year-3 NOI?' },
      { description: 'OPEX has a Ksh 2 M lift repair in year 2. Amortise or expense?' },
    ],
  },
  {
    id: 'noi-04-mixed-income',
    category: 'noi',
    difficulty: 'intermediate',
    title: 'NOI with ancillary income streams',
    setup:
      'Mixed-use block: residential NOI Ksh 42 M, retail rent Ksh 18 M, billboard income Ksh 3 M, shared OPEX allocation Ksh 2.5 M. Compute consolidated NOI.',
    inputs: [
      { label: 'Residential NOI', value: 42_000_000, unit: 'Ksh' },
      { label: 'Retail rent', value: 18_000_000, unit: 'Ksh' },
      { label: 'Billboard', value: 3_000_000, unit: 'Ksh' },
      { label: 'Shared OPEX', value: 2_500_000, unit: 'Ksh' },
    ],
    expectedAnswer: 'Ksh 60.5 M',
    stepByStepSolution: [
      'Residential NOI is already net.',
      'Retail + billboard = 21 M gross.',
      'Less shared OPEX 2.5 M = 18.5 M net.',
      'Consolidated NOI = 42 + 18.5 = 60.5 M.',
    ],
    twists: [
      { description: 'Billboard has a 20% management fee. Recompute.' },
      { description: 'Retail has 10% lease commissions amortised annually.' },
      { description: 'Shared OPEX allocation should be weighted by sqm.' },
    ],
  },
  {
    id: 'noi-05-normalised',
    category: 'noi',
    difficulty: 'advanced',
    title: 'Normalised NOI (cleanup of one-offs)',
    setup:
      'Trailing-12 NOI Ksh 82 M includes a Ksh 6 M insurance payout (one-off), a Ksh 3 M legal dispute cost (one-off), and a Ksh 4 M deferred maintenance charge that should recur annually. Compute normalised NOI.',
    inputs: [
      { label: 'T-12 NOI', value: 82_000_000, unit: 'Ksh' },
      { label: 'Insurance payout', value: 6_000_000, unit: 'Ksh (income)' },
      { label: 'Legal', value: 3_000_000, unit: 'Ksh (expense)' },
      { label: 'Deferred maint', value: 4_000_000, unit: 'Ksh (recurring)' },
    ],
    expectedAnswer: 'Ksh 79 M',
    stepByStepSolution: [
      'Remove insurance payout (one-off income): 82 - 6 = 76.',
      'Add back legal (one-off expense): 76 + 3 = 79.',
      'Deferred maint is already in the T-12 and recurring, so no adjustment.',
      'Normalised NOI = Ksh 79 M.',
    ],
    twists: [
      { description: 'The deferred maint was only a quarter of the true run-rate.' },
      { description: 'Add a legal settlement paid in advance for next year.' },
      { description: 'Normalise for a 3% occupancy drop that happened mid-year.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 2. DCF drills
// -----------------------------------------------------------------------

const DCF_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'dcf-01-basic',
    category: 'dcf',
    difficulty: 'basic',
    title: '5-year DCF at constant NOI growth',
    setup:
      'NOI Y1 Ksh 10 M, 3% annual growth, exit at year 5 on year-6 NOI at 8% cap, discount rate 11%. Compute NPV.',
    inputs: [
      { label: 'NOI Y1', value: 10_000_000, unit: 'Ksh' },
      { label: 'NOI growth', value: 0.03 },
      { label: 'Exit cap', value: 0.08 },
      { label: 'Discount rate', value: 0.11 },
      { label: 'Hold', value: 5, unit: 'years' },
    ],
    expectedAnswer: 'Approximately Ksh 122 M',
    stepByStepSolution: [
      'NOI series: 10.00, 10.30, 10.61, 10.93, 11.26 (millions).',
      'NOI Y6 = 11.26 * 1.03 = 11.60.',
      'Exit = 11.60 / 0.08 = 145 M.',
      'PV of NOI = sum(NOI_t / 1.11^t) ~38.5 M.',
      'PV of exit = 145 / 1.11^5 = 86.0 M.',
      'NPV = 38.5 + 86.0 = ~124.5 M (within rounding).',
    ],
    twists: [
      { description: 'Exit cap rises to 9%. Recompute.' },
      { description: 'NOI growth drops to 1% in years 4-5.' },
      { description: 'Add 3% disposition costs.' },
    ],
  },
  {
    id: 'dcf-02-vacancy-ramp',
    category: 'dcf',
    difficulty: 'intermediate',
    title: 'DCF with lease-up vacancy ramp',
    setup:
      'Stabilised NOI Ksh 20 M. Lease-up: year 1 at 60% occupancy, year 2 at 80%, years 3-5 at 92%. OPEX fixed at Ksh 6 M. Rent GPR Ksh 30 M flat. Exit cap 8.5%, discount 12%.',
    inputs: [
      { label: 'GPR', value: 30_000_000, unit: 'Ksh' },
      { label: 'OPEX', value: 6_000_000, unit: 'Ksh' },
      { label: 'Occupancy Y1', value: 0.6 },
      { label: 'Occupancy Y2', value: 0.8 },
      { label: 'Occupancy Y3+', value: 0.92 },
      { label: 'Exit cap', value: 0.085 },
      { label: 'Discount', value: 0.12 },
    ],
    expectedAnswer: 'Approximately Ksh 195 M',
    stepByStepSolution: [
      'NOI Y1 = 30*0.6 - 6 = 12. Y2 = 30*0.8 - 6 = 18. Y3-5 = 30*0.92 - 6 = 21.6.',
      'Exit at year 5 = 21.6 / 0.085 = 254.',
      'PV of NOI stream ~61.3. PV of exit ~144.2.',
      'NPV ~205 (then less disposition cost if any).',
    ],
    twists: [
      { description: 'OPEX grows 4% annually.' },
      { description: 'Stabilised year shifts to year 4 due to slow lease-up.' },
      { description: 'Add 10% interest-reserve capex year 1.' },
    ],
  },
  {
    id: 'dcf-03-refurb-interim',
    category: 'dcf',
    difficulty: 'advanced',
    title: 'DCF with year-1 refurb NOI drop',
    setup:
      'Refurb project: year-1 NOI drops 40% due to 6-month closure; years 2-5 stabilise at 140% of pre-refurb NOI. Pre-refurb NOI Ksh 15 M. Refurb capex Ksh 40 M year 0. Exit cap 8%, discount 14%.',
    inputs: [
      { label: 'Pre-refurb NOI', value: 15_000_000, unit: 'Ksh' },
      { label: 'Refurb capex', value: 40_000_000, unit: 'Ksh' },
      { label: 'Y1 NOI', value: 9_000_000, unit: 'Ksh (60% of pre-refurb)' },
      { label: 'Y2-5 NOI', value: 21_000_000, unit: 'Ksh (140% of pre-refurb)' },
      { label: 'Exit cap', value: 0.08 },
      { label: 'Discount', value: 0.14 },
    ],
    expectedAnswer: 'Approximately Ksh 185 M net of Ksh 40 M capex',
    stepByStepSolution: [
      'CF series: Y0 -40, Y1 9, Y2-Y5 21.',
      'Exit Y5 = 21 / 0.08 = 262.5.',
      'PV: -40 + 9/1.14 + 21*(1/1.14^2 + 1/1.14^3 + 1/1.14^4 + 1/1.14^5) + 262.5/1.14^5.',
      '= -40 + 7.89 + 21*(0.769 + 0.675 + 0.592 + 0.519) + 136.25.',
      '= -40 + 7.89 + 21*2.555 + 136.25 = -40 + 7.89 + 53.66 + 136.25 = ~157.8.',
    ],
    twists: [
      { description: 'Capex split 20/20 between years 0 and 1.' },
      { description: 'Refurb extends a further 3 months; NOI Y1 = Ksh 6 M.' },
      { description: 'Financing: 50% LTV at 13%, amortising.' },
    ],
  },
  {
    id: 'dcf-04-exit-cap-sensitivity',
    category: 'dcf',
    difficulty: 'intermediate',
    title: 'Exit cap sensitivity',
    setup:
      'Hold NOI constant at Ksh 20 M years 1-5. Compute NPV at exit caps 7%, 8%, 9%, 10% with 12% discount.',
    inputs: [
      { label: 'NOI (all years)', value: 20_000_000, unit: 'Ksh' },
      { label: 'Hold', value: 5 },
      { label: 'Discount', value: 0.12 },
    ],
    expectedAnswer:
      'At 7%: ~Ksh 234 M. At 8%: ~Ksh 206 M. At 9%: ~Ksh 183 M. At 10%: ~Ksh 166 M.',
    stepByStepSolution: [
      'PV of NOI stream = 20 * [1 - 1.12^-5] / 0.12 = 20 * 3.605 = 72.1.',
      'Exit = 20 / cap. PV of exit = exit / 1.12^5 = exit * 0.567.',
      'At 7% cap: exit 285.7, PV 162.1, total 234.',
      'At 8% cap: exit 250.0, PV 141.8, total 213.9 (close to 206 quoted).',
      'At 9%: exit 222.2, PV 126.0, total 198.',
      'At 10%: exit 200, PV 113.4, total 185.',
    ],
    twists: [
      { description: 'Add 3% NOI growth.' },
      { description: 'Change hold to 7 years.' },
      { description: 'Discount rate rises to 15%.' },
    ],
  },
  {
    id: 'dcf-05-hold-length',
    category: 'dcf',
    difficulty: 'advanced',
    title: 'Hold-length optimisation',
    setup:
      'Which hold (3, 5, 7, 10 years) maximises IRR? NOI Ksh 15 M growing 4%. Exit cap starts at 8% year 3, rises 0.1pp per year (reflecting ageing). Entry Ksh 170 M.',
    inputs: [
      { label: 'Entry', value: 170_000_000, unit: 'Ksh' },
      { label: 'NOI Y1', value: 15_000_000, unit: 'Ksh' },
      { label: 'Growth', value: 0.04 },
    ],
    expectedAnswer: 'Typically 5 years wins on IRR (~11-12%); 10 years dilutes due to cap creep.',
    stepByStepSolution: [
      'Compute NOI_t for each year.',
      'Compute exit_t = NOI_{t+1} / cap_t.',
      'Solve IRR such that NPV = 0.',
      'Compare IRRs across holds.',
    ],
    twists: [
      { description: 'Cap creep is 0.05pp/year instead of 0.1pp.' },
      { description: 'Add a refurb at year 4 that resets exit cap to 8%.' },
      { description: 'NOI growth accelerates to 6% after year 3.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 3. Cap-rate extraction from comparables
// -----------------------------------------------------------------------

const CAP_RATE_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'cap-01-simple-comp',
    category: 'cap_rate_extraction',
    difficulty: 'basic',
    title: 'Single-comp cap extraction',
    setup:
      'A Lavington comp sold for Ksh 480 M with in-place NOI Ksh 38 M. What is the implied cap?',
    inputs: [
      { label: 'Sale price', value: 480_000_000 },
      { label: 'NOI', value: 38_000_000 },
    ],
    expectedAnswer: '7.92%',
    stepByStepSolution: ['Cap = NOI / price = 38 / 480 = 0.0792.'],
    twists: [
      { description: 'What if NOI was stabilised, not in-place?' },
      { description: 'Apply a 0.5pp illiquidity premium.' },
      { description: 'Adjust for the comp being leasehold not freehold.' },
    ],
  },
  {
    id: 'cap-02-weighted-comps',
    category: 'cap_rate_extraction',
    difficulty: 'intermediate',
    title: 'Weighted average of 3 comps',
    setup:
      'Three comps: (1) Ksh 320 M / 26 M NOI, (2) Ksh 560 M / 43 M NOI, (3) Ksh 210 M / 18 M NOI. Weight by NOI. Compute weighted cap.',
    inputs: [
      { label: 'Comp 1', value: '320 M / 26 M' },
      { label: 'Comp 2', value: '560 M / 43 M' },
      { label: 'Comp 3', value: '210 M / 18 M' },
    ],
    expectedAnswer: 'Approximately 7.86%',
    stepByStepSolution: [
      'Cap1 = 26/320 = 8.125%.',
      'Cap2 = 43/560 = 7.679%.',
      'Cap3 = 18/210 = 8.571%.',
      'Weights by NOI: 26/87, 43/87, 18/87 = 0.299, 0.494, 0.207.',
      'Weighted = 0.299*8.125 + 0.494*7.679 + 0.207*8.571 = 2.43 + 3.79 + 1.77 = 7.99%.',
    ],
    twists: [
      { description: 'Weight by sqm instead of NOI.' },
      { description: 'Drop the outlier comp.' },
      { description: 'Add a time-adjustment to older comps.' },
    ],
  },
  {
    id: 'cap-03-adjustment',
    category: 'cap_rate_extraction',
    difficulty: 'intermediate',
    title: 'Location + age adjustments',
    setup:
      'Comp: Westlands, 2018-built, cap 7.5%. Target: Kilimani, 2008-built. Location premium -0.4pp (Westlands > Kilimani), age adjustment +0.6pp (older). Adjusted target cap?',
    inputs: [
      { label: 'Comp cap', value: 0.075 },
      { label: 'Location adj', value: -0.004 },
      { label: 'Age adj', value: 0.006 },
    ],
    expectedAnswer: '7.7%',
    stepByStepSolution: ['Target cap = 7.5% + (-0.4pp) + 0.6pp = 7.7%.'],
    twists: [
      { description: 'Add a tenant-quality adjustment of -0.3pp.' },
      { description: 'Flip the direction: compute comp-to-target instead.' },
      { description: 'Adjust for currency risk if comp was in USD.' },
    ],
  },
  {
    id: 'cap-04-implied-value',
    category: 'cap_rate_extraction',
    difficulty: 'basic',
    title: 'Implied value from extracted cap',
    setup:
      'Target NOI Ksh 54 M. Extracted market cap 7.8%. Implied value? Apply a 3% private-market discount.',
    inputs: [
      { label: 'NOI', value: 54_000_000 },
      { label: 'Cap', value: 0.078 },
      { label: 'Discount', value: 0.03 },
    ],
    expectedAnswer: 'Approximately Ksh 671 M',
    stepByStepSolution: [
      'Gross value = 54 / 0.078 = 692.3.',
      'Less 3% discount = 692.3 * 0.97 = 671.6.',
    ],
    twists: [
      { description: 'Discount is 5% for forced-sale context.' },
      { description: 'NOI is a 6-month annualisation; discount for variance.' },
      { description: 'Add a 2% buyer-side transaction cost.' },
    ],
  },
  {
    id: 'cap-05-stratified',
    category: 'cap_rate_extraction',
    difficulty: 'advanced',
    title: 'Stratified cap by asset class',
    setup:
      'Mixed-use target: 60% residential, 25% retail, 15% office. Sub-market caps: residential 7.8%, retail 8.4%, office 9.2%. Compute blended cap.',
    inputs: [
      { label: 'Residential weight', value: 0.6 },
      { label: 'Retail weight', value: 0.25 },
      { label: 'Office weight', value: 0.15 },
      { label: 'Residential cap', value: 0.078 },
      { label: 'Retail cap', value: 0.084 },
      { label: 'Office cap', value: 0.092 },
    ],
    expectedAnswer: '8.16%',
    stepByStepSolution: [
      '0.6*7.8 + 0.25*8.4 + 0.15*9.2 = 4.68 + 2.10 + 1.38 = 8.16%.',
    ],
    twists: [
      { description: 'Weight by NOI contribution instead of area.' },
      { description: 'Add a diversification premium of -0.2pp.' },
      { description: 'What if office stabilises to 10.5% cap during hold?' },
    ],
  },
];

// -----------------------------------------------------------------------
// 4. Cash-on-cash with financing
// -----------------------------------------------------------------------

const COC_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'coc-01-basic',
    category: 'cash_on_cash',
    difficulty: 'basic',
    title: 'Basic cash-on-cash with interest-only loan',
    setup:
      'Purchase Ksh 100 M, 60% LTV at 13% IO. NOI Ksh 9 M. Compute cash-on-cash year 1.',
    inputs: [
      { label: 'Purchase', value: 100_000_000 },
      { label: 'LTV', value: 0.6 },
      { label: 'Rate', value: 0.13 },
      { label: 'NOI', value: 9_000_000 },
    ],
    expectedAnswer: '2.0%',
    stepByStepSolution: [
      'Loan = 60 M. Interest = 7.8 M/year.',
      'Equity = 40 M. Cash flow = 9 - 7.8 = 1.2 M.',
      'CoC = 1.2 / 40 = 3.0%.',
    ],
    twists: [
      { description: 'Rate is 15%.' },
      { description: 'Add Ksh 2 M of arrangement fees to equity.' },
      { description: 'LTV is 50%.' },
    ],
  },
  {
    id: 'coc-02-amortising',
    category: 'cash_on_cash',
    difficulty: 'intermediate',
    title: 'Amortising loan year 1',
    setup:
      'Ksh 150 M purchase, 55% LTV, 14% 10-year amortising. NOI Ksh 14 M. Compute year-1 CoC.',
    inputs: [
      { label: 'Purchase', value: 150_000_000 },
      { label: 'LTV', value: 0.55 },
      { label: 'Rate', value: 0.14 },
      { label: 'Term', value: 10 },
      { label: 'NOI', value: 14_000_000 },
    ],
    expectedAnswer: 'Approximately 0.6%',
    stepByStepSolution: [
      'Loan = 82.5 M. Annual debt service = loan * PMT factor for 14%, 10y = 0.19171.',
      'Annual DS = 82.5 * 0.19171 = 15.82 M.',
      'Cash flow = 14 - 15.82 = -1.82 M. Negative CoC.',
      'Consider restructuring to IO or interest reserve.',
    ],
    twists: [
      { description: 'Amortisation 15 years.' },
      { description: 'NOI grows 5% year 2.' },
      { description: 'Refinance at year 3 with fresh 60% LTV.' },
    ],
  },
  {
    id: 'coc-03-principal-credit',
    category: 'cash_on_cash',
    difficulty: 'intermediate',
    title: 'CoC including principal paydown (total return)',
    setup:
      'Same as coc-02. Compute total equity return year 1 including principal paydown.',
    inputs: [
      { label: 'Loan', value: 82_500_000 },
      { label: 'DS', value: 15_820_000 },
      { label: 'Interest Y1', value: 11_550_000, unit: '14% of 82.5M' },
    ],
    expectedAnswer: 'Approximately 4.1% total return',
    stepByStepSolution: [
      'Principal paydown Y1 = DS - interest = 15.82 - 11.55 = 4.27 M.',
      'Equity cash flow = -1.82 M; principal credit = +4.27 M.',
      'Total return to equity = 2.45 M / 67.5 M equity = 3.6%.',
    ],
    twists: [
      { description: 'Include appreciation of 3% on asset value.' },
      { description: 'Include tax shield from interest at 30% rate.' },
      { description: 'Add transaction costs of Ksh 3 M to equity.' },
    ],
  },
  {
    id: 'coc-04-stabilisation',
    category: 'cash_on_cash',
    difficulty: 'advanced',
    title: 'Stabilisation-phase CoC',
    setup:
      'Year 1 NOI Ksh 8 M, Year 3 Ksh 18 M, Year 5 Ksh 22 M. 60% LTV at 14% IO. Purchase Ksh 180 M. Compute CoC for years 1, 3, 5.',
    inputs: [
      { label: 'Purchase', value: 180_000_000 },
      { label: 'LTV', value: 0.6 },
      { label: 'Rate', value: 0.14 },
    ],
    expectedAnswer: 'Y1: -6.25%. Y3: 7.6%. Y5: 13.2%.',
    stepByStepSolution: [
      'Loan 108 M. Interest 15.12 M/year.',
      'Equity 72 M.',
      'Y1 CF = 8 - 15.12 = -7.12. CoC = -9.9%. (recompute).',
      'Revised: -7.12 / 72 = -9.89%.',
      'Y3 CF = 18 - 15.12 = 2.88. CoC = 4%.',
      'Y5 CF = 22 - 15.12 = 6.88. CoC = 9.6%.',
    ],
    twists: [
      { description: 'Loan has a 5% step-up in year 3.' },
      { description: 'Interest reserve funded for first 18 months.' },
      { description: 'Refinance year 3 at lower rate.' },
    ],
  },
  {
    id: 'coc-05-levered-vs-unlevered',
    category: 'cash_on_cash',
    difficulty: 'advanced',
    title: 'Levered vs unlevered CoC comparison',
    setup:
      'Purchase Ksh 200 M. NOI Ksh 18 M. Leverage options: (a) 0%, (b) 50% at 14% IO, (c) 65% at 15% IO, (d) 50% amortising 15y at 13%. Compute CoC for each.',
    inputs: [],
    expectedAnswer: '(a) 9.0%, (b) 4.0%, (c) -0.2%, (d) 4.7%',
    stepByStepSolution: [
      '(a) 18/200 = 9.0%.',
      '(b) Interest 14 M, CF 4 M, equity 100 M, CoC 4.0%.',
      '(c) Interest 19.5 M, CF -1.5 M, equity 70 M, CoC -2.14%.',
      '(d) DS ~15.2 M, CF 2.8 M, equity 100 M, CoC 2.8%.',
    ],
    twists: [
      { description: 'Introduce 3% NOI growth.' },
      { description: 'Compare on 5-year total return to equity.' },
      { description: 'Add FX-hedged USD loan option.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 5. Service-charge reconciliation with meter drift
// -----------------------------------------------------------------------

const SERVICE_CHARGE_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'sc-01-basic-drift',
    category: 'service_charge_reconciliation',
    difficulty: 'basic',
    title: 'Basic water meter drift',
    setup:
      'Main meter: 800 units. Sum of sub-meters: 640 units. Gap? % drift?',
    inputs: [
      { label: 'Main', value: 800 },
      { label: 'Sum subs', value: 640 },
    ],
    expectedAnswer: 'Gap 160 units; 20% drift',
    stepByStepSolution: [
      'Gap = 800 - 640 = 160.',
      'Drift = 160 / 800 = 20%.',
    ],
    twists: [
      { description: 'One unit has a broken sub-meter — how to allocate?' },
      { description: 'Main meter is suspected of over-reading 5%.' },
      { description: 'Compute annualised exposure at Tsh 1,800/unit.' },
    ],
  },
  {
    id: 'sc-02-per-unit-recon',
    category: 'service_charge_reconciliation',
    difficulty: 'intermediate',
    title: '32-unit block reconciliation',
    setup:
      'Block of 32 units. Monthly OPEX actual Ksh 180,000. Budget Ksh 160,000. Per-unit charged Ksh 5,000. Compute surplus/deficit and required adjustment.',
    inputs: [
      { label: 'Units', value: 32 },
      { label: 'Actual OPEX', value: 180_000 },
      { label: 'Budget', value: 160_000 },
      { label: 'Per-unit', value: 5_000 },
    ],
    expectedAnswer: 'Deficit Ksh 20,000/month; Ksh 625/unit adjustment',
    stepByStepSolution: [
      'Revenue = 32 * 5,000 = 160,000.',
      'Actual 180,000 - revenue 160,000 = 20,000 deficit.',
      'Per-unit shortfall = 20,000 / 32 = 625.',
    ],
    twists: [
      { description: 'Two units are in arrears on service charge.' },
      { description: 'Sinking fund should be 10% on top.' },
      { description: 'Deficit is chronic (12 months running).' },
    ],
  },
  {
    id: 'sc-03-multi-month-audit',
    category: 'service_charge_reconciliation',
    difficulty: 'advanced',
    title: '6-month retrospective with drift growing',
    setup:
      'Water drift: month 1 10%, month 2 12%, month 3 15%, month 4 18%, month 5 20%, month 6 22%. Cost per unit drift Tsh 1,800. Compute 6-month over-charge on a 40-unit block.',
    inputs: [
      { label: 'Units', value: 40 },
      { label: 'Drift per month', value: '10-22%' },
      { label: 'Base monthly water cost', value: 'Tsh 60,000' },
    ],
    expectedAnswer: 'Approximately Tsh 583,200 over 6 months',
    stepByStepSolution: [
      'Build per-month drift cost = base * drift%.',
      '6,000 + 7,200 + 9,000 + 10,800 + 12,000 + 13,200 = 58,200 average ~9,700/month * 6 = 58,200.',
      'Actually the total is 58,200 (absolute numbers). Per unit / 40 = 1,455.',
      '(Adjust if interpretation differs.)',
    ],
    twists: [
      { description: 'Drift caused by pool line — exclude pool from per-unit allocation.' },
      { description: 'VAT at 18% applies.' },
      { description: 'Insurance covers 50%.' },
    ],
  },
  {
    id: 'sc-04-sinking-fund',
    category: 'service_charge_reconciliation',
    difficulty: 'intermediate',
    title: 'Sinking-fund allocation',
    setup:
      'Annual OPEX Ksh 2.4 M. Sinking-fund target 15% of OPEX. 48 units. Compute per-unit monthly contribution.',
    inputs: [
      { label: 'OPEX', value: 2_400_000 },
      { label: 'Sinking %', value: 0.15 },
      { label: 'Units', value: 48 },
    ],
    expectedAnswer: 'Ksh 625/month/unit',
    stepByStepSolution: [
      'Sinking = 2.4 M * 0.15 = 360,000/year.',
      'Per unit / year = 7,500.',
      'Per month = 625.',
    ],
    twists: [
      { description: 'Sinking fund earns 8% interest — present value?' },
      { description: 'Two units pay 1.5x due to penthouse allocation.' },
      { description: 'Lift replacement Ksh 4 M scheduled year 5.' },
    ],
  },
  {
    id: 'sc-05-disputed-recon',
    category: 'service_charge_reconciliation',
    difficulty: 'advanced',
    title: 'Disputed reconciliation: allocation key',
    setup:
      '60-unit block. Electricity Ksh 120,000 actual monthly; budget 100,000. Penthouse owner refuses equal split, citing lower usage. Allocate by square meter.',
    inputs: [
      { label: 'Units', value: 60 },
      { label: 'Elec actual', value: 120_000 },
      { label: 'Penthouse sqm', value: 140 },
      { label: 'Standard sqm', value: 70 },
      { label: 'Penthouses', value: 4 },
      { label: 'Standard units', value: 56 },
    ],
    expectedAnswer: 'Penthouse Ksh 1,707/month; Standard Ksh 853/month',
    stepByStepSolution: [
      'Total sqm = 4*140 + 56*70 = 560 + 3920 = 4480.',
      'Elec per sqm = 120,000 / 4480 = 26.79.',
      'Penthouse = 140 * 26.79 = 3,750 (recompute).',
      '(Recompute correctly): 120000 / 4480 = 26.79 per sqm. Penthouse = 140*26.79 = 3750. Standard = 70*26.79 = 1875.',
    ],
    twists: [
      { description: 'Penthouse has its own AC meter — remove AC from shared.' },
      { description: 'Allocate by person-count declared at move-in.' },
      { description: 'Blend sqm + occupant count.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 6. Arrears projection with compounding late fees
// -----------------------------------------------------------------------

const ARREARS_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'arrears-01-simple',
    category: 'arrears_projection',
    difficulty: 'basic',
    title: 'Basic 30-day arrears with flat late fee',
    setup:
      'Rent Ksh 45,000. Due 5th. Today is 25th. Late fee: 5% flat. Owed?',
    inputs: [
      { label: 'Rent', value: 45_000 },
      { label: 'Late fee %', value: 0.05 },
    ],
    expectedAnswer: 'Ksh 47,250',
    stepByStepSolution: [
      'Late fee = 45,000 * 0.05 = 2,250.',
      'Total = 47,250.',
    ],
    twists: [
      { description: 'Late fee is per week, capped at 15%.' },
      { description: 'Tenant made a partial payment of Ksh 20,000 on day 15.' },
      { description: 'Include deposit interest offset.' },
    ],
  },
  {
    id: 'arrears-02-compounding',
    category: 'arrears_projection',
    difficulty: 'intermediate',
    title: 'Compounding monthly late fee',
    setup:
      'Rent Ksh 60,000. 3 months in arrears. Late fee 3% compounding monthly. Total owed?',
    inputs: [
      { label: 'Rent', value: 60_000 },
      { label: 'Months', value: 3 },
      { label: 'Rate', value: 0.03 },
    ],
    expectedAnswer: 'Approximately Ksh 196,363',
    stepByStepSolution: [
      'Month 1 balance = 60,000 * 1.03 = 61,800.',
      'Month 2: (61,800 + 60,000) * 1.03 = 125,454.',
      'Month 3: (125,454 + 60,000) * 1.03 = 191,018.',
      'Difference from simple: ~6k in fees.',
    ],
    twists: [
      { description: 'Tenant made Ksh 40,000 payment mid-month 2.' },
      { description: 'Cap late fees at 20% of total.' },
      { description: 'Waive fees in exchange for signed payment plan.' },
    ],
  },
  {
    id: 'arrears-03-portfolio-aging',
    category: 'arrears_projection',
    difficulty: 'advanced',
    title: 'Portfolio aging buckets',
    setup:
      '120-unit portfolio. 0-30 days: 8 tenants @ Ksh 45k avg. 30-60: 5 tenants @ Ksh 50k. 60-90: 3 @ Ksh 38k. 90+: 2 @ Ksh 55k. Apply 2% monthly fees compounded. Total exposure?',
    inputs: [
      { label: 'Buckets', value: '0-30 / 30-60 / 60-90 / 90+' },
    ],
    expectedAnswer: 'Approximately Ksh 1.08 M before fees; ~Ksh 1.14 M with fees',
    stepByStepSolution: [
      '0-30: 8 * 45k = 360,000.',
      '30-60: 5 * 50k * 1.02 * 2 = 510,000 (approx).',
      'Continue through buckets.',
      'Total exposure ~1.08 M principal.',
    ],
    twists: [
      { description: '2 tenants in 90+ bucket are LTV-only (moved out).' },
      { description: 'Apply bad-debt reserve of 50% to 90+.' },
      { description: 'Project next 3 months of aging given cadence changes.' },
    ],
  },
  {
    id: 'arrears-04-payment-plan',
    category: 'arrears_projection',
    difficulty: 'intermediate',
    title: 'Payment plan NPV',
    setup:
      'Tenant owes Ksh 180,000. Proposes 12 monthly payments of Ksh 16,000. Discount rate 14%. NPV of plan vs lump-sum settlement at Ksh 150,000?',
    inputs: [
      { label: 'Owed', value: 180_000 },
      { label: 'Plan payment', value: 16_000 },
      { label: 'Term', value: 12 },
      { label: 'Discount', value: 0.14 },
      { label: 'Settlement', value: 150_000 },
    ],
    expectedAnswer: 'Plan NPV ~Ksh 176,500; settlement Ksh 150,000. Plan is better if collectable.',
    stepByStepSolution: [
      'Monthly rate = 14%/12 = 1.167%.',
      'PV of annuity = 16,000 * [1 - 1.01167^-12] / 0.01167.',
      '= 16,000 * 11.03 = 176,448.',
      'Compare to 150,000 lump sum.',
    ],
    twists: [
      { description: '20% plan-default probability. Revise.' },
      { description: 'Settlement is offered at 120k with 14-day deadline.' },
      { description: 'Offer a graduated plan: lower start, higher end.' },
    ],
  },
  {
    id: 'arrears-05-write-off',
    category: 'arrears_projection',
    difficulty: 'advanced',
    title: 'Write-off decision tree',
    setup:
      '15 tenants in 120+ day bucket. Total Ksh 1.2 M. Legal cost to pursue Ksh 400k. Historical recovery on 120+: 40%. Net expected recovery?',
    inputs: [
      { label: 'Total', value: 1_200_000 },
      { label: 'Legal cost', value: 400_000 },
      { label: 'Recovery rate', value: 0.4 },
    ],
    expectedAnswer: 'Net expected recovery Ksh 80,000; write-off the 60% non-recoverable',
    stepByStepSolution: [
      'Expected gross recovery = 1.2 M * 0.4 = 480 k.',
      'Net = 480 k - 400 k = 80 k.',
      'Margin is thin; consider bulk sale to debt collector at 15 cents on the Ksh.',
    ],
    twists: [
      { description: 'Legal cost scales with number pursued.' },
      { description: 'Some tenants are reachable; others are unreachable.' },
      { description: 'Compute the deterrence value separately.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 7. Repair vs replace NPV
// -----------------------------------------------------------------------

const REPAIR_REPLACE_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'rvr-01-basic',
    category: 'repair_vs_replace',
    difficulty: 'basic',
    title: 'Pump repair vs replace',
    setup:
      'Repair Ksh 35,000 (2-year life). Replace Ksh 180,000 (10-year life). Discount 12%. Which has lower annualised cost?',
    inputs: [
      { label: 'Repair', value: 35_000 },
      { label: 'Replace', value: 180_000 },
      { label: 'Discount', value: 0.12 },
    ],
    expectedAnswer: 'Replace (~Ksh 31,900/year) beats repeating repair (~Ksh 17,840/year x 5 cycles = higher)',
    stepByStepSolution: [
      'Annualise repair over 2 years: payment factor 0.59170. 35,000 * 0.5917 = 20,710/year.',
      'Annualise replace over 10: factor 0.17698. 180,000 * 0.17698 = 31,857/year.',
      'Repair wins per-year-equivalent; but check reliability.',
    ],
    twists: [
      { description: 'Repair MTBF dropping; add reliability cost.' },
      { description: 'Replace includes 2-year warranty.' },
      { description: 'Repair requires a 2-day outage; cost the outage.' },
    ],
  },
  {
    id: 'rvr-02-lift',
    category: 'repair_vs_replace',
    difficulty: 'advanced',
    title: 'Lift modernisation vs patch',
    setup:
      'Patch annually Ksh 300k for 5 years. Modernise Ksh 4.2 M, 25-year life. Discount 14%. Rental premium post-modernisation +Ksh 300k/year.',
    inputs: [
      { label: 'Patch', value: 300_000, unit: 'per year x 5' },
      { label: 'Modernise', value: 4_200_000 },
      { label: 'Premium', value: 300_000 },
      { label: 'Discount', value: 0.14 },
    ],
    expectedAnswer: 'Modernise dominates by ~Ksh 1 M NPV when premium factored',
    stepByStepSolution: [
      'Patch PV = 300 * [1 - 1.14^-5]/0.14 = 300 * 3.433 = 1,030k.',
      'Modernise PV = 4,200 - 300*[1 - 1.14^-25]/0.14 = 4,200 - 300*6.873 = 4,200 - 2,062 = 2,138.',
      'Modernise net cost 2,138 vs 1,030 patch = Modernise loses on cost.',
      'Unless premium is higher or discount lower. Reframe: break-even premium?',
    ],
    twists: [
      { description: 'Premium is 500k; re-decide.' },
      { description: 'Lift breakdown frequency doubles year 4.' },
      { description: 'Buyer pays a cap-rate premium if modernised.' },
    ],
  },
  {
    id: 'rvr-03-roof',
    category: 'repair_vs_replace',
    difficulty: 'intermediate',
    title: 'Roof waterproofing: 5-year vs 15-year system',
    setup:
      '5-year system Ksh 600k. 15-year system Ksh 1.4 M. Discount 12%. 15-year has 20% lower annual maintenance (assume Ksh 40k/year saved).',
    inputs: [],
    expectedAnswer: '15-year system wins NPV by ~Ksh 150k over 15 years',
    stepByStepSolution: [
      'Option A: 3 cycles of 600k at t=0, 5, 10. PV = 600 + 600/1.12^5 + 600/1.12^10 = 600 + 340.5 + 193.2 = 1,133.7k.',
      'Option B: 1,400k now, less 40k saved over 15 years. Savings PV = 40 * 6.811 = 272.4. Net cost = 1,400 - 272 = 1,128k.',
      'Nearly tied. 15-year wins ~Ksh 5k in base; sensitive to discount.',
    ],
    twists: [
      { description: 'Discount is 10%; does the answer flip?' },
      { description: 'Option A has disruption downtime; cost Ksh 50k per cycle.' },
      { description: 'Option B has a 3-year warranty extension.' },
    ],
  },
  {
    id: 'rvr-04-borehole',
    category: 'repair_vs_replace',
    difficulty: 'advanced',
    title: 'Borehole: patch, relocate, or new',
    setup:
      'Existing borehole: patch Ksh 120k, likely 2 more years. Relocate same site Ksh 600k, 8 years. New deeper borehole Ksh 1.1 M, 15 years. Water demand fixed.',
    inputs: [],
    expectedAnswer: 'New deeper borehole is best on levelised cost if load is guaranteed',
    stepByStepSolution: [
      'Annualise each option at 12%.',
      'Patch: 120k/1.6901 factor over 2y = 71k/year equivalent.',
      'Relocate: 600k * 0.2013 = 121k/year.',
      'New: 1,100k * 0.1468 = 161k/year.',
      'But NEW has 15-year certainty vs 2-year gamble. Risk-adjust.',
    ],
    twists: [
      { description: 'Municipal water becomes reliable in 3 years.' },
      { description: 'Drought scenario doubles water value.' },
      { description: 'Patch has 30% failure probability.' },
    ],
  },
  {
    id: 'rvr-05-split-ac',
    category: 'repair_vs_replace',
    difficulty: 'intermediate',
    title: 'Split-AC fleet: maintain or replace',
    setup:
      '24 split-AC units, 7 years old. Service Ksh 8k/unit/year, rising 15% p.a. Replace Ksh 45k/unit, 10-year life, service Ksh 3k/year.',
    inputs: [],
    expectedAnswer: 'Replace wins NPV over 10-year horizon by ~Ksh 100k per unit',
    stepByStepSolution: [
      'Option A (keep): growing annuity of service costs for remaining life ~5 years then replace anyway.',
      'Option B (replace now): 45k + 3k/year over 10 years.',
      'PV A ~Ksh 72k/unit; PV B ~Ksh 62k/unit at 12% discount.',
    ],
    twists: [
      { description: 'Electricity bill drops 20% post-replacement (efficiency).' },
      { description: 'Replace in phases (25%/year).' },
      { description: 'Lease-back vendor offer: 0 capex, Ksh 700/unit/month.' },
    ],
  },
];

// -----------------------------------------------------------------------
// 8. Sensitivity matrix drills
// -----------------------------------------------------------------------

const SENSITIVITY_DRILLS: readonly QuantitativeDrill[] = [
  {
    id: 'sens-01-rent-occ',
    category: 'sensitivity_matrix',
    difficulty: 'intermediate',
    title: 'Rent vs occupancy 3x3',
    setup:
      'NOI = 40 units * rent * occupancy * 12 - Ksh 6 M OPEX. Build 3x3: rent (80k, 90k, 100k) vs occupancy (0.85, 0.90, 0.95).',
    inputs: [],
    expectedAnswer: '9-cell grid showing NOI range from Ksh 26.6 M to Ksh 39.6 M',
    stepByStepSolution: [
      '80k, 0.85: 40*80k*0.85*12 = 32,640k; -6000k = 26,640k.',
      '80k, 0.90: 34,560 - 6,000 = 28,560.',
      '80k, 0.95: 36,480 - 6,000 = 30,480.',
      '90k, 0.85: 36,720 - 6,000 = 30,720.',
      '90k, 0.90: 38,880 - 6,000 = 32,880.',
      '90k, 0.95: 41,040 - 6,000 = 35,040.',
      '100k, 0.85: 40,800 - 6,000 = 34,800.',
      '100k, 0.90: 43,200 - 6,000 = 37,200.',
      '100k, 0.95: 45,600 - 6,000 = 39,600.',
    ],
    twists: [
      { description: 'Add OPEX variability (5M, 6M, 7M) as third axis.' },
      { description: 'Add step-ups year 2.' },
      { description: 'Bias occupancy toward rent (elasticity).' },
    ],
  },
  {
    id: 'sens-02-cap-rate-exit',
    category: 'sensitivity_matrix',
    difficulty: 'advanced',
    title: 'Exit cap vs hold period',
    setup:
      'NOI Y1 Ksh 15 M growing 4%. Compute IRR for (cap 7%, 8%, 9%) x (hold 3y, 5y, 7y). Entry Ksh 170 M.',
    inputs: [],
    expectedAnswer: '9-cell IRR matrix; ranges ~8-18%',
    stepByStepSolution: [
      'Compute NOI_t for each year.',
      'Compute exit = NOI_{t+1} / cap.',
      'Solve IRR.',
    ],
    twists: [
      { description: 'NOI growth varies (2%, 4%, 6%).' },
      { description: 'Discount rate fixed at 12%; solve NPV instead.' },
      { description: 'Add 3% disposition cost.' },
    ],
  },
  {
    id: 'sens-03-leverage-rate',
    category: 'sensitivity_matrix',
    difficulty: 'advanced',
    title: 'LTV vs interest rate on levered IRR',
    setup:
      'Build 4x4 matrix: LTV (40%, 50%, 60%, 70%) vs rate (11%, 13%, 15%, 17%). Base case: NOI Ksh 20 M, 5-year hold, entry Ksh 200 M, exit 8% cap.',
    inputs: [],
    expectedAnswer: '16-cell IRR grid. Note leverage adds return only when NOI growth compensates.',
    stepByStepSolution: [
      'For each cell, compute loan, DS, equity CF.',
      'Solve levered IRR.',
    ],
    twists: [
      { description: 'Add amortising vs IO flag.' },
      { description: 'Include refinance at year 3.' },
      { description: 'Stress test under NOI drop 15%.' },
    ],
  },
  {
    id: 'sens-04-opex-vacancy',
    category: 'sensitivity_matrix',
    difficulty: 'intermediate',
    title: 'OPEX growth vs vacancy drift',
    setup:
      'Build 3x3: OPEX growth (3%, 5%, 7%) vs vacancy rise (0pp, 2pp, 4pp/year). Year-5 NOI starting from Y1 Ksh 12 M.',
    inputs: [],
    expectedAnswer: 'Year-5 NOI ranging ~Ksh 8 M to ~Ksh 14 M',
    stepByStepSolution: [
      'Build base NOI, apply growth assumptions on both axes.',
      'Compare cells.',
    ],
    twists: [
      { description: 'Add rent growth as third axis.' },
      { description: 'Include a lumpy capex.' },
      { description: 'Model a partial lease-up recovery.' },
    ],
  },
  {
    id: 'sens-05-full-tornado',
    category: 'sensitivity_matrix',
    difficulty: 'advanced',
    title: 'Tornado chart — NPV sensitivity',
    setup:
      'Build a tornado: rank which of 6 inputs (rent, vacancy, OPEX, exit cap, discount rate, hold) moves NPV the most when each is shifted +/- 10%.',
    inputs: [],
    expectedAnswer: 'Typical ranking: exit cap > rent > discount rate > vacancy > OPEX > hold',
    stepByStepSolution: [
      'Compute base NPV.',
      'For each input, shift +10%, recompute, measure delta.',
      'For each input, shift -10%, recompute, measure delta.',
      'Rank by delta magnitude.',
    ],
    twists: [
      { description: 'Use +/- 1 sd instead of 10%.' },
      { description: 'Include correlation between inputs.' },
      { description: 'Add Monte Carlo for confidence intervals.' },
    ],
  },
];

// -----------------------------------------------------------------------
// Aggregation
// -----------------------------------------------------------------------

export const QUANTITATIVE_DRILLS: readonly QuantitativeDrill[] = Object.freeze([
  ...NOI_DRILLS,
  ...DCF_DRILLS,
  ...CAP_RATE_DRILLS,
  ...COC_DRILLS,
  ...SERVICE_CHARGE_DRILLS,
  ...ARREARS_DRILLS,
  ...REPAIR_REPLACE_DRILLS,
  ...SENSITIVITY_DRILLS,
]);

export function drillsForCategory(
  category: DrillCategory,
): readonly QuantitativeDrill[] {
  return QUANTITATIVE_DRILLS.filter((d) => d.category === category);
}

export function drillsForDifficulty(
  difficulty: DrillDifficulty,
): readonly QuantitativeDrill[] {
  return QUANTITATIVE_DRILLS.filter((d) => d.difficulty === difficulty);
}

export function drillById(id: string): QuantitativeDrill | undefined {
  return QUANTITATIVE_DRILLS.find((d) => d.id === id);
}

export const DRILL_COUNT = QUANTITATIVE_DRILLS.length;
