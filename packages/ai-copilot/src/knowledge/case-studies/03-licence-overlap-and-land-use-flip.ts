import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_03_LICENCE_OVERLAP_FLIP = defineCaseStudy({
  id: 'cs-03-licence-overlap-and-land-use-flip',
  title: 'The Mbeya licence-overlap play: a value-add tailings-retreatment thesis',
  wordCount: 1060,
  country: 'TZ',
  tags: ['value-add', 'licence-overlap', 'tailings-retreatment', 'surface-rights', 'playbook'],
  difficulty: 'expert',
  narrative: `In early 2026 the Mining Commission completes a cadastre clean-up around the Chunya goldfield in Mbeya region, retiring a band of long-dormant PMLs and opening the underlying ground. What was a patchwork of overlapping artisanal claims for two decades can now be consolidated under a single Mining Licence (ML), with the historical tailings dumps on surface forming part of the application. A value-add operator, Njia Resources, spots the opportunity three weeks before most of the local agents do.

The target: the "Saza dumps," roughly 480,000 tonnes of legacy stamp-mill and amalgamation tailings accumulated by artisanal miners over 25 years, sitting on a 0.9 square-kilometre block that is 65 percent encumbered by a tangle of expired PMLs and one live PML whose holder, a local elder, has surface-rights leverage even though his licence covers only a corner. The seller of the operating interest is a fatigued junior that built a small gravity plant, never reached steady throughput, and now wants out.

Asking price: TZS 9.2 billion for the operating company plus its plant and the dump rights. In-place economics: the gravity plant recovers only the coarse free gold the artisanals missed — about 0.4 g/t recovered against a dump head grade assayed at 1.1 g/t, because amalgamation tailings lock gold in fine and sulphide-associated form that gravity cannot catch. Current throughput 300 tpd, 70 percent utilisation. Njia's hypothesis: re-permit the consolidated block as an ML, install a CIL leach behind the gravity circuit to lift recovery from 0.4 g/t to 0.85 g/t recovered, and capture the arbitrage between a tired gravity-only operation and a properly leached retreatment — PLUS the value of consolidating the overlapping ground into one clean, financeable title.

Capex budget, internal estimate: TZS 6.8 billion all-in. CIL tankage, a regrind mill, a lined tailings cell for the re-processed residue, leach reagents and detox, the cadastre consolidation costs, and a 15 percent contingency. Timeline: 14 months to commission, 8 months to ramp to nameplate. Total hold through stabilisation: 24 months from close.

Njia's model: post-ramp recovered grade 0.85 g/t over 300 tpd at 90 percent utilisation processes ~88,700 tonnes/year for ~75,400 grams recovered, ~2,425 oz/yr. At USD 2,150/oz, net of the 7 percent royalty-plus-clearing, that is ~USD 4.85 M/yr revenue, against a far lower unit cost than mining fresh rock because the ore is already broken and on surface. Capitalised at a retreatment multiple, Njia sees roughly TZS 6 B of value creation over the TZS 16 B all-in cost base before time value.

The analyst, Kiptoo, is asked to pressure-test this before the investment committee. He finds four weak spots. First, the live-PML elder controls the only legal road to the dumps and has surface-rights leverage the cadastre clean-up does not erase — without his consent or a negotiated relinquishment, the ML may be granted over ground Njia cannot physically access. Second, the dump's 1.1 g/t head grade comes from the junior's own auger sampling, never QA-QC'd; retreatment economics live or die on grade, and amalgamation dumps are notoriously variable. Third, the cadastre consolidation has a public-objection window during which overlapping former holders can contest the ML grant — Njia would close before it expires. Fourth, the mercury in the amalgamation tailings makes the residue a regulated waste; the lined cell and detox in the budget may be undersized for NEMC sign-off.

The IC meeting is Tuesday. Kiptoo has to present a go / no-go recommendation with explicit sensitivities.`,
  dataTable: {
    title: 'Saza dumps — retreatment underwriting',
    rows: [
      { label: 'Resource', value: '~480,000 t legacy tailings' },
      { label: 'Block area', value: '0.9 km^2' },
      { label: 'Encumbrance', value: '65% expired PMLs + 1 live PML (corner)' },
      { label: 'Asking price', value: 'TZS 9.2 B' },
      { label: 'Dump head grade (un-QAQC\'d)', value: '1.1 g/t Au' },
      { label: 'Recovered grade (gravity only)', value: '0.4 g/t' },
      { label: 'Recovered grade (with CIL, plan)', value: '0.85 g/t' },
      { label: 'Throughput', value: '300 tpd' },
      { label: 'Capex budget', value: 'TZS 6.8 B' },
      { label: 'Commissioning timeline', value: '14 months' },
      { label: 'Ramp to nameplate', value: '8 months' },
      { label: 'Post-ramp recovered metal', value: '~2,425 oz/yr' },
      { label: 'Realised gold price', value: 'USD 2,150 / oz' },
      { label: 'Plan value creation', value: '~TZS 6 B (pre-time-value)' },
    ],
  },
  decisionQuestion:
    'Kiptoo walks into IC on Tuesday. Go, no-go, or go with conditions? What is the floor price below which the deal must be?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question: 'What is recovered grade, and how does it differ from head grade?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why can a CIL leach recover gold from amalgamation tailings that a gravity circuit cannot?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute annual recovered ounces and gross revenue at 0.85 g/t recovered, 300 tpd, 90 percent utilisation, USD 2,150/oz.',
      idealAnswerSketch:
        '300 x 365 x 0.90 = 98,550 t/yr; x 0.85 g/t = 83,768 g = 2,693 oz; x USD 2,150 = ~USD 5.79 M gross before royalty. (Njia\'s ~2,425 oz uses a more conservative tonnage; either is defensible if stated.)',
    },
    {
      bloomLevel: 'analyze',
      question:
        'If the elder\'s live PML blocks road access, what happens to the 24-month plan, and what is the financing impact of an unbankable title?',
      idealAnswerSketch:
        'Without access or relinquishment the ML is granted over stranded ground; the asset cannot be financed or operated. The IC should make a negotiated access/relinquishment a hard condition, not a post-close workstream.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Is the 1.1 g/t dump grade defensible given it came from un-QA-QC\'d auger sampling on a heterogeneous amalgamation dump?',
      hint: 'Sampling theory: nugget effect, sample mass, splitting protocol, certified reference materials.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Which of the four weak spots (access/surface rights, grade confidence, objection window, mercury-waste sizing) most threatens the return, and why?',
      idealAnswerSketch:
        'The surface-rights access. The other three are bounded — grade can be drilled, the window can be waited out, the cell can be resized. No legal road kills the thesis outright; the return is undefined if the ore cannot be reached.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'What price reduction would you need to absorb all four risks and still hit a 22 percent unlevered IRR?',
    },
    {
      bloomLevel: 'create',
      question:
        'Design 3 conditions precedent that let Njia proceed without overpaying for the consolidation risk.',
      idealAnswerSketch:
        '(1) A signed access easement or PML relinquishment from the elder before completion; (2) an independent QP grade re-estimate with deferred consideration (TZS 1.5 B held in escrow for the objection window and released only on un-contested ML grant); (3) NEMC-approved detox and lined-cell design as a completion condition, with seller funding any shortfall via a price reduction.',
    },
  ],
  activity: {
    prompt:
      'You are Kiptoo. Prepare an IC memo (1 page) + scenario table (base / bear / bull) with explicit surface-rights outcomes and a go/no-go ladder by price.',
    deliverable: 'Memo + 3-scenario recovered-ounce and IRR grid.',
    timeBoxMinutes: 60,
  },
  quantitativeDeepDive: {
    title: '5-scenario sensitivity to recovered grade and ramp pace',
    setup:
      'Build a 5x5 sensitivity grid of recovered grade (0.6 / 0.7 / 0.85 / 1.0 / 1.1 g/t) against ramp months to nameplate (6 / 8 / 10 / 12 / 14). Solve for unlevered IRR at each cell over a 7-year dump life.',
    expectedAnswer:
      'Base case at 0.85 g/t / 8 months ~16% IRR; the plan case is unrealistic unless leach recovery on fine, mercury-locked gold is independently confirmed.',
    solutionSketch:
      'The sensitivity shows the deal is most sensitive to recovered grade (slope ~1.4% IRR per 0.1 g/t), moderately sensitive to ramp pace (slope ~0.6% IRR per 2 months), and almost invariant to reasonable reagent-cost assumptions. Recovered grade dominates — which is exactly why the un-QA-QC\'d sampling is the diligence priority.',
  },
  discussionQuestions: [
    'How does the strategy change if Njia holds the retreatment for 7 years versus exiting at stabilisation?',
    'Would you prefer to partner with the incumbent junior or buy them out cleanly?',
    'How do you price the public-objection / ML-grant risk explicitly rather than implicitly?',
    'What is the ESG and mercury-remediation angle here, and does it matter to your lenders?',
    'If the ML grant is contested at year 3 by a former overlapping holder, what is your mitigation playbook?',
  ],
});
