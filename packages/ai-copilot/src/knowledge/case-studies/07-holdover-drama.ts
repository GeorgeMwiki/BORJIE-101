import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_07_HOLDOVER_DRAMA = defineCaseStudy({
  id: 'cs-07-holdover-drama',
  title: 'Holdover drama at lease-end: the 60-day dance',
  wordCount: 870,
  country: 'KE',
  tags: ['holdover', 'eviction', 'lease-end', 'settlement', 'dispute'],
  difficulty: 'intermediate',
  narrative: `Unit 4B at Lavington Green is a 3-bedroom apartment leased to a tenant, Mr. Chege, on a 2-year lease ending 30 April 2026. Rent is Ksh 140,000 per month. Deposit: Ksh 280,000. The landlord\'s property manager, Shiro, issues the 60-day notice of non-renewal on 28 February — the landlord wants to sell the unit to a buyer who has already put down a letter of intent contingent on vacant possession at 1 June 2026.

Mr. Chege initially acknowledges the notice over WhatsApp. On 15 March, Shiro follows up with a check-out schedule. Mr. Chege replies: "I have been discussing with your landlord directly. She said I can stay month-to-month." Shiro checks with the landlord, Mrs. Kamau. Mrs. Kamau says there was no such conversation — though she recalls Mr. Chege asking if she "would consider" extending, and she said "let me think about it." The "yes" is a fabrication.

From 1 April onwards, the tenant stops responding to check-out coordination messages. On 30 April, lease expires. Mr. Chege remains in place.

On 1 May, Shiro is at an impasse. The buyer is calling daily. The lease termination is lawful. Mr. Chege is now technically a "tenant at sufferance" — in holdover. Shiro has three realistic paths.

Path 1 — Court eviction. File for eviction in the Environment & Land Court. Timeline: 60-90 days minimum given case backlog. Cost: ~Ksh 180k legal + filing. Outcome: near-certain eviction order, possibly with costs awarded, but the buyer\'s LOI expires 1 July. If eviction takes the full 90 days, the sale falls through.

Path 2 — Settlement. Offer Mr. Chege a one-time "move-out incentive" of Ksh 150,000 plus 14-day grace. Dignified; risks rewarding bad behaviour; sets precedent.

Path 3 — Police + bailiffs on day 30 of holdover. High-risk; likely illegal self-help in most Kenyan contexts without a court order; reputational damage; could trigger tenant counter-suit and liability.

Mr. Chege\'s angle: Shiro has heard informally from another tenant that Mr. Chege lost his job in March and is waiting on a delayed severance from his employer, which will land "any day now." He is embarrassed. His wife is expecting their second child in July. Shiro now has to triangulate legal strategy + buyer relationship + human circumstance.

The landlord, Mrs. Kamau, has also now admitted she feels guilty — "the poor man" — and is oscillating on whether to sell at all. But the buyer has already given the legal transfer instructions to their lawyers. Backing out has its own costs.`,
  dataTable: {
    title: 'Lavington Green Unit 4B — holdover timeline',
    rows: [
      { label: 'Lease end', value: '30 Apr 2026' },
      { label: 'Notice served', value: '28 Feb 2026 (60-day)' },
      { label: 'Monthly rent', value: 'Ksh 140,000' },
      { label: 'Deposit held', value: 'Ksh 280,000' },
      { label: 'Buyer LOI expires', value: '1 Jul 2026' },
      { label: 'Path 1 court eviction timeline', value: '60-90 days' },
      { label: 'Path 1 legal cost', value: '~Ksh 180k' },
      { label: 'Path 2 settlement offer', value: 'Ksh 150k + 14-day grace' },
      { label: 'Tenant circumstance', value: 'Job loss + wife expecting' },
    ],
  },
  decisionQuestion:
    'Which path does Shiro recommend to Mrs. Kamau, and how does she communicate with Mr. Chege?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is a tenant at sufferance, and how is it different from a tenant at will?',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is self-help eviction (Path 3) generally unlawful in Kenya, even after lease expiry?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the expected value of Path 1 (court eviction) vs Path 2 (settlement) factoring in the Ksh 3.8 M sale value at risk.',
      idealAnswerSketch:
        'Path 1: P(sale falls through) ~0.5 given 60-90 day timeline vs 60-day LOI window. Loss if sale falls through: Ksh 150k-500k depending on buyer\'s willingness to re-sign. Plus Ksh 180k legal. Expected cost ~Ksh 330k-430k. Path 2: Ksh 150k + tenant reliability discount. Expected cost ~Ksh 200k. Settlement dominates on EV.',
    },
    {
      bloomLevel: 'apply',
      question:
        'What happens to Mr. Chege\'s deposit if he vacates on 14 May under a settlement?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Mrs. Kamau is oscillating. How does Shiro stabilize the principal without being pushy?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Is there a moral hazard in paying a holdover tenant to leave? Does this policy scale across a portfolio?',
      idealAnswerSketch:
        'Yes — if known to be routine, it incentivises holdover. But the cost of courts vs settlement in individual cases often favours settlement. Solution: confidentiality and case-specific framing, not routine.',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'If Mr. Chege\'s story (job loss, pregnant wife) is true, does that change Shiro\'s strategy or just her tone?',
      idealAnswerSketch:
        'Tone, not strategy. The landlord\'s obligation is commercial; the humane obligation is in how it is executed.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the WhatsApp message Shiro sends Mr. Chege today.',
      idealAnswerSketch:
        'Warm opener; acknowledges the situation; states the non-negotiable (the sale, the 1 June date); offers the settlement; names a deadline; leaves door open for a phone call.',
    },
  ],
  activity: {
    prompt:
      'You are Shiro. Produce (1) the WhatsApp message to Mr. Chege, (2) the email briefing Mrs. Kamau, (3) the fallback legal-escalation letter for day-7 no-response.',
    deliverable: 'Three drafts, plain text.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Per-diem damages model',
    setup:
      'If Mr. Chege stays 30 days past lease end, what are his liabilities under double-rent holdover clauses commonly found in Kenyan leases? Compute and compare to settlement cost.',
    expectedAnswer:
      'Double rent: Ksh 140k * 2 * (30/30) = Ksh 280k for the month, on top of deposit forfeiture. Enforceable in court but uncollectable if the tenant is insolvent.',
    solutionSketch:
      'The holdover clause is a posturing tool, not a reliable collection mechanism. Settle at Ksh 150k cash-in-hand.',
  },
  discussionQuestions: [
    'If Mr. Chege refuses settlement and demands to stay month-to-month, does Mrs. Kamau have a legal basis to set a new rate?',
    'How does Shiro protect the property physically during the dispute?',
    'If the buyer renegotiates the price down by Ksh 200k due to delay, who bears the cost?',
    'What coaching does Shiro need to give the landlord about not direct-negotiating with the tenant?',
    'How do you document the holdover for future reference without poisoning the relationship?',
  ],
});
