import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_02_KINONDONI_SERVICE_CHARGE = defineCaseStudy({
  id: 'cs-02-kinondoni-service-charge-dispute',
  title: 'Kinondoni service-charge dispute: a fairness audit',
  wordCount: 980,
  country: 'TZ',
  tags: ['service-charge', 'water-meters', 'dispute', 'reconciliation', 'governance'],
  difficulty: 'intermediate',
  narrative: `Bahari Residences is a 64-unit apartment block in Kinondoni, Dar es Salaam, completed 2016. Service charge is Tsh 150,000 per unit per month, paid in addition to rent, and has been that number since 2021. By late 2025, six owner-occupier units (out of the 22 owner-occupiers in the block; the rest are investor-owned and leased out) begin withholding service charge. Their complaint: the water bill per unit has quietly tripled since mid-2024 while usage has not.

The property manager, Grace, inherits the dispute when she takes over the account in January 2026. On day one she is handed a stack of five monthly service-charge reconciliations dating back to July 2025. All five show water expense at Tsh 720,000 per month against a sub-metered expected total of Tsh 240,000. The gap is absorbed in the general service-charge pool — so every unit pays for the leak, even the ones not leaking.

Grace pulls the meters. The block has one main DAWASA meter at the gate and 64 sub-meters, one per unit, read by the caretaker on the 28th of each month. Cross-checking main vs sum-of-subs for the six months from July through December 2025, she finds:

- July: main 880 units, sum of subs 420 units, gap 460 units.
- August: main 910 units, sum of subs 405 units, gap 505 units.
- September: main 960 units, sum of subs 418 units, gap 542 units.
- October: main 940 units, sum of subs 412 units, gap 528 units.
- November: main 895 units, sum of subs 409 units, gap 486 units.
- December: main 920 units, sum of subs 420 units, gap 500 units.

The gap averages 504 units per month, roughly 54 percent of total consumption. That is too large for metering error. DAWASA tariff is Tsh 1,800 per unit for residential + 18 percent VAT. So the gap costs the block Tsh 504 * 1,800 * 1.18 = roughly Tsh 1,070,496 per month, absorbed into service-charge OPEX.

Grace tours the compound at 3 a.m. (the quiet water-audit hour) with the caretaker and a plumber. They close the main, open one unit's inlet at a time, and watch the main meter. The main moves 1.2 liters per minute with every inlet closed. Leak.

The plumber traces it to the pool-equipment feed line, which was replaced in 2023 during a refurb and tied into the domestic supply instead of a separate pool-fill meter. The pool has a small fill-valve leak and is also being topped up twice a week by the pool contractor — on the domestic meter.

Grace now has three problems, not one. First, the six owner-occupiers want a refund for overpaid service charge. Second, the pool contractor has been effectively sub-billing the block for 20+ months. Third, the remaining 16 owner-occupiers and 42 investor-owners have been silent but are now owed the same refund — and some will not notice unless Grace tells them.

She has a quarterly AGM in three weeks. She must present a fairness audit, a remediation plan, and a forward-looking governance fix — without destroying trust in the previous manager or admitting liability the management company cannot cover.`,
  dataTable: {
    title: 'Bahari Residences — 6-month water audit',
    rows: [
      { label: 'Units in block', value: '64' },
      { label: 'Owner-occupiers', value: '22' },
      { label: 'Service charge / unit / month', value: 'Tsh 150,000' },
      { label: 'Expected monthly water expense', value: 'Tsh 240,000' },
      { label: 'Actual monthly water expense', value: 'Tsh 720,000' },
      { label: 'Avg gap (main vs sum-of-subs)', value: '504 units / month' },
      { label: 'Cost of gap / month (incl 18% VAT)', value: 'Tsh 1,070,496' },
      { label: 'Months affected', value: 'July 2025 – December 2025 (minimum)' },
      { label: 'Minimum overcharge total', value: 'Tsh 6.42 M' },
      { label: 'Per-unit refund (equal split)', value: 'Tsh 100,312 over 6 months' },
      { label: 'Root cause', value: 'Pool feed on domestic meter + valve leak' },
    ],
  },
  decisionQuestion:
    'Grace has three weeks to the AGM. What does her fairness-audit report recommend, and how does she handle owners who have not yet noticed they are owed money?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What is the purpose of having sub-meters when there is already a main meter?',
    },
    {
      bloomLevel: 'understand',
      question:
        'If the main-vs-subs gap is consistently 50+ percent, what does that tell you before you know the cause?',
      hint: 'Think leak vs meter error vs billing error.',
    },
    {
      bloomLevel: 'apply',
      question:
        'Compute the per-unit refund for the 6 affected months if distributed equally across all 64 units.',
      idealAnswerSketch: 'Tsh 1,070,496 * 6 / 64 = Tsh 100,359 per unit.',
    },
    {
      bloomLevel: 'apply',
      question:
        'If Grace caps the audit at 6 months but the leak likely goes back 20 months, what is her minimum-exposure estimate and maximum-exposure estimate?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Why is equal-split refunding the fairest option even though the actual water was consumed by the pool, not the units?',
      idealAnswerSketch:
        'Because the pool is a shared amenity. The fairness question is not "who used it" but "who paid for it via which pool." Service charge pooled the cost; refund must pool the return.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'Which of the three problems (refund, pool contractor, silent owners) is hardest to handle politically?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Should Grace proactively notify silent owners, or wait for complaints?',
      idealAnswerSketch:
        'Proactively. Silence does not erase the obligation. A manager who refunds only the loud owners destroys trust faster than the leak did.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the 3-point forward-looking governance fix that prevents this recurring.',
      idealAnswerSketch:
        '(1) Separate pool-feed meter billed to a shared-amenity sub-account; (2) monthly main-vs-subs reconciliation with >10% variance alert; (3) rotating owner audit committee with read-only access to service-charge accounts.',
    },
  ],
  activity: {
    prompt:
      'You are Grace. Write a 1-page AGM briefing memo with the audit findings, the proposed refund mechanism, the pool-contractor remedy, and the governance fix.',
    deliverable:
      'Memo + proposed refund schedule + 6-month forward variance-monitoring dashboard mock-up.',
    timeBoxMinutes: 30,
  },
  quantitativeDeepDive: {
    title: 'Extending the audit backwards',
    setup:
      'The pool line was retied during the 2023 refurb. Assume the gap has been constant at Tsh 1.07 M/month since July 2024. Insurance will cover Tsh 3 M once Grace proves negligence by the previous manager. Compute the net refund obligation and per-unit refund if insurance pays.',
    expectedAnswer:
      '18 months * Tsh 1,070,496 = Tsh 19.27 M; net of Tsh 3 M = Tsh 16.27 M; per unit across 64 units = Tsh 254,219.',
    solutionSketch:
      'Owners with unit changes mid-period need a rolled allocation — allocate by months of ownership, not by snapshot. Grace\'s AGM proposal should include the allocation key explicitly.',
  },
  discussionQuestions: [
    'How do you discuss the previous manager\'s oversight without triggering a lawsuit?',
    'If one owner refuses to accept the refund and insists on withholding service charge going forward, what is the escalation path?',
    'How does the refund obligation interact with the investor-owner leases (who benefited from the lower apparent service charge in their marketing)?',
    'What is the minimum governance investment that pays for itself in one year?',
    'How do you communicate this to tenants (non-owners) who have been paying indirectly through their rent?',
  ],
});
