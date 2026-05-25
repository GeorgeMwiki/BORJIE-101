import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_05_ANCHOR_RENEWAL = defineCaseStudy({
  id: 'cs-05-anchor-tenant-renewal',
  title: 'Renewal negotiation with a 15-year anchor tenant',
  wordCount: 930,
  country: 'KE',
  tags: ['renewal', 'anchor-tenant', 'negotiation', 'below-market', 'retention'],
  difficulty: 'advanced',
  narrative: `Kenyatta Heights is a 14,000-sqm commercial block on Kenyatta Avenue. Its anchor tenant, the regional office of a multinational auditing firm, has occupied 3,200 sqm on the top four floors since 2011 at a rent of Ksh 62 per sqf per month. With the 2025 market moving, comparable rents on Kenyatta Avenue now sit at Ksh 110-135 per sqf for refurbished Grade-A space and Ksh 88-105 for Grade-B. Kenyatta Heights is a strong B+ — recent lift modernisation, new chiller, marble lobby.

The anchor's 15-year lease expires in 11 months. The landlord, a private owner called Mrs. Otieno, has to decide her opening gambit. Her portfolio manager, Brian, has already had two informal coffees with the anchor's regional facilities lead, Diana. The signals from those coffees are mixed. On the one hand, Diana was candid that her regional CFO is looking hard at a consolidated office move to Garden City or Westlands and has three RFPs out. On the other hand, Diana mentioned the anchor's brand-heritage team had flagged "the Kenyatta Avenue address is on our letterhead for 14 years" as a retention factor.

The numbers. Current passing rent: 3,200 sqf (assume sqm to sqf translation already captured) at Ksh 62 = Ksh 198,400 per month, or Ksh 2.38 M per year. At mid-market refurbished B+ of Ksh 100 per sqf, the same space would earn Ksh 3.84 M per year — Ksh 1.46 M uplift. A full move-out by the anchor would trigger: (1) minimum 6-9 months of vacancy to re-tenant 3,200 sqf of anchor space in a soft market, (2) a fit-out incentive package to whoever replaces them (Ksh 18-25 M), (3) broker fees (10-12 percent of annual rent), (4) reputational impact on the building if the anchor decamps publicly.

Brian's model has four paths. Path A: hold firm at Ksh 110 per sqf, expect a 60 percent probability the anchor leaves. Path B: offer Ksh 88 per sqf (below comparable but a 42 percent uplift on current), expect 85 percent stay probability. Path C: offer a graduated rent — Ksh 75 year 1, Ksh 88 year 2, Ksh 100 year 3, Ksh 110 year 4, Ksh 118 year 5 — with expect 90 percent stay probability. Path D: accept the anchor's likely counter of Ksh 75 per sqf flat for 5 years, 95 percent stay probability.

Mrs. Otieno's priorities are stated but contradicting. She wants maximum NPV over 5 years, but also hates vacant space ("a vacant lobby kills the building"), and her brand-conscious husband values the auditing firm's name on the tenant-roster marketing sheet. Brian must present a recommendation that integrates NPV + vacancy-tolerance + brand.`,
  dataTable: {
    title: 'Kenyatta Heights anchor renewal — 4 paths',
    rows: [
      { label: 'Anchor space', value: '3,200 sqf (top 4 floors)' },
      { label: 'Current rent / sqf / month', value: 'Ksh 62' },
      { label: 'Current annual rent', value: 'Ksh 2.38 M' },
      { label: 'Mid-market B+ / sqf / month', value: 'Ksh 100' },
      { label: 'Path A rent', value: 'Ksh 110 (60% stay)' },
      { label: 'Path B rent', value: 'Ksh 88 (85% stay)' },
      { label: 'Path C rent', value: 'Graduated 75→118 (90% stay)' },
      { label: 'Path D rent', value: 'Ksh 75 flat (95% stay)' },
      { label: 'Re-tenanting vacancy', value: '6-9 months' },
      { label: 'Fit-out incentive (replacement)', value: 'Ksh 18-25 M' },
      { label: 'Broker fee', value: '10-12% of annual rent' },
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
        'Why does below-market rent to retain an anchor ever make sense for a landlord?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute 5-year expected NPV for each path at a 12% discount rate. Include vacancy + re-tenanting cost in the "leave" branch.',
      idealAnswerSketch:
        'Path A EV NPV ~Ksh 12.4 M (heavily dragged by leave branch). Path B ~Ksh 14.8 M. Path C ~Ksh 15.3 M. Path D ~Ksh 12.1 M.',
    },
    {
      bloomLevel: 'apply',
      question:
        'What is the implied rent for Path C in year 3 vs the market? Is the landlord behind or ahead?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the stated priorities (NPV, vacancy-tolerance, brand) drives the recommendation, and how does the ordering affect the choice?',
      idealAnswerSketch:
        'If NPV dominates: Path C. If vacancy-tolerance dominates: Path C or D. If brand dominates: D. Path A survives only under aggressive NPV with low brand weight.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What negotiation leverage does the anchor actually have, given 14-year tenure and brand signalling?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is the anchor\'s move-out probability really 60% under Path A, or is that overstated?',
      idealAnswerSketch:
        'Probably overstated. Moving 3,200 sqf costs the anchor firm ~Ksh 40 M in fit-out, disruption, and client-communication. The real number is likely 35-45% stay attrition at Path A, not 60%. Challenge the assumption.',
    },
    {
      bloomLevel: 'create',
      question:
        'Design a creative term structure that protects NPV while offering the anchor a face-saving "below-market" headline.',
      idealAnswerSketch:
        '10-year lease with years 1-2 at Ksh 75 (sweetener), years 3-10 at market + 3% annual escalator, tenant-improvement allowance of Ksh 8 M amortised over the 10-year term, break clause in year 7 with 18-month notice.',
    },
  ],
  activity: {
    prompt:
      'You are Brian. Draft a 1-page negotiation brief for Mrs. Otieno with the recommended path, the opening offer, the walk-away number, and the 2 non-rent concessions you will trade.',
    deliverable:
      'Brief + sensitivity to anchor move-out probability (40% / 55% / 70%).',
    timeBoxMinutes: 45,
  },
  quantitativeDeepDive: {
    title: 'Non-rent concessions — what are they worth?',
    setup:
      'Quantify the economic value of: (1) a 24-month rent-review freeze, (2) 3 months of free fit-out contribution, (3) a naming-rights clause on the lobby directory.',
    expectedAnswer:
      '(1) Freeze worth ~Ksh 1.2 M NPV at 12%; (2) 3 months fit-out = Ksh 1.44 M; (3) naming rights ~zero hard economic cost but ~Ksh 2-5 M annual brand value to anchor.',
    solutionSketch:
      'Non-rent concessions are asymmetric: they cost the landlord less than their value to the tenant. Use them to lower rent "ask" pressure.',
  },
  discussionQuestions: [
    'How do you detect whether the anchor is bluffing about the Garden City RFP?',
    'If the anchor accepts Path B, how do you price the OTHER tenants\' renewals against the new anchor rent?',
    'What is the reputational cost of publicly losing the anchor, and how do you mitigate it?',
    'How do you structure a break clause that protects both sides?',
    'Would you ever accept Path D? Under what conditions?',
  ],
});
