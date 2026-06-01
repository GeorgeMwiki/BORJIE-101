import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_02_COOPERATIVE_LEVY_DISPUTE = defineCaseStudy({
  id: 'cs-02-cooperative-royalty-levy-dispute',
  title: 'The Nyarugusu cooperative levy dispute: a fairness audit',
  wordCount: 1000,
  country: 'TZ',
  tags: ['cooperative', 'royalty', 'levy', 'reconciliation', 'governance'],
  difficulty: 'intermediate',
  narrative: `Nyarugusu Wachimbaji AMCOS is a 64-member artisanal mining cooperative working oxide gold on a block of PMLs near Geita. Every gram a member produces is sold through the cooperative's gold desk, which deducts a 12 percent "cooperative levy" before paying the member. The levy is meant to cover three things: the 6 percent statutory royalty plus 1 percent clearing fee remitted to the Mining Commission, a shared-services pool (pumps, the communal ball mill, security at the buying station), and a small reserve. The levy has been 12 percent since 2021.

By late 2025, six members begin refusing to sell through the desk and start side-selling to a licensed buyer in town. Their complaint: the levy has quietly outgrown what the royalty and shared services actually cost, and the gap is disappearing into the desk.

The cooperative's new operations lead, Grace, inherits the dispute in January 2026. On day one she is handed five monthly gold-desk reconciliations dating back to August 2025. Each shows gold purchased from members, gold sold onward to the refiner, the royalty and clearing fee remitted, and the shared-services drawdown. The royalty line is correct — 7 percent of declared value, remitted on the GePG/Mining Commission portal against valid receipts. But the levy collected is 12 percent, and the difference between the 12 percent taken and the 7 percent + audited shared-services cost is larger every month.

Grace pulls the desk's weighbridge and assay book against the refiner settlements for the six months from August through December 2025:

- August: members delivered 4.20 kg, refiner settled 3.78 kg, gap 0.42 kg.
- September: delivered 4.55 kg, settled 4.05 kg, gap 0.50 kg.
- October: delivered 4.80 kg, settled 4.18 kg, gap 0.62 kg.
- November: delivered 4.70 kg, settled 4.12 kg, gap 0.58 kg.
- December: delivered 4.95 kg, settled 4.40 kg, gap 0.55 kg.

The gap averages 0.53 kg per month, roughly 12 percent of delivered metal. Some loss is real — smelt loss and moisture on dirty doré run 2-4 percent. A 12 percent disappearance is not metallurgical. At a desk price of TZS 165,000 per gram, 0.53 kg of unexplained loss is about TZS 87.5 million per month carried as "process loss" against the members' pool.

Grace audits the gold room at 4 a.m. (the quiet hour, when only the desk clerk and the security guard are present). She weighs incoming doré on a calibrated scale beside the desk's own, splits a retained assay sample, and watches a full smelt. The desk's scale reads 3 percent light, and the assay the desk books is consistently 1.5-2 grade points below the retained split. Two clerks have been under-weighing and under-assaying member metal, booking the difference as "process loss," and the desk's true smelt loss is under 3 percent.

Grace now has three problems, not one. First, the six side-sellers want a refund for the under-payment. Second, two clerks have been skimming for 20+ months. Third, the other 58 members have been silent but are owed the same correction — and some will not notice unless Grace tells them.

She has a quarterly general meeting in three weeks. She must present a fairness audit, a remediation plan, and a forward-looking governance fix — without destroying trust in the cooperative or admitting liability it cannot cover.`,
  dataTable: {
    title: 'Nyarugusu AMCOS — 6-month gold-desk audit',
    rows: [
      { label: 'Cooperative members', value: '64' },
      { label: 'Side-sellers (complainants)', value: '6' },
      { label: 'Cooperative levy', value: '12% of declared value' },
      { label: 'Statutory royalty + clearing', value: '7% (correctly remitted)' },
      { label: 'Audited shared-services cost', value: '~2% of value' },
      { label: 'Avg delivered vs settled gap', value: '0.53 kg / month (~12%)' },
      { label: 'Genuine smelt + moisture loss', value: '2-4%' },
      { label: 'Desk scale error', value: '3% light' },
      { label: 'Assay under-booking', value: '1.5-2 grade points' },
      { label: 'Unexplained loss value / month', value: 'TZS 87.5 M', note: 'at TZS 165,000/g' },
      { label: 'Root cause', value: 'Under-weigh + under-assay booked as process loss' },
    ],
  },
  decisionQuestion:
    'Grace has three weeks to the general meeting. What does her fairness-audit report recommend, and how does she handle members who have not yet noticed they were under-paid?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the purpose of an independent retained assay split when the desk already runs its own assay?',
    },
    {
      bloomLevel: 'understand',
      question:
        'If the delivered-versus-settled gap is consistently 12 percent, what does that tell you before you know the cause?',
      hint: 'Think genuine smelt loss vs scale error vs skimming.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the over-deduction per member for the 6 months if the true cost of royalty plus shared services is 9 percent but 12 percent was taken, on an average member contribution of 75 grams over the period.',
      idealAnswerSketch:
        'Over-deduction = 3 percentage points x 75 g x TZS 165,000/g = TZS 371,250 per member over the six months, before adding the scale/assay skim on top.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If Grace caps the audit at 6 months but the skim likely goes back 20 months, what is her minimum-exposure estimate and maximum-exposure estimate?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Why is an equal-rate correction (re-pricing every member at the corrected weight and assay) fairer than only refunding the six who complained?',
      idealAnswerSketch:
        'Because the skim was applied to every gram passing the desk, not just the loud members\' grams. The fairness question is not "who complained" but "whose metal was under-weighed." Correct the rate for all, back-pay by each member\'s recorded deliveries.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three problems (back-pay, the two clerks, silent members) is hardest to handle politically?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Grace proactively notify silent members, or wait for complaints?',
      idealAnswerSketch:
        'Proactively. Silence does not erase the obligation. A desk that back-pays only the side-sellers destroys trust faster than the skim did, and pushes more members off-desk.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the 3-point forward-looking governance fix that prevents this recurring.',
      idealAnswerSketch:
        '(1) Dual-witness weigh and a sealed retained assay split on every parcel, reconciled monthly against refiner settlements; (2) a published levy breakdown (royalty / shared services / reserve) with a >3 percent process-loss alert; (3) a rotating member audit committee with read-only access to the desk book and the GePG royalty receipts.',
    },
  ],
  activity: {
    prompt:
      'You are Grace. Write a 1-page general-meeting briefing memo with the audit findings, the proposed back-pay mechanism, the remedy for the two clerks, and the governance fix.',
    deliverable:
      'Memo + proposed back-pay schedule + 6-month forward delivered-vs-settled monitoring dashboard mock-up.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Extending the audit backwards',
    setup:
      'The two clerks took over the desk during a 2024 reorganisation. Assume the unexplained loss has been constant at TZS 87.5 M per month since August 2024. A fidelity-bond insurer will cover TZS 120 M once Grace proves the skim. Compute the net back-pay obligation and the per-member correction if the bond pays.',
    expectedAnswer:
      '18 months x TZS 87.5 M = TZS 1.575 B; net of TZS 120 M = TZS 1.455 B; allocated across the 64 members by their recorded deliveries (not equally).',
    solutionSketch:
      'Members with different delivery volumes over the period need a weighted allocation — allocate by grams delivered per month, not a flat split. Grace\'s general-meeting proposal should state the allocation key explicitly so no member feels averaged-down.',
  },
  discussionQuestions: [
    'How do you discuss the previous desk management\'s oversight without triggering a lawsuit or a split in the cooperative?',
    'If one member refuses the back-pay and insists on side-selling going forward, what is the escalation path under the cooperative by-laws?',
    'How does the correction interact with the royalty already remitted to the Mining Commission on under-declared weights?',
    'What is the minimum governance investment that pays for itself within one year of throughput?',
    'How do you communicate this to members who cannot read a reconciliation table?',
  ],
});
