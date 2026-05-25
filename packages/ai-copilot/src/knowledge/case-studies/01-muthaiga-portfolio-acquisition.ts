import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_01_MUTHAIGA_ACQUISITION = defineCaseStudy({
  id: 'cs-01-muthaiga-portfolio-acquisition',
  title:
    'The 120-unit Muthaiga portfolio acquisition: due diligence to stabilization',
  wordCount: 1120,
  country: 'KE',
  tags: ['acquisition', 'due-diligence', 'dcf', 'lease-up', 'capex'],
  difficulty: 'advanced',
  narrative: `In March 2026, an East African family office — quiet, second-generation, mostly cash — is offered a 120-unit residential portfolio held under a single SPV in Muthaiga. Three blocks: Acacia Court (48 units, built 2008), Jacaranda Heights (42 units, 2014), and Baobab Rise (30 units, 2019). The seller is an offshore investor winding down Kenya exposure ahead of a regional REIT listing that no longer includes the country.

The asking price is Ksh 4.2 billion, implying a blended yield the seller quotes at "around 8.2 percent on in-place NOI." The family office has 21 business days for exclusive due diligence. Their analyst, Wanjiku, has never underwritten a multi-block portfolio before and calls Mr. Mwikila on day 2.

On the surface the story is clean. The rent roll shows 114 occupied units of 120, which is 95 percent — healthy. Weighted average rent per unit is Ksh 95,000 per month. Gross potential rent is Ksh 11.4 million per month or Ksh 136.8 million per year. Effective gross income last year, per the seller's trailing-12, was Ksh 124.9 million. Opex came in at Ksh 42.1 million. Reported NOI: Ksh 82.8 million. Cap rate at ask: 82.8 / 4,200 = 1.97 percent. That is not 8.2 percent. Wanjiku notices the math does not reconcile.

The seller's rep, pushed, re-runs the number on "normalized stabilized NOI" — their internal projection assuming full occupancy, a 6 percent rent uplift on renewals, and a re-bid of the security contract. Their "stabilized" NOI comes to Ksh 344 million, cap 8.2 percent. Stabilization horizon: 18 months. No loss-to-lease or vacancy provision in the stabilized case.

Mr. Mwikila has Wanjiku walk the blocks. Acacia Court's corridors smell faintly of sewage on the third floor; a pipe has been patched twice in 2025. Jacaranda has solar panels on the roof that the maintenance supervisor cannot describe the service contract for. Baobab Rise is the newest and looks it, but four of the six vacant units are held off-market because the seller expects to sell the portfolio vacant-possession and re-lease at higher rents post-close.

On the financials side, a deeper look at the general ledger reveals three pattern breaks. First, Ksh 6.2 million of "caretaker allowances" sit in OPEX that are not tied to any named employee contracts — they trace to cash withdrawals. Second, service-charge income is commingled with rent in the P&L, inflating the revenue line by Ksh 18 million; the matching expense is correctly recorded, so gross NOI is understated by zero, but the headline yield calculation is distorted. Third, the trailing-12 shows zero capex. Zero. Over three blocks aged 7, 12, and 18 years.

The acquisition decision is not whether to buy. It is at what price, on what terms, with what conditions precedent. Wanjiku needs to produce a revised indicative bid by day 10.`,
  dataTable: {
    title: 'Muthaiga portfolio — due-diligence snapshot (Mar 2026)',
    rows: [
      { label: 'Units total', value: '120' },
      { label: 'Units occupied', value: '114 (95%)', note: '4 held off-market' },
      { label: 'Weighted avg rent / unit / month', value: 'Ksh 95,000' },
      { label: 'Gross potential rent / year', value: 'Ksh 136.8 M' },
      { label: 'Effective gross income (T-12)', value: 'Ksh 124.9 M' },
      { label: 'Reported OPEX (T-12)', value: 'Ksh 42.1 M' },
      { label: 'Reported NOI (T-12)', value: 'Ksh 82.8 M' },
      { label: 'Asking price', value: 'Ksh 4.2 B' },
      { label: 'Ask cap (T-12 NOI / price)', value: '1.97%' },
      { label: 'Seller stabilized cap', value: '8.2%', note: 'no vacancy provision' },
      {
        label: 'Unidentified caretaker allowance',
        value: 'Ksh 6.2 M',
        note: 'cash withdrawals, no contracts',
      },
      { label: 'Trailing capex', value: 'Ksh 0 over 12 months' },
    ],
  },
  decisionQuestion:
    'Wanjiku must send back a revised indicative bid by day 10. What is the defensible price, what are the 3 conditions precedent, and how does she underwrite the lease-up?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the difference between trailing-12 NOI and stabilized NOI?',
      hint: 'One is historical; one is projected.',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is the seller presenting the 8.2 percent yield on stabilized NOI rather than trailing-12?',
      hint: 'Whose version of the story is easier to sell?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Using the trailing-12 NOI of Ksh 82.8 M, what price would you pay for a 7.5 percent going-in cap?',
      idealAnswerSketch: '82.8 / 0.075 = Ksh 1.104 B. Gap to ask: Ksh 3.1 B.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Suppose Wanjiku accepts the seller\'s stabilization plan but adds a 7 percent vacancy provision. What does stabilized NOI become?',
      idealAnswerSketch:
        'Seller stabilized gross ~Ksh 390 M; 7% vacancy = Ksh 27 M; normalized ~Ksh 363 M before the unidentified allowance. Subtracting Ksh 6.2 M yields ~Ksh 357 M.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three pattern breaks (unidentified allowance, commingled service charge, zero capex) is most dangerous for a new owner, and why?',
      idealAnswerSketch:
        'Zero capex — it implies a deferred-maintenance bomb that will hit NOI year 1 or 2 post-close. The commingling is merely disclosure noise. The unidentified allowance is a governance issue but bounded.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If Acacia Court (48 units, 2008) has a sewer stack at end-of-life, what is the range of replacement capex per unit?',
      hint: 'Rule of thumb: Ksh 120k–180k per unit for full riser replacement.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'The seller insists on a 21-day diligence window. If you were advising the family office, would you accept it?',
      idealAnswerSketch:
        'No. Request 35 days with a refundable hard deposit; offer pricing certainty in exchange. The 21-day clock was set to bury the capex diligence.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the 3 conditions precedent you would attach to a Ksh 3.6 B bid.',
      idealAnswerSketch:
        '(1) Clean title and SPV audit; (2) independent capex audit at seller\'s cost with price reset if total exceeds Ksh 120 M; (3) 90-day tenant-roll estoppel with delinquency escrow.',
    },
  ],
  activity: {
    prompt:
      'You are Wanjiku. Produce a 1-page memo to the family office investment committee with a revised bid, 3 conditions precedent, and a 24-month stabilization plan with monthly NOI targets.',
    deliverable:
      'Written memo + month-by-month NOI ramp table + sensitivity grid (3x3: rent uplift vs vacancy).',
    timeBoxMinutes: 45,
  },
  quantitativeDeepDive: {
    title: 'DCF to 5-year exit at 7 percent terminal cap',
    setup:
      'Assume purchase at Ksh 3.6 B, year-1 NOI Ksh 155 M growing to Ksh 310 M by year 3 after lease-up + opex cleanup, 3 percent annual NOI growth thereafter. Discount rate 14 percent. Exit at year 5 on trailing NOI at 7 percent cap, 3 percent disposition cost.',
    expectedAnswer: 'Unlevered IRR approximately 16.8-17.4 percent.',
    solutionSketch:
      'Build NOI series: 155, 240, 310, 319.3, 328.9. Exit value = 328.9 / 0.07 = 4,698; net of 3% = 4,557. Discount each year at 14%. NPV of cash flows ~Ksh 210M, NPV of exit ~Ksh 2.37B, total ~Ksh 2.58B vs Ksh 3.6B cost; the raw NPV is negative at 14%, so IRR is below 14%. Recompute at hurdle rates to bracket: at 10%, NPV ~+Ksh 150M; IRR ~11%. The case then asks: what cleanup assumption has to be true for IRR to reach 18%?',
  },
  discussionQuestions: [
    'If you discover post-close that three vacant units have structural issues, how do you re-sequence the stabilization plan?',
    'The seller is winding down Kenya exposure. Does that create leverage for you, or for them? Why?',
    'Would you buy this portfolio with debt? If yes, at what LTV and why?',
    'What is the smallest diligence task that would move your price confidence the most?',
    'How does the stabilization plan differ if the family office is a strategic long-term holder vs. a value-add flipper?',
  ],
});
