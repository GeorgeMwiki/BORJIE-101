import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_06_TENDER_MANIPULATION = defineCaseStudy({
  id: 'cs-06-tender-manipulation',
  title: 'Tender manipulation in maintenance: detection and remedy',
  wordCount: 880,
  country: 'BOTH',
  tags: ['fraud', 'tender', 'procurement', 'governance', 'maintenance'],
  difficulty: 'advanced',
  narrative: `A 200-unit mixed portfolio spread across Westlands and Lavington has a maintenance spend of Ksh 48 M per year. The firm uses a three-bid tender rule for any job above Ksh 250,000. On paper the process is clean. In practice, over 24 months, an auditor finds that 34 percent of awarded tenders go to the same vendor — Beta Works Ltd — and the average awarded bid is within 2 percent of the "lowest" bid.

The portfolio manager, Peter, has been with the firm seven years and runs procurement as a side responsibility. Peter's defence: "Beta is good, they are available, and they are not the most expensive." The auditor, a contract CA named Njoki, digs deeper.

Pattern 1: Of 42 three-bid tenders over 24 months, 38 had the same three bidders — Beta Works, Alpha Construction, and Gamma Systems. The rare variant tenders used Delta Fit Co. Njoki cross-checks the business registrar. Alpha Construction's registered office is a residential flat in South B. Gamma Systems was registered 11 months ago with a paid-up capital of Ksh 10,000. Both have directors with the same surname as Peter's wife, who uses her maiden name on portfolio paperwork.

Pattern 2: Bid submissions. On 31 of the 42 tenders, Alpha and Gamma submitted their bids via Beta's office email address (traced through SPF records). The bid documents had identical formatting, font, and line-item labels. The "sealed bids" opened together.

Pattern 3: Price spreads. The winning Beta bid is always 0.8-2.1 percent below Alpha, and Alpha is always 4-7 percent below Gamma. The narrow band between low and second-low, combined with the wide band to the highest, is a textbook three-bid-controlled-auction signature.

Pattern 4: Work quality. Sampled post-completion, 6 of 12 recent Beta jobs had scope shortfalls under 10 percent of stated quantity — e.g., 40 sqm of waterproofing billed and paid for, 35 sqm actually delivered. Net over-billing on sampled jobs alone: Ksh 1.8 M.

Njoki's estimate: total owner exposure over 24 months is Ksh 6-9 M across inflated awards and quality shortfalls, excluding consequential damage (re-work costs, accelerated asset deterioration).

The firm's board wants an action plan. The managing director, Esther, must decide three things: (1) what to do about Peter (terminate? criminal referral? quiet exit?), (2) how to recover funds without destroying client relationships, (3) what new procurement controls replace the broken three-bid process.`,
  dataTable: {
    title: '24-month maintenance tender audit',
    rows: [
      { label: 'Portfolio units', value: '200' },
      { label: 'Annual maintenance spend', value: 'Ksh 48 M' },
      { label: 'Tenders audited', value: '42' },
      { label: 'Tenders with identical three bidders', value: '38 (90%)' },
      { label: 'Awards to Beta Works Ltd', value: '34%' },
      { label: 'Avg winning bid vs "lowest" bid', value: '~2% below' },
      { label: 'Bids submitted from Beta\'s domain', value: '31 (74%)' },
      { label: 'Sampled post-completion shortfall', value: '6 of 12 jobs (50%)' },
      { label: 'Net over-billing (sample)', value: 'Ksh 1.8 M' },
      { label: 'Estimated total exposure', value: 'Ksh 6-9 M over 24 months' },
    ],
  },
  decisionQuestion:
    'What is Esther\'s 72-hour action plan, her 30-day recovery plan, and her permanent procurement redesign?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is a "controlled-auction" or "phantom-bid" pattern in tender fraud?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is a narrow band between the lowest two bids and a wide band to the third a red flag?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design a 5-item red-flag list for future procurement reviews.',
      idealAnswerSketch:
        '(1) Same three bidders on >60% of tenders; (2) common submission IP / email; (3) common directors or registered addresses; (4) narrow low-to-second spread; (5) repeat wins concentrated above threshold.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If Esther terminates Peter today with cause, what evidence does she need pre-termination to defend the action?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the 4 patterns is the hardest for a defence lawyer to explain away, and why?',
      idealAnswerSketch:
        'Pattern 2 (shared submission email and identical formatting). Even collusion between independent firms does not naturally produce shared SPF records.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If Peter is terminated, what operational continuity risk does the portfolio face in the next 30 days?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Esther make a criminal referral, or resolve this civilly?',
      idealAnswerSketch:
        'Depends on jurisdiction and client expectations. Criminal referral is slow and damages the firm\'s brand. Civil recovery + termination is faster but sets a weaker deterrent. A hybrid (civil for Peter, criminal referral against the shell vendors) is often optimal.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft a replacement procurement process that is fraud-resistant without being slow.',
      idealAnswerSketch:
        'Rotating pre-qualified vendor bench (6+ per trade), blind-bid portal with buyer identity masked, tiered approval (below Ksh 150k caretaker-level, 150k-500k manager + compliance officer, above 500k board-level), quarterly spend-concentration report, random 5% post-completion audit.',
    },
  ],
  activity: {
    prompt:
      'You are Esther. Draft the 72-hour response memo to the board: what you will do, what you need approval for, and what you will not do.',
    deliverable: 'Memo + 30-day recovery action plan + permanent process chart.',
    timeBoxMinutes: 40,
  },
  quantitativeDeepDive: {
    title: 'Recovery vs disruption trade-off',
    setup:
      'Estimated recovery: Ksh 6-9 M. Cost of pursuing full recovery via courts: ~Ksh 1.2 M + 18 months. Cost of quiet settlement: ~Ksh 200k + 30 days. Compute expected net recovery under each path.',
    expectedAnswer:
      'Court path: expected net ~Ksh 4-6 M with 18-month float. Settlement path: expected net ~Ksh 2-4 M with 30-day float. Decision depends on discount rate + deterrence value.',
    solutionSketch:
      'Frame deterrence as a separate value stream. If deterrence matters to the client base, court path is preferred even if NPV is lower.',
  },
  discussionQuestions: [
    'How do you communicate this discovery to clients without triggering contract terminations?',
    'What is the smallest change to the three-bid rule that would have caught this earlier?',
    'If Peter\'s wife claims she had no knowledge of the shells, how does that change the legal posture?',
    'Is there a cultural-pattern angle that makes East African procurement particularly vulnerable to this?',
    'How do you train managers to spot red flags without turning procurement into paranoia?',
  ],
});
