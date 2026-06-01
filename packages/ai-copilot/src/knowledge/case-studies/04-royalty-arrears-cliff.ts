import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_04_ROYALTY_ARREARS_CLIFF = defineCaseStudy({
  id: 'cs-04-royalty-arrears-cliff',
  title: 'The 45-day royalty-and-receivables cliff: why it happens and how a senior treasurer prevents it',
  wordCount: 940,
  country: 'TZ',
  tags: ['royalty', 'receivables', 'collections', 'cadence', 'compliance'],
  difficulty: 'intermediate',
  narrative: `A mid-tier gold producer in the Lake Zone, operating company "Ziwa Gold," sells doré to three licensed buyers and a refiner, and remits a 6 percent royalty plus 1 percent clearing fee on every parcel to the Mining Commission. Through 2025 the finance team shows a recurring cliff that spans both sides of the ledger: buyer receivables that should clear in days drift, and the royalty returns that depend on those settled values fall behind.

In every quarter of 2025, by day 15 after a parcel ships, about 7 percent of parcel value is still unsettled by buyers — a handful of lots. By day 30 it climbs to 11 percent. Between day 30 and day 45 it jumps to 22 percent. That jump, doubling in 15 days, is the cliff. And because the statutory royalty return is reconciled to settled value, every unsettled parcel also leaves a royalty filing open past its due date, accruing interest and a compliance flag on the Mining Commission portal.

The finance manager, Hassan, assumed this was "just how buyers pay." His new group treasurer, Amina, a 20-year veteran, has a different view: she has seen the same shape at four operations and traces every cliff to the same root cause — delayed human follow-up on settlement.

Amina asks Hassan for four data pulls. First, day-of-first-contact after a parcel ships unsettled, per buyer. Second, channel of first contact (auto-email statement, WhatsApp from a named officer, phone call, in-person at the buying station). Third, settlement rate within 30 days of first contact by channel. Fourth, repeat-late rate for buyers who settled cleanly the previous quarter.

The findings stun Hassan. An automated settlement statement goes out on day 3 — good. The next touch is not until day 20, when the system flags the parcel for manager review. Nineteen of twenty "cliff" parcels are not chased again until day 32 or later. By then the buyer has made two cash-priority decisions: defer Ziwa and pay a louder counterparty first, and stop answering unknown numbers. Settlement within 30 days of first manual contact is 81 percent when contact is at day 7-10, 54 percent at day 15-20, and 31 percent after day 25.

The automated statement has an effect Amina did not expect. It is opened by 94 percent of buyers, but the tone is templated and formal, and buyers report treating it as routine paperwork. Over time the auto-statement is trained out of the buyer's sense of urgency; by month 6 the cliff buyers describe it as "background noise."

The third finding: 38 percent of cliff parcels involve repeat-late buyers from the previous quarter. A small tail of counterparties drives most of the late metal value.

The fourth finding: the most effective channel is the in-person visit to the buying station — 91 percent settlement in 30 days — but only 6 percent of unsettled parcels ever get one. Hassan's team cites bandwidth: three staff, multiple buyers, no time.

Amina wants a redesigned settlement-and-royalty cadence in 2 weeks, piloted on the Lake Zone book first.`,
  dataTable: {
    title: 'Ziwa Gold — 2025 settlement & royalty cadence',
    rows: [
      { label: 'Buyers + refiner', value: '4 counterparties' },
      { label: 'Royalty + clearing rate', value: '7% of settled value' },
      { label: 'Day-15 unsettled value', value: '~7%' },
      { label: 'Day-30 unsettled value', value: '~11%' },
      { label: 'Day-45 unsettled value', value: '~22%' },
      { label: 'Day-1 through day-20 gap', value: '17 days with zero human touch' },
      { label: 'Settlement at day 7-10 contact', value: '81%' },
      { label: 'Settlement at day 15-20 contact', value: '54%' },
      { label: 'Settlement after day 25', value: '31%' },
      { label: 'In-person visit settlement', value: '91%' },
      { label: 'In-person visit coverage', value: '6%' },
      { label: 'Repeat-late rate', value: '38%' },
    ],
  },
  decisionQuestion:
    'What is the redesigned settlement-and-royalty cadence, and what does Hassan staff the pilot with so that royalty filings never go past due?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question: 'What is the receivables-and-royalty cliff, described in one sentence?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why does sending more automated statements not solve the cliff?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design a day-1 through day-30 cadence that keeps human touch on every unsettled parcel without overwhelming three staff.',
      idealAnswerSketch:
        'Day 3 auto-statement. Day 7 manual WhatsApp from a named settlement officer. Day 10 phone call. Day 14 buying-station visit for any parcel not settled. Day 21 second visit + settlement-plan discussion. Day 28 file the royalty return on the best available settled value and flag the residual.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If the royalty return is due 30 days after the month of sale, what is the cost of a parcel that settles on day 45 versus one that settles on day 20, in royalty interest and compliance terms?',
      idealAnswerSketch:
        'The day-45 parcel pushes the royalty filing past its due date, accruing statutory interest on the unremitted royalty and raising a portal compliance flag; the day-20 parcel files clean. The cadence must force a filing decision before the royalty due date regardless of buyer settlement.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What is the root cause of the auto-statement habituation effect, and what design principle prevents it?',
      idealAnswerSketch:
        'Habituation comes from predictable, templated messages. Principle: vary channel and tone; at least one touch in the first 14 days must be identifiably human and parcel-specific.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Repeat-late buyers make up 38 percent of the cliff. What segmentation strategy addresses them specifically?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Hassan shorten the settlement terms from 5 days to 2 days to trigger earlier action, or keep the terms and redesign the cadence?',
      idealAnswerSketch:
        'Keep the terms; tightening them penalises reliable buyers for a minority problem and may push volume to competitors. The cadence redesign targets the actual failure point (the day 7-20 gap).',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a pilot evaluation: what 3 metrics and what success thresholds after 90 days?',
      idealAnswerSketch:
        '(1) Day-45 unsettled value < 12% (from 22%); (2) zero royalty returns filed past due; (3) staff hours per TZS 100 M of metal recovered < baseline + 15%.',
    },
  ],
  activity: {
    prompt:
      'You are Hassan. Produce the 30-day rollout plan (week 1 through week 4) and a staff rota with explicit buying-station visit blocks and a hard royalty-filing checkpoint.',
    deliverable: 'Rollout plan + weekly rota + dashboard wireframe.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Carrying cost of the cliff',
    setup:
      'Average parcel value TZS 420 M, four to five live parcels at any time, total monthly metal value TZS 1.9 B. At 22 percent day-45 unsettled, compute the unsettled exposure. Assume working-capital cost at 16 percent p.a. and statutory royalty interest on any late filing.',
    expectedAnswer:
      '0.22 x 1.9 B = TZS 418 M exposure; at 16%/12 = ~TZS 5.57 M/month carry. If the cliff is reduced to 12 percent, exposure drops to TZS 228 M, saving ~TZS 2.53 M/month, plus avoided royalty interest and the removal of the compliance flag.',
    solutionSketch:
      'The real cost is not the working-capital carry alone — it is the statutory interest and compliance exposure when a royalty return slips past due because the underlying parcel never settled. Show both, and note the licence-standing risk of repeated late filings.',
  },
  discussionQuestions: [
    'How do you coach a new settlement officer to chase a buyer without souring a long-term off-take relationship?',
    'What is the right tone for the day-7 WhatsApp to a buyer?',
    'Should settlement-plan offers be standardised or buyer-specific?',
    'How do you decide whether to file a royalty return on estimated versus settled value when a parcel is stuck?',
    'What is the weekly data shape Hassan should track to see the cliff forming early?',
  ],
});
