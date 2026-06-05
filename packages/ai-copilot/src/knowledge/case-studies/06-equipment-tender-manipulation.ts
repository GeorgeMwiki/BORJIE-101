import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_06_EQUIPMENT_TENDER_MANIPULATION = defineCaseStudy({
  id: 'cs-06-equipment-tender-manipulation',
  title: 'Tender manipulation in mining contracts: detection and remedy',
  wordCount: 900,
  country: 'BOTH',
  tags: ['fraud', 'tender', 'procurement', 'governance', 'contractor'],
  difficulty: 'advanced',
  narrative: `A mid-tier producer running two pits in the Lake Zone spends roughly TZS 19 billion a year on mining-services and equipment contracts — drill-and-blast, load-and-haul, fuel, reagents, and earthmoving plant hire. The company uses a three-bid tender rule for any award above TZS 100 million. On paper the process is clean. In practice, over 24 months, an auditor finds that 34 percent of awarded contracts go to the same contractor — "Beta Earthmoving Ltd" — and the average awarded bid is within 2 percent of the "lowest" competing bid.

The procurement lead, Peter, has been with the company seven years and runs tendering as a side responsibility. Peter's defence: "Beta is good, they mobilise fast, and they are not the most expensive." The auditor, a contract CPA named Njoki, digs deeper.

Pattern 1: Of 42 three-bid tenders over 24 months, 38 had the same three bidders — Beta Earthmoving, Alpha Plant Hire, and Gamma Logistics. The rare variant used Delta Drilling. Njoki cross-checks the business registrar. Alpha Plant Hire's registered office is a residential plot in town. Gamma Logistics was registered 11 months ago with paid-up capital of TZS 1 million. Both have directors sharing a surname with Peter's spouse, who uses a maiden name on procurement paperwork.

Pattern 2: Bid submissions. On 31 of the 42 tenders, Alpha and Gamma submitted bids from Beta's office email domain (traced through SPF records). The bid documents had identical formatting, fonts, and line-item labels. The "sealed bids" opened together.

Pattern 3: Price spreads. The winning Beta bid is always 0.8-2.1 percent below Alpha, and Alpha is always 4-7 percent below Gamma. The narrow band between low and second-low, combined with the wide band to the highest, is a textbook controlled-auction signature.

Pattern 4: Delivery quality. Sampled post-completion, 6 of 12 recent Beta load-and-haul jobs showed quantity shortfalls under 10 percent — e.g., trucked tonnage billed and paid against survey-measured volumes that came up short, and fuel reconciliations that did not tie to engine-hours. Net over-billing on the sampled jobs alone: TZS 740 million.

Njoki's estimate: total owner exposure over 24 months is TZS 2.4-3.6 billion across inflated awards and quantity shortfalls, excluding consequential cost (re-work, accelerated fleet wear, schedule slippage at the pit).

The board wants an action plan. The managing director, Esther, must decide three things: (1) what to do about Peter (terminate? criminal referral? quiet exit?), (2) how to recover funds without halting the pit, and (3) what new procurement controls replace the broken three-bid process.`,
  dataTable: {
    title: '24-month mining-contracts tender audit',
    rows: [
      { label: 'Annual contracts spend', value: 'TZS 19 B' },
      { label: 'Tender threshold', value: 'TZS 100 M' },
      { label: 'Tenders audited', value: '42' },
      { label: 'Tenders with identical three bidders', value: '38 (90%)' },
      { label: 'Awards to Beta Earthmoving Ltd', value: '34%' },
      { label: 'Avg winning bid vs "lowest" bid', value: '~2% below' },
      { label: 'Bids from Beta\'s email domain', value: '31 (74%)' },
      { label: 'Sampled post-completion shortfall', value: '6 of 12 jobs (50%)' },
      { label: 'Net over-billing (sample)', value: 'TZS 740 M' },
      { label: 'Estimated total exposure', value: 'TZS 2.4-3.6 B over 24 months' },
    ],
  },
  decisionQuestion:
    'What is Esther\'s 72-hour action plan, her 30-day recovery plan, and her permanent procurement redesign — without stalling production at the pit?',
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
        'Design a 5-item red-flag list for future mining-contract procurement reviews.',
      idealAnswerSketch:
        '(1) Same three bidders on >60% of tenders; (2) common submission IP / email domain; (3) common directors or registered addresses; (4) narrow low-to-second spread with a wide gap to third; (5) repeat wins concentrated just above the tender threshold.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If Esther terminates Peter today with cause, what evidence must she lock down pre-termination to defend the action?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the 4 patterns is hardest for a defence lawyer to explain away, and why?',
      idealAnswerSketch:
        'Pattern 2 (shared submission domain and identical formatting). Even genuine collusion between independent firms does not naturally produce shared SPF records and byte-identical templates.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If Peter is terminated, what operational-continuity risk does the pit face in the next 30 days, given Beta runs the primary load-and-haul fleet?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Esther make a criminal referral, or resolve this civilly?',
      idealAnswerSketch:
        'Depends on jurisdiction and the cost of a production halt. Criminal referral is slow and can freeze the fleet that keeps the pit running. A hybrid is often optimal: civil recovery and termination for Peter, criminal referral against the shell contractors, and an interim haulage bridge so the pit does not stop.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft a replacement procurement process that is fraud-resistant without being slow enough to starve the pit.',
      idealAnswerSketch:
        'A rotating pre-qualified contractor bench (6+ per category), a blind-bid portal with buyer identity masked, tiered approval (below TZS 60 M supervisor, 60-250 M manager + compliance officer, above 250 M board-level), survey-verified payment certificates tied to independent volume/fuel reconciliation, a quarterly spend-concentration report, and random 5 percent post-completion audits.',
    },
  ],
  activity: {
    prompt:
      'You are Esther. Draft the 72-hour response memo to the board: what you will do, what you need approval for, the interim haulage bridge, and what you will not do.',
    deliverable: 'Memo + 30-day recovery action plan + permanent process chart.',
    timeBoxMinutes: 40,
  },
  quantitativeDeepDive: {
    title: 'Recovery versus production-disruption trade-off',
    setup:
      'Estimated recovery: TZS 2.4-3.6 B. Cost of full recovery via courts: ~TZS 480 M + 18 months, with a risk that the primary fleet demobilises and the pit loses 3-4 weeks of mining. Cost of a quiet settlement plus a controlled fleet transition: ~TZS 80 M + 30 days. Compute expected net recovery under each path.',
    expectedAnswer:
      'Court path: expected net ~TZS 1.6-2.4 B with an 18-month float AND a production-loss tail. Settlement path: expected net ~TZS 0.8-1.6 B with a 30-day float and no pit stoppage. The decision turns on the discount rate, the deterrence value, and the cost of lost mined ounces.',
    solutionSketch:
      'Frame deterrence and production continuity as separate value streams. The novel mining wrinkle versus a generic procurement fraud is that the fraudulent contractor often controls a critical fleet — so recovery strategy must be sequenced behind a haulage bridge, or the recovery is swamped by lost production.',
  },
  discussionQuestions: [
    'How do you communicate this discovery to your lenders and JV partners without triggering covenant calls?',
    'What is the smallest change to the three-bid rule that would have caught this earlier?',
    'If Peter\'s spouse claims no knowledge of the shell contractors, how does that change the legal posture?',
    'Is there a structural reason artisanal-to-mid-tier mining procurement is especially vulnerable to this?',
    'How do you train procurement staff to spot red flags without turning every tender into a paranoid bottleneck?',
  ],
});
