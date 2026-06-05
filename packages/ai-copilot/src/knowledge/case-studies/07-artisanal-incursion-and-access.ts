import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_07_ARTISANAL_INCURSION = defineCaseStudy({
  id: 'cs-07-artisanal-incursion-and-access',
  title: 'Artisanal incursion at the pit boundary: the 60-day standoff',
  wordCount: 890,
  country: 'TZ',
  tags: ['incursion', 'asm', 'access', 'community', 'dispute'],
  difficulty: 'intermediate',
  narrative: `The "Mgusu South" extension is a high-grade zone on a producing Mining Licence near Geita, scheduled to be drilled out and brought into the mine plan from 1 June 2026. A buyer of the company's future production has signed a letter of intent contingent on the extension delivering ounces on schedule. Then, in late March, a group of roughly 40 artisanal miners begins sinking pits along the extension's eastern boundary, following the same reef the company intends to mine.

The company's community-and-lands officer, Shiro, issues a formal boundary notice on 28 February — the licence is valid, the area is held, and unauthorised mining is unlawful. Some of the diggers initially acknowledge it. On 15 March, Shiro follows up with a proposed engagement meeting. A self-appointed spokesman replies: "We have been talking to your country manager directly. He said we can continue on the eastern strip." Shiro checks with the country manager, Mrs. Kamau. Mrs. Kamau says there was no such agreement — though she recalls a digger asking whether the company "would consider" a designated artisanal corridor, and she said "let me think about it." The "yes" is a fabrication.

From 1 April, the diggers stop responding to engagement messages and intensify work right up to the planned drill collars. On 30 April the company is at an impasse. The diggers are now, in effect, in unlawful occupation of part of the licence — an incursion. Shiro has three realistic paths.

Path 1 — Authorities and the Mining Commission. Lodge a formal complaint, request the resident mines officer and police to clear the incursion, and seek a court order to vacate the licence area. Timeline: 60-90 days minimum given process and backlog. Cost: ~TZS 18 million in legal and engagement. Outcome: a near-certain order to vacate, but the buyer's LOI expires 1 July. If clearing takes the full 90 days, the off-take slips.

Path 2 — Negotiated settlement. Offer the group a one-time relocation-and-support package — a demarcated artisanal corridor on a separate, lower-priority part of the licence, a modest mobilisation grant, and 14 days to move. Dignified; risks rewarding the incursion; sets precedent.

Path 3 — Private security plus a forced clearance. High-risk; likely unlawful self-help and a serious safety hazard around open artisanal pits; reputational damage; could trigger injury, a community backlash, and liability that dwarfs the production at stake.

The diggers' context: Shiro has heard informally that the rains failed upcountry and many of the group are seasonal farmers with no harvest income this year. They are embarrassed and desperate; several have families to feed. Shiro now has to triangulate legal strategy + the off-take relationship + the human and safety reality.

The country manager, Mrs. Kamau, has also begun to waver — "these are hungry people" — and is oscillating on whether to push the extension at all. But the buyer has already lined up its refining and shipping slots; backing out has its own costs.`,
  dataTable: {
    title: 'Mgusu South extension — incursion timeline',
    rows: [
      { label: 'Extension start date', value: '1 Jun 2026' },
      { label: 'Boundary notice served', value: '28 Feb 2026' },
      { label: 'Diggers on the strip', value: '~40' },
      { label: 'Buyer LOI expires', value: '1 Jul 2026' },
      { label: 'Path 1 authorities timeline', value: '60-90 days' },
      { label: 'Path 1 legal + engagement cost', value: '~TZS 18 M' },
      { label: 'Path 2 settlement offer', value: 'Demarcated corridor + grant + 14-day move' },
      { label: 'Production at risk', value: 'Off-take slot for the extension ounces' },
      { label: 'Diggers\' context', value: 'Seasonal farmers, failed harvest' },
    ],
  },
  decisionQuestion:
    'Which path does Shiro recommend to Mrs. Kamau, and how does she communicate with the diggers?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is an unlawful incursion onto a mining licence, and how is it different from a negotiated artisanal corridor under a formal arrangement?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is a private forced clearance (Path 3) both unlawful and dangerous around open artisanal workings, even on a valid licence?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the expected cost of Path 1 (authorities) versus Path 2 (settlement) factoring in the value of the off-take slot at risk.',
      idealAnswerSketch:
        'Path 1: P(off-take slips) ~0.5 given a 60-90 day clearance versus the 60-day LOI window. Loss if it slips: the value of delayed/forgone extension ounces plus re-scheduling cost, plus ~TZS 18 M legal. Path 2: corridor + grant cost, with a precedent/repeat-incursion discount. On expected value, a well-bounded settlement usually dominates if the corridor can be sited away from the mine plan.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If the group vacates the eastern strip under a settlement on 14 May, what safety and rehabilitation steps must precede the company drilling there?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Mrs. Kamau is oscillating. How does Shiro stabilise the decision-maker without being pushy?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Is there a moral hazard in paying a group to leave after an unlawful incursion? Does the corridor approach scale across the licence and the region?',
      idealAnswerSketch:
        'Yes — if it becomes known as routine, it can invite repeat incursions. But the cost of clearance versus settlement in individual cases often favours a negotiated corridor. The mitigation is a formal, documented ASM-engagement policy with clear criteria and a fixed footprint, not ad-hoc payouts.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'If the diggers\' story (failed harvest, hungry families) is true, does that change Shiro\'s strategy or just her tone?',
      idealAnswerSketch:
        'Mainly tone and the support component, not the core strategy. The company\'s obligation to protect its licence and its workers\' safety is firm; the humane obligation lives in how the relocation is executed, the safety of the pits left behind, and whether a legitimate corridor can give the group a lawful livelihood.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the message Shiro sends the diggers\' spokesman today.',
      idealAnswerSketch:
        'A respectful opener; acknowledges the hardship; states the non-negotiable (the boundary, the safety risk, the 1 June plan); offers the corridor-plus-support settlement; names a deadline; leaves the door open for a face-to-face meeting with elders present.',
    },
  ],
  activity: {
    prompt:
      'You are Shiro. Produce (1) the message to the diggers\' spokesman, (2) the briefing note to Mrs. Kamau, (3) the fallback escalation letter to the resident mines officer for a day-7 no-response.',
    deliverable: 'Three drafts, plain text.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Cost-of-delay model',
    setup:
      'If the incursion delays the extension by 30 days, model the cost: deferred recovered ounces from the high-grade zone, the value of the off-take slot if missed, and the standing cost of an idled drill crew and mining fleet waiting on the strip.',
    expectedAnswer:
      'The dominant cost is usually the standing fleet/crew plus the deferred high-grade ounces, not the legal spend; a 30-day slip on a high-grade extension can dwarf the entire settlement package.',
    solutionSketch:
      'The legal/authorities path looks "free" but its real cost is the production tail. A bounded settlement that buys back 30-45 days of schedule is frequently cheaper than the clearance even before counting reputational and safety exposure.',
  },
  discussionQuestions: [
    'If the diggers refuse the corridor and demand the eastern strip, does the company have a basis to re-sequence its mine plan instead?',
    'How does Shiro keep the boundary and the open pits physically safe during the standoff?',
    'If the buyer re-prices the off-take down due to the delay, who inside the company bears that cost?',
    'What coaching does Shiro give Mrs. Kamau about not negotiating informally and one-on-one with the group?',
    'How do you document the incursion for the Mining Commission file without inflaming the community?',
  ],
});
