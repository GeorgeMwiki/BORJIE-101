import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_05_ANCHOR_OFFTAKE_RENEWAL = defineCaseStudy({
  id: 'cs-05-anchor-offtake-renewal',
  title: 'Renewal negotiation with a 15-year anchor off-taker',
  wordCount: 950,
  country: 'TZ',
  tags: ['offtake', 'anchor-buyer', 'negotiation', 'terms', 'retention'],
  difficulty: 'advanced',
  narrative: `Mwanza Refiners is a long-running gold doré buyer and exporter on the Lake Zone circuit. Its anchor supplier, "Songwe Mining," a mid-tier producer, has sold roughly 38,000 ounces a year through Mwanza since 2011 under a 15-year off-take agreement. The pricing term is a London PM fix less a 2.4 percent treatment-and-refining charge (TC/RC) and less a 0.6 percent assay-and-handling deduction. With the 2025 market moving, competing buyers are quoting fix-less-1.6 to 1.9 percent for comparable doré, and one international trader has offered Songwe a fix-less-1.4 percent structure with a modest prepayment line.

Songwe's off-take expires in 11 months. The Mwanza principal, Mrs. Otieno, has to decide her opening gambit. Her commercial lead, Brian, has already had two informal coffees with Songwe's treasury head, Diana. The signals are mixed. On one hand, Diana was candid that her board is looking hard at switching to the international trader for the better TC/RC and the prepayment. On the other, Diana mentioned that Mwanza's fast assay turnaround, TZS settlement under GN198/2025, and 3T-traceable, audited chain of custody are things Songwe's own compliance team values for its LBMA-aligned customers — "the clean-supply story is on our letterhead."

The numbers. Current effective deduction: 2.4 percent TC/RC + 0.6 percent = 3.0 percent off the London fix. On 38,000 oz at a USD 2,150 fix, Mwanza's gross margin from the deductions is about 0.030 x 2,150 x 38,000 = USD 2.45 million per year before Mwanza's own refining and export costs. A full loss of Songwe would trigger: (1) a stranded refining throughput gap that takes 6-9 months to backfill from smaller suppliers in a competitive market, (2) a buyer-incentive package to win a replacement anchor (a prepayment facility or a tighter TC/RC worth USD 1.2-2.0 M of margin), (3) broker/agent costs to source replacement volume (1.0-1.5 percent of metal value), and (4) reputational signalling if the anchor switches publicly.

Brian's model has four paths. Path A: hold firm at the current 3.0 percent deduction, expect a 60 percent probability Songwe leaves. Path B: cut to 2.0 percent (above the trader's 1.4 but a real concession), expect 85 percent stay. Path C: a graduated TC/RC — 1.6 percent year 1, 1.9 percent year 2, 2.2 percent year 3, 2.5 percent year 4, 2.7 percent year 5 — with an expected 90 percent stay. Path D: accept Songwe's likely counter of a flat 1.5 percent for 5 years, 95 percent stay.

Mrs. Otieno's priorities are stated but contradicting. She wants maximum NPV of the off-take margin over 5 years, but also hates idle refining capacity ("a starved circuit kills the unit economics"), and her compliance-minded co-director values Songwe's audited, mercury-free, 3T-clean supply on the customer-assurance sheet. Brian must present a recommendation that integrates margin NPV + utilisation + the clean-supply brand.`,
  dataTable: {
    title: 'Mwanza Refiners — anchor off-take renewal, 4 paths',
    rows: [
      { label: 'Anchor annual volume', value: '~38,000 oz' },
      { label: 'Current deduction (TC/RC + handling)', value: '3.0% of London fix' },
      { label: 'London PM fix (assumed)', value: 'USD 2,150 / oz' },
      { label: 'Current annual deduction margin', value: '~USD 2.45 M' },
      { label: 'Competing buyer quotes', value: 'fix less 1.6-1.9%' },
      { label: 'Trader offer', value: 'fix less 1.4% + prepayment' },
      { label: 'Path A deduction', value: '3.0% (60% stay)' },
      { label: 'Path B deduction', value: '2.0% (85% stay)' },
      { label: 'Path C deduction', value: 'Graduated 1.6%→2.7% (90% stay)' },
      { label: 'Path D deduction', value: '1.5% flat (95% stay)' },
      { label: 'Backfill throughput gap', value: '6-9 months' },
      { label: 'Replacement-anchor incentive', value: 'USD 1.2-2.0 M' },
    ],
  },
  decisionQuestion:
    'Which path does Brian recommend, and how does he frame the recommendation to Mrs. Otieno?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is expected value (EV), and how does it apply to the 4 paths?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why does a tighter TC/RC to retain an anchor off-taker ever make sense for a refiner?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the 5-year expected NPV of deduction margin for each path at a 14 percent discount rate. Include the backfill cost and replacement incentive in the "leave" branch.',
      idealAnswerSketch:
        'Path A EV NPV is dragged hard by the 60% leave branch (lost margin + backfill + incentive). Path B and Path C land highest because high stay probability preserves the volume; Path D preserves volume but at the thinnest margin. Rank typically C ~ B > A ~ D, but the numbers must be shown.',
    },
    {
      bloomLevel: 'apply',
      question:
        'What is the implied TC/RC in Path C year 3 versus the market, and is Mwanza ahead or behind?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which stated priority (margin NPV, utilisation, clean-supply brand) drives the recommendation, and how does the ordering change the choice?',
      idealAnswerSketch:
        'If margin NPV dominates: Path C. If utilisation dominates: Path C or D (keep the circuit fed). If clean-supply brand dominates: D (lock the anchor). Path A survives only on aggressive NPV with low utilisation weight.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What leverage does Songwe actually have, given 14 years of relationship and its need for an audited, traceable buyer?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is Songwe\'s switch probability really 60 percent under Path A, or is that overstated?',
      idealAnswerSketch:
        'Probably overstated. Switching costs Songwe re-onboarding, new assay reconciliation, chain-of-custody re-audit for its LBMA-aligned customers, and prepayment counterparty risk with the trader. The real number is likely 35-45% under Path A, not 60%. Challenge the assumption before pricing to it.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a creative term structure that protects margin while giving Songwe a face-saving headline concession.',
      idealAnswerSketch:
        'A 10-year off-take: years 1-2 at a sweetener 1.6 percent TC/RC, years 3-10 at 2.3 percent with a London-fix-linked floor, a modest Mwanza-funded prepayment line repaid from settled metal, and a 3T-clean-supply certification clause Songwe can cite to its customers. A volume band locks the throughput; the prepayment matches the trader\'s hook at lower cost to Mwanza.',
    },
  ],
  activity: {
    prompt:
      'You are Brian. Draft a 1-page negotiation brief for Mrs. Otieno with the recommended path, the opening offer, the walk-away deduction, and the 2 non-price concessions you will trade.',
    deliverable:
      'Brief + sensitivity to Songwe switch probability (40% / 55% / 70%).',
    timeBoxMinutes: 45,
  },
  quantitativeDeepDive: {
    title: 'Non-price concessions — what are they worth?',
    setup:
      'Quantify the economic value of: (1) a 24-month TC/RC freeze, (2) a USD 5 M prepayment facility at a 1-month repayment cycle, (3) a co-branded clean-supply certification clause Songwe can show its customers.',
    expectedAnswer:
      '(1) Freeze worth ~USD 0.9-1.2 M NPV at 14% depending on the deferred step-ups; (2) prepayment carries a real funding cost to Mwanza (~USD 70-90k/yr at a 1-month cycle and a 16% cost of funds) but is worth far more to Songwe\'s liquidity; (3) certification is near-zero hard cost to Mwanza but materially valuable to Songwe\'s customer assurance.',
    solutionSketch:
      'Non-price concessions are asymmetric: they cost the refiner less than their value to the off-taker. Use the prepayment and certification to relieve pressure on the TC/RC headline rather than racing the trader to the bottom on rate.',
  },
  discussionQuestions: [
    'How do you detect whether Songwe is bluffing about the trader prepayment offer?',
    'If Songwe accepts Path B, how do you re-price your OTHER suppliers\' deductions against the new anchor terms?',
    'What is the reputational cost of publicly losing the anchor supplier, and how do you mitigate it?',
    'How do you structure a volume-band or break clause that protects both sides?',
    'Would you ever accept Path D? Under what conditions?',
  ],
});
