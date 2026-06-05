import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_09_WASHPLANT_UPGRADE_DIVEST = defineCaseStudy({
  id: 'cs-09-washplant-upgrade-or-divest',
  title: 'Upgrade or divest? The 40-year-old wash plant decision',
  wordCount: 950,
  country: 'TZ',
  tags: ['plant-upgrade', 'divest', 'capex', 'roi', 'sensitivity'],
  difficulty: 'advanced',
  narrative: `"Songea Gold" is a small producing operation in the Ruvuma region built around a 1984-vintage gravity-and-vat wash plant on a Mining Licence held by the Mkapa family trust, third generation. The plant treats 250 tonnes per day of oxide ore. Head grade averages 2.6 g/t Au, but the ageing circuit recovers only 62 percent, so recovered grade is 1.6 g/t. Annual recovered metal is about 4,650 ounces. At a realised USD 2,100/oz, net of the 7 percent royalty-and-clearing, that supports an effective gross of roughly USD 9.1 M; cash operating cost runs high on the worn plant, leaving a modest annual operating surplus. The plant has a tired 1980s flowsheet, a recovery problem worsening as the ore turns transitional, a thickener that fails monthly, and no detox circuit (a compliance gap).

The trustees face five scenarios presented by their advisor, Abdul.

Scenario A — status quo. Do nothing. Recovery and grade drift down as the orebody turns transitional; recovered metal falls about 4 percent per year. Operating surplus erodes. Terminal value at year 10: TZS 2.8 billion (mostly residual plant and the licence).

Scenario B — light upgrade. TZS 7.0 billion. Replace the thickener, add a gravity-concentrator (Knelson-type) and a cyanide-detox circuit, refurbish pumps, improve grade control. Timeline: 6 months. Uplift: recovery from 62 to 78 percent, lifting recovered metal toward 5,850 oz on the same feed. Terminal value at year 10: TZS 4.6 billion.

Scenario C — heavy upgrade. TZS 18 billion. Full CIL retrofit behind the gravity circuit, fine-grind mill for the transitional sulphides, new tailings cell, and a modern control room. Timeline: 14 months + 6-month ramp. Uplift: recovery to 90 percent and throughput to 350 tpd, lifting recovered metal toward 9,500 oz. Terminal value at year 10: TZS 7.0 billion.

Scenario D — pit-and-plant expansion. Develop a satellite deposit 8 km away and double plant capacity to 600 tpd. Budget: TZS 56 billion all-in, 3-year build. Year-4 steady-state recovered metal ~20,000 oz. Terminal value at year 10: TZS 17 billion. Requires project finance plus a family capital call of TZS 20 billion.

Scenario E — divest. Sell the operating company and licence as-is. Indicative valuation at a small-producer multiple on current cash flow: TZS 2.8 billion. Transaction and remediation-reserve cost: 4 percent. Net: TZS 2.7 billion.

The trust has TZS 5.4 billion of liquid reserves, moderate appetite for debt (max 45 percent gearing on any upgrade), and no appetite for project finance. Three of five trustees are over 70 and want income now. Two are in their 40s and want growth and legacy. The chairman, Mr. Mkapa Jr., has called a decision meeting in 10 days.

Abdul's job is to rank the scenarios with explicit NPV, IRR, and narrative, honouring both the financial case and the family's internal tensions — and the fact that the missing detox circuit is a live compliance liability under any "do-nothing" path.`,
  dataTable: {
    title: 'Songea Gold wash plant — 5 scenarios',
    rows: [
      { label: 'Current recovery / recovered grade', value: '62% / 1.6 g/t' },
      { label: 'Current recovered metal', value: '~4,650 oz/yr' },
      { label: 'A: Status quo Y10 terminal', value: 'TZS 2.8 B' },
      { label: 'B: Light upgrade capex / Y10 terminal', value: 'TZS 7.0 B / TZS 4.6 B', note: 'recovery to 78%' },
      { label: 'C: Heavy upgrade capex / Y10 terminal', value: 'TZS 18 B / TZS 7.0 B', note: 'recovery to 90%, 350 tpd' },
      { label: 'D: Expansion capex / Y10 terminal', value: 'TZS 56 B / TZS 17 B' },
      { label: 'E: Divest net proceeds', value: 'TZS 2.7 B' },
      { label: 'Trust liquidity', value: 'TZS 5.4 B' },
      { label: 'Max gearing tolerance', value: '45%' },
      { label: 'Trustee generational split', value: '3 income-now / 2 growth' },
      { label: 'Compliance flag', value: 'No detox circuit (status-quo risk)' },
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
        'Why is Scenario D (expansion) essentially a different risk class from the other four?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the IRR of Scenario B (light upgrade) over 10 years at a 14 percent discount. Recovered metal steps from 4,650 to ~5,850 oz, then drifts as ore transitions; capex TZS 7.0 B in year 0; terminal TZS 4.6 B.',
      idealAnswerSketch:
        'The recovery jump from 62 to 78 percent adds ~1,200 oz/yr at ~USD 700-800/oz margin (net of royalty and cash cost) ~ USD 0.9 M/yr uplift; against TZS 7.0 B capex and a TZS 4.6 B terminal, the unlevered IRR lands roughly 16-20 percent — and it also closes the detox compliance gap.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the IRR of Scenario C with 40 percent debt at 15 percent interest and 8-year amortisation.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which scenario dominates on risk-adjusted return, and why?',
      idealAnswerSketch:
        'Scenario B usually wins on a risk-adjusted basis: moderate capex within the liquidity envelope, a proven recovery-uplift playbook, ~16-20 percent unlevered IRR, no project-finance dependence, and it removes a compliance liability. C is higher-return but carries metallurgical and ramp risk on the transitional sulphides.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'How does the trustee split (3 income / 2 growth) change the ranking?',
      idealAnswerSketch:
        'A board weighted 3-2 toward income-now will reject C and D on cash-suppression grounds during the build years. Scenario B becomes the consensus path because it restores and grows distributions within ~12 months while fixing compliance.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is Scenario E (divest) ever the right answer?',
      idealAnswerSketch:
        'Yes if: (a) the family has clearly better uses for the proceeds, or (b) the view on the orebody at depth is bearish and the transitional metallurgy is judged uneconomic. Absent those, divesting a plant before fixing a 62 percent recovery is selling at the bottom of the value it could realise.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a governance proposal that lets the family do Scenario B now and Scenario C in year 5 as a second phase.',
      idealAnswerSketch:
        'Phase-1 Scenario B funded from liquidity. Phase-2 (CIL retrofit) triggered by year-4 recovered metal > 5,500 oz and a confirmed sulphide resource at depth. Phase-2 financed 50/50 from reinvested cash flow and modest debt, with a family vote required at the trigger.',
    },
  ],
  activity: {
    prompt:
      'You are Abdul. Produce a 2-page board memo with ranked scenarios, a financial summary, and a recommended path that bridges the generational split and addresses the detox compliance gap.',
    deliverable: 'Memo + 5-scenario NPV/IRR table + 1-slide decision tree.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: '5-scenario sensitivity to recovery and gold price',
    setup:
      'Build a sensitivity grid on recovery (62 / 70 / 78 / 84 / 90 percent) against gold price (USD 1,700 / 1,900 / 2,100 / 2,300 / 2,500 per oz). Compute year-3 recovered-metal value for each cell, net of the 7 percent royalty-and-clearing.',
    expectedAnswer:
      'A heatmap with status-quo, light-upgrade, and heavy-upgrade regions visible; the upgrade scenarios are far more sensitive to recovery than to price within the realistic band.',
    solutionSketch:
      'The sensitivity shows that a recovery uplift is worth more per 8-point move than a USD 200 price move at current levels — recovery is the controllable variable. Prioritise the capital that buys recovery (gravity + detox + CIL) over capital that only buys throughput, until recovery is fixed.',
  },
  discussionQuestions: [
    'How does Abdul handle a trustee who insists on Scenario D despite the capital constraint?',
    'What is the communication plan to the workforce and the surrounding community during a 6-month plant shutdown-and-upgrade?',
    'Should the family bring in a JV partner or a streaming financier for Scenario C or D?',
    'How does the tax and royalty treatment differ between a light upgrade and a heavy retrofit?',
    'If the gold price falls 15 percent over 5 years, which scenarios survive?',
  ],
});
