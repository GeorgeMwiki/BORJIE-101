import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_01_GEITA_LICENCE_ACQUISITION = defineCaseStudy({
  id: 'cs-01-geita-licence-portfolio-acquisition',
  title:
    'The Geita licence-cluster acquisition: from reserve diligence to first poured bar',
  wordCount: 1140,
  country: 'TZ',
  tags: ['acquisition', 'due-diligence', 'reserves', 'recovery', 'licence-transfer'],
  difficulty: 'advanced',
  narrative: `In March 2026, a Tanzanian family office — quiet, second-generation, mostly cash — is offered a cluster of gold tenements in the Geita greenstone belt, held under a single operating company. The package is three contiguous areas: a Mining Licence (ML) over the producing pit "Acacia North" (granted 2014), and two adjoining Primary Mining Licences (PMLs) at Nyakabale and Bukoli where artisanal cooperatives have been working oxide ore by gravity. The seller is a mid-tier operator winding down its Tanzania exposure after its parent re-cut its African footprint and chose to exit the Lake Zone.

The asking price is TZS 41 billion, against which the seller quotes a "head grade of 3.8 g/t and recoveries north of 90 percent." The family office has 21 business days for exclusive due diligence. Their analyst, Neema, has never underwritten a producing gold asset before and calls Mr. Mwikila on day 2.

On the surface the story is clean. The plant — a 600 tonne-per-day carbon-in-leach (CIL) circuit — milled 182,000 tonnes last year. The seller's reconciliation shows mill feed at 3.8 g/t, recovery 91 percent, so recovered gold of 182,000 x 3.8 x 0.91 / 31.1035 = roughly 20,200 ounces. At a realised price of USD 2,150/oz that is about USD 43.4 million of revenue, which the seller converts to TZS at the GN198/2025 reference rate. Cash cost is quoted at USD 1,180/oz. Neema notices the numbers are quoted on the seller's best month, not the trailing twelve.

When she pulls the monthly grade-control versus mill reconciliation, three pattern breaks appear. First, the resource model head grade is 3.8 g/t but the trailing-12 *mill feed* grade is 2.9 g/t — the gap is dilution and a stockpile of low-grade oxide that has been blended in to keep the mill full. Second, "recovery 91 percent" is the gravity-plus-CIL number on fresh oxide; the orebody is transitioning to sulphide at depth, where this circuit recovers 78-82 percent because there is no flotation or fine-grind. Third, the trailing-12 shows almost no sustaining capital — TZS 0.4 billion across a tailings storage facility (TSF) that is within two lifts of its permitted crest and a SAG mill liner schedule that is overdue.

Mr. Mwikila has Neema walk the site. The gold room's CCTV has a blind corner over the smelt area. The TSF underdrain decant is running cloudy. At Nyakabale, the artisanal cooperative is working under a verbal arrangement, not a written tribute, and their mercury amalgamation tailings sit uphill of the village borehole — an environmental liability the buyer would inherit. The Mining Commission file shows the ML is in good standing but one PML lapsed 40 days ago and is technically open ground.

On the legal side, the deal is a share sale of the operating company, which means the buyer inherits the 16 percent State free-carried interest, the historical TRA position, and any unremediated environmental obligations. PMLs are citizen-only and cannot be held by a foreign-owned vehicle — the family office is Tanzanian, so that gate is clear, but the buyer must re-confirm the cooperative arrangements survive the change of control.

The acquisition decision is not whether to buy. It is at what price, on what terms, with what conditions precedent. Neema must produce a revised indicative bid by day 10.`,
  dataTable: {
    title: 'Geita licence cluster — due-diligence snapshot (Mar 2026)',
    rows: [
      { label: 'Tenements', value: '1 ML + 2 PML', note: 'one PML lapsed 40 days ago' },
      { label: 'Plant throughput (T-12)', value: '182,000 tpa', note: '600 tpd CIL' },
      { label: 'Resource model head grade', value: '3.8 g/t Au' },
      { label: 'Trailing-12 mill feed grade', value: '2.9 g/t Au', note: 'dilution + low-grade blend' },
      { label: 'Recovery (oxide, current)', value: '91%' },
      { label: 'Recovery (sulphide at depth)', value: '78-82%', note: 'no flotation/fine-grind' },
      { label: 'Realised gold price', value: 'USD 2,150 / oz' },
      { label: 'Quoted cash cost', value: 'USD 1,180 / oz', note: 'best-month basis' },
      { label: 'Asking price', value: 'TZS 41 B' },
      { label: 'Sustaining capital (T-12)', value: 'TZS 0.4 B', note: 'TSF + liners overdue' },
      {
        label: 'State free-carried interest',
        value: '16%',
        note: 'inherited in share sale',
      },
      { label: 'Environmental liability', value: 'ASM mercury tailings uphill of borehole' },
    ],
  },
  decisionQuestion:
    'Neema must send back a revised indicative bid by day 10. What is the defensible price, what are the 3 conditions precedent, and how does she underwrite the grade and recovery into the sulphide transition?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the difference between resource-model head grade and mill-feed (reconciled) grade?',
      hint: 'One is in the ground; one is what actually reaches the mill after dilution and blending.',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is the seller presenting 3.8 g/t and 91 percent recovery rather than the trailing-12 mill numbers?',
      hint: 'Whose version of the story raises the headline ounces?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Using the trailing-12 mill feed of 2.9 g/t and the sulphide recovery of 80 percent, what is recovered gold per 182,000 tonnes, versus the seller\'s 20,200 oz?',
      idealAnswerSketch:
        '182,000 x 2.9 x 0.80 / 31.1035 = approximately 13,570 oz. That is a third below the seller\'s headline of ~20,200 oz — a USD 14 M/yr revenue swing at USD 2,150/oz.',
    },
    {
      bloomLevel: 'apply',
      question:
        'At a USD 2,150 price and a 6 percent royalty plus 1 percent clearing fee, what does the State take per recovered ounce, and how does that change the netback the buyer underwrites?',
      idealAnswerSketch:
        'Royalty + clearing = 7% x 2,150 = USD 150.50/oz off the top. Netback before cash cost is ~USD 1,999.50/oz. On 13,570 oz that is ~USD 2.04 M/yr of royalty alone the buyer must model.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three pattern breaks (grade gap, sulphide recovery cliff, deferred sustaining capital) is most dangerous for a new owner, and why?',
      idealAnswerSketch:
        'The sulphide recovery cliff plus the near-full TSF. Recovery falls structurally as the pit deepens AND the tailings facility runs out of permitted airspace — both hit year 1-2 and either forces a flotation retrofit or caps throughput. The grade gap is bounded; the lapsed PML is a fixable filing.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If the orebody transitions fully to sulphide within 3 years, what is the range of capital to add a flotation/regrind front end to lift recovery back above 88 percent?',
      hint: 'Rule of thumb for a 600 tpd circuit retrofit: USD 6-12 M depending on concentrate handling.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'The seller insists on a 21-day diligence window. If you were advising the family office, would you accept it?',
      idealAnswerSketch:
        'No. Request 35 days with a refundable deposit; offer pricing certainty in exchange. The 21-day clock buries the TSF, metallurgical, and environmental diligence — the three items that move price most.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the 3 conditions precedent you would attach to a TZS 31 B bid.',
      idealAnswerSketch:
        '(1) Independent QP resource/reserve and metallurgical sign-off with price reset if reconciled sulphide recovery is below 82 percent; (2) re-grant of the lapsed PML and written tribute agreements with the cooperatives surviving change of control; (3) escrow against TSF re-lift permitting and a remediation reserve for the mercury tailings, released on Mining Commission and NEMC clearance.',
    },
  ],
  activity: {
    prompt:
      'You are Neema. Produce a 1-page memo to the family office investment committee with a revised bid, 3 conditions precedent, and a 24-month ramp plan with monthly recovered-ounce targets through the sulphide transition.',
    deliverable:
      'Written memo + month-by-month recovered-ounce ramp table + sensitivity grid (3x3: mill-feed grade vs recovery).',
    timeBoxMinutes: 45,
  },
  quantitativeDeepDive: {
    title: 'DCF to a 5-year mine life at a flat USD 2,100 gold price',
    setup:
      'Assume purchase at TZS 31 B. Year-1 recovered gold 13,500 oz rising to 17,000 oz by year 3 after a flotation retrofit (USD 9 M in year 2), then declining 8 percent per year as the pit deepens. Flat gold USD 2,100/oz. Royalty + clearing 7 percent. Cash cost USD 1,250/oz. Discount rate 14 percent. No terminal value (orebody depleted at year 5).',
    expectedAnswer: 'Unlevered project IRR approximately 15-18 percent, highly sensitive to the retrofit recovery uplift.',
    solutionSketch:
      'Build the recovered-ounce series 13.5k, 15.0k, 17.0k, 15.6k, 14.4k. Net price per oz = 2,100 x 0.93 - 1,250 = USD 703/oz margin (pre-retrofit capital). Annual free cash = ounces x margin, less USD 9 M retrofit in year 2. Discount at 14 percent. The case then asks: because there is NO terminal value, the IRR is driven almost entirely by years 1-3 — so the retrofit timing and the depletion slope, not the exit, decide the deal. Re-solve at a USD 1,900 price to show how thin the margin gets.',
  },
  discussionQuestions: [
    'If you discover post-close that the TSF cannot be re-lifted and a new cell is needed, how do you re-sequence the ramp plan?',
    'The seller is exiting Tanzania. Does that create leverage for you, or for them? Why?',
    'Would you finance this acquisition with debt? If yes, against reserves or against the plant, and at what gearing?',
    'What is the smallest diligence task that would move your price confidence the most?',
    'How does the plan differ if the family office is a long-term holder building a Lake Zone consolidation vs. a flipper?',
  ],
});
