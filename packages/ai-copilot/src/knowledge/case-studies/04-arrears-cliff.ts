import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_04_ARREARS_CLIFF = defineCaseStudy({
  id: 'cs-04-arrears-cliff',
  title: 'The 45-day arrears cliff: why it happens and how a senior manager prevents it',
  wordCount: 920,
  country: 'KE',
  tags: ['arrears', 'collections', 'cadence', 'behavioral'],
  difficulty: 'intermediate',
  narrative: `A 180-unit mid-market portfolio in Embakasi, managed by a firm called Nyumba Pro, shows a recurring arrears pattern. In every quarter of 2025, the month-1 arrears rate at day 15 is around 7 percent — about 13 tenants late. By day 30, it has climbed to 11 percent — 20 tenants. Between day 30 and day 45, the rate jumps to 22 percent — 40 tenants. That jump, from 20 to 40, in just 15 days, is the arrears cliff.

The portfolio manager, Hassan, assumed this was "just the nature of the market." His new regional head, Amina, a 20-year veteran, has a different view: she has seen the same portfolio shape in five cities and traces every cliff to the same root cause — delayed human touch.

Amina asks Hassan for four data pulls. First, day-of-first-contact after missed-rent per tenant. Second, channel of first contact (SMS auto, WhatsApp manual, phone call, physical visit). Third, recovery rate within 30 days of first contact by channel. Fourth, repeat-arrears rate for tenants who cleared the previous quarter.

The findings stun Hassan. The first SMS goes out automatically at day 3 — good. The next touch is not until day 20, when the portal flags the account for manager review. Nineteen of the 20 "cliff" tenants are not contacted again until day 32 or later. By then, they have made two rent-priority decisions: (1) defer paying, and (2) stop answering unknown numbers. The recovery rate within 30 days of first manual contact is 81 percent when contact is at day 7-10, 54 percent at day 15-20, and 31 percent after day 25.

Meanwhile, the automated SMS has a negative effect Amina did not expect. It is read by 94 percent of tenants (confirmed by M-Pesa "STK push" receipts as the proxy), but the tone is templated and formal ("Dear Tenant, your rent for Unit 12B is overdue..."), and tenants report internalising it as a routine automated message. Over time, the auto-SMS is trained OUT of the tenant's sense of urgency. By month 6, cliff tenants describe the SMS as "background noise."

The third finding: 38 percent of "cliff" tenants are repeat offenders from the previous quarter. A small tail of tenants is driving most of the churn.

The fourth finding: the most effective channel is the physical visit — 91 percent recovery in 30 days — but only 6 percent of overdue tenants ever get visited. Hassan's team cites bandwidth: 180 units, 3 staff, no time.

Amina wants a redesigned collections cadence in 2 weeks, rolled out to the Embakasi portfolio first as a pilot.`,
  dataTable: {
    title: 'Embakasi portfolio — 2025 arrears cadence',
    rows: [
      { label: 'Units', value: '180' },
      { label: 'Day-15 arrears rate', value: '~7% (13 tenants)' },
      { label: 'Day-30 arrears rate', value: '~11% (20 tenants)' },
      { label: 'Day-45 arrears rate', value: '~22% (40 tenants)' },
      { label: 'Day-1 through day-20 gap', value: '17 days with zero human touch' },
      { label: 'Recovery at day 7-10 first contact', value: '81%' },
      { label: 'Recovery at day 15-20 first contact', value: '54%' },
      { label: 'Recovery after day 25', value: '31%' },
      { label: 'Physical visit recovery', value: '91%' },
      { label: 'Physical visit coverage', value: '6%' },
      { label: 'Repeat-arrears rate', value: '38%' },
    ],
  },
  decisionQuestion:
    'What is the redesigned collections cadence, and what does Hassan staff the pilot with?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question: 'What is the arrears cliff, described in one sentence?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why does adding more automated SMS not solve the cliff?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design a day-1 through day-30 cadence that maintains human touch without overwhelming the team.',
      idealAnswerSketch:
        'Day 3 auto-SMS. Day 7 manual WhatsApp from named manager. Day 10 phone call. Day 14 physical visit for anyone not responding. Day 21 second visit + payment-plan discussion. Day 30 escalation.',
    },
    {
      bloomLevel: 'apply',
      question:
        'With 3 staff, 180 units, and a target day-14 visit for non-responders, what is the peak weekly visit load, and is it feasible?',
      idealAnswerSketch:
        'Week-of-month-2 peak: ~8-10 tenants to visit. 3 staff = ~3 visits each. Feasible if concentrated on Mon-Wed when field time is budgeted.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What is the root cause of the SMS habituation effect, and what is the design principle that prevents it?',
      idealAnswerSketch:
        'Habituation comes from predictable, templated messages. Principle: vary channel and tone; at least one message in the first 14 days must be identifiably human.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Repeat offenders make up 38% of the cliff. What segmentation strategy addresses them specifically?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Hassan shorten the grace period from 5 days to 2 days to trigger earlier action, or keep the grace period and redesign the cadence?',
      idealAnswerSketch:
        'Keep the grace period; shortening it penalises good tenants for a minority problem. The cadence redesign targets the actual failure point (day 7-20 gap).',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a pilot evaluation: what 3 metrics and what success thresholds after 90 days?',
      idealAnswerSketch:
        '(1) Day-45 arrears rate < 12% (from 22%); (2) day-30 recovery rate > 70%; (3) staff hours per recovered Ksh 100,000 < baseline + 15%.',
    },
  ],
  activity: {
    prompt:
      'You are Hassan. Produce the 30-day rollout plan (week 1 through week 4) and a staff rota with explicit field-time blocks.',
    deliverable: 'Rollout plan + weekly rota + dashboard wireframe.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Rand cost of the cliff',
    setup:
      'At 22% day-45 arrears with average rent Ksh 42,000 and 180 units, compute monthly arrears exposure. Assume working capital cost at 14% p.a.',
    expectedAnswer:
      '0.22 * 180 * 42,000 = Ksh 1.66 M exposure; at 14%/12 = Ksh 19,376/month opportunity cost. If cliff reduced to 12%, exposure drops to Ksh 907k, saving ~Ksh 8,805/month plus reduced bad-debt write-offs.',
    solutionSketch:
      'The real cost is not the interest on float — it is the compounding bad-debt write-off when arrears cross day 90. Show both.',
  },
  discussionQuestions: [
    'How do you coach a new caretaker to do a payment conversation without humiliating the tenant?',
    'What is the right tone for the day-7 WhatsApp message?',
    'Should payment-plan offers be standardised or tenant-specific?',
    'How do you defend the field-visit cost in a management-fee negotiation?',
    'What is the data shape Hassan should be tracking weekly to see the cliff early?',
  ],
});
