/**
 * Wave 13 short-form case corpus — 22 additional 200-400 word mining case
 * studies covering operations, processing, compliance, finance, and
 * strategy patterns. They complement the 10 longform HBR-style cases
 * already in this directory and bring the total above the 30-case bar
 * the platform-wide case-study corpus targets.
 *
 * Each short case follows the same `CaseStudy` interface so the seeder
 * treats them identically — a shorter narrative, a minimal data table,
 * a single decision question, a Socratic path of 2-3 questions, and one
 * activity. No quantitative deep-dive on short cases.
 */

import { defineCaseStudy, type CaseStudy } from './case-study-types.js';

const SHORT_CASES: readonly CaseStudy[] = [
  defineCaseStudy({
    id: 'cs-11-asm-levy-arrears-kahama',
    title: 'The chronic levy-arrears pattern in a 24-member Kahama cooperative',
    wordCount: 260,
    country: 'TZ',
    tags: ['cooperative', 'levy-arrears', 'collections'],
    difficulty: 'intermediate',
    narrative: `Seven of 24 members in a Kahama gold cooperative have slipped into a stable rhythm of selling part of their production off-desk and settling the cooperative levy weeks late. The chair is an upcountry trader who travels for 10 days every month, and the desk clerk has grown used to excuses — "I will top up after the next pour," "school fees this week," "GePG was down." The levy ledger shows balances bouncing between TZS 450k and TZS 1.2M per member, never clearing, never escalating. Penalty interest is in the by-laws but never applied. Member turnover is low, which the chair reads as loyalty; Mr. Mwikila reads it as tolerated slippage that has become the new normal — and as under-remitted royalty risk, because off-desk metal is not being declared.

Three of the seven are long-standing members (>5 years); two are recent; two share an M-Pesa sender, hinting at a family cluster. Levy owed across the 24 members hovers at TZS 6.5M on any given day — roughly two weeks of desk margin. The chair asks whether to "just write it off and move on."`,
    dataTable: {
      title: 'Kahama levy-arrears snapshot',
      rows: [
        { label: 'Members in chronic arrears', value: '7 of 24' },
        { label: 'Average balance per member', value: 'TZS 780k' },
        { label: 'Total levy arrears', value: 'TZS 6.5M' },
        { label: 'Penalty interest applied', value: 'TZS 0' },
      ],
    },
    decisionQuestion:
      'What would you do in the next 30 days to reset the levy-collection culture without losing the long-standing members?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why do chronic arrears persist even when penalty interest exists in the by-laws?',
      },
      {
        bloomLevel: 'evaluate',
        question:
          'Is aggressive enforcement or a phased catch-up plan the right lever here?',
      },
    ],
    activity: {
      prompt: 'Draft the first 30-day levy-collection plan for these 7 members.',
      deliverable: 'One-page memo to the chair with a ladder + expected recoveries + royalty-declaration fix.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: [
      'How would you split these seven into enforcement tiers?',
      'What would make you expel a chronically off-desk member?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-12-recovery-balance-drift',
    title: 'When the metallurgical balance does not close: reconciling 6 months of recovery drift',
    wordCount: 240,
    country: 'TZ',
    tags: ['metallurgy', 'recovery', 'reconciliation'],
    difficulty: 'intermediate',
    narrative: `A small 300 tpd Mwanza plant has been showing a stubborn ~4 percent gap between the gold its grade model says it fed and the gold the gold room poured, six months running. The plant manager wants to write it off as "normal loss." The metallurgist blames "the feed grade." The gold-room foreman blames "the assay lab."

Mr. Mwikila walks the circuit with the plant metallurgist. Two changes landed in the last year: a new high-grade ore source was blended in without re-tuning the leach residence time, and the gravity concentrator's recovery has quietly fallen as the cones wore. The tails assay shows gold reporting to the tailings dam well above target — an almost-perfect match for the gap. The "loss" is not loss; it is unrecovered gold walking out in the tails.

The owner considers three actions: (1) accept the gap and lower the forecast; (2) re-tune the leach and replace the gravity cones; (3) audit the gold-room balance for skimming. Mr. Mwikila's framing: a recovery gap is a process signal, not an accounting rounding — chase it to the tails before you write it off.`,
    dataTable: {
      title: 'Recovery-drift reconciliation',
      rows: [
        { label: 'Model-vs-poured gap', value: '~4%' },
        { label: 'Duration', value: '6 months' },
        { label: 'Tails assay', value: 'Above target' },
        { label: 'Gravity-cone refurbishment cost', value: 'TZS 22M' },
      ],
    },
    decisionQuestion: 'Which of the three actions — or which combination — would you recommend?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is it dangerous to write a recovery gap off as "normal loss"?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the test work plan to localise where the gold is being lost.',
      },
    ],
    activity: {
      prompt: 'Write the owner memo explaining the root cause and the proposed fix.',
      deliverable: 'Two-paragraph memo + a tails-monitoring routine.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: [
      'What governance change prevents recovery drift from going unnoticed again?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-13-early-contract-termination',
    title: 'A contractor requesting early termination mid-term',
    wordCount: 230,
    country: 'TZ',
    tags: ['contract', 'termination', 'mining-services'],
    difficulty: 'intermediate',
    narrative: `A load-and-haul contract at a Geita pit runs through December 2027. In April 2026 the contractor — whose fleet is suddenly in demand at a larger mine paying better rates — requests early termination effective end-May. The contract has a standard exit clause: 2 months' notice plus a demobilisation/early-exit fee equal to 2 months of contracted rates. The contractor asks for the fee to be waived on grounds of "unavoidable redeployment."

The contract is currently priced slightly below the going market rate for haulage. Mr. Mwikila's read: the producer could credibly re-tender the haulage at a market reset, and could ask the departing contractor to bridge until a replacement mobilises. The question is whether to strictly enforce the exit fee, waive it, or structure a managed handover.`,
    dataTable: {
      title: 'Exit-clause math',
      rows: [
        { label: 'Months remaining', value: '19' },
        { label: 'Contracted rate', value: 'Below market' },
        { label: 'Market haulage rate', value: '~10% higher' },
        { label: 'Early-exit fee per contract', value: '2 months of rates' },
      ],
    },
    decisionQuestion: 'Enforce, waive, or structure a managed handover?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the producer actually trying to protect with the early-exit fee?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'How does the below-market contracted rate change the calculation?',
      },
    ],
    activity: {
      prompt: 'Draft the counter-proposal to the contractor.',
      deliverable: 'One-paragraph response.',
      timeBoxMinutes: 20,
    },
    discussionQuestions: ['Would your answer change if the contract were above market?'],
  }),

  defineCaseStudy({
    id: 'cs-14-cil-retrofit-permit',
    title: 'Adding a CIL leach behind a gravity plant: permits and capex',
    wordCount: 300,
    country: 'TZ',
    tags: ['cil-retrofit', 'permit', 'capex'],
    difficulty: 'advanced',
    narrative: `A Geita operator runs a 250 tpd gravity-only plant recovering coarse free gold at 1.4 g/t against a 2.4 g/t head — leaving most of the fine and locked gold in the tails. A reagent supplier and an EPC contractor propose bolting a CIL leach behind the gravity circuit: capex TZS 2.2 billion, projected recovered grade rising to 2.0 g/t, but the change requires an environmental certificate variation for cyanide use, a detox circuit, and a lined residue cell.

The operator's environmental consultant estimates the NEMC certificate variation at TZS 90 million in fees and 4-6 months. The detox-and-cell capex to the operator's account: another TZS 0.6 billion. The cooperative members feeding the plant are nervous about cyanide near the village water source; three would stop delivering if the leach goes in without a credible safety story.

The decision: pursue the variation, negotiate, or decline. Mr. Mwikila's frame: it is a real option — every month delayed is a month of recoverable gold walking out in the tails if approval succeeds, but a rejected or contested cyanide variation leaves an environmental and community problem to untangle.`,
    dataTable: {
      title: 'CIL-retrofit math',
      rows: [
        { label: 'Recovered-grade uplift', value: '1.4 → 2.0 g/t' },
        { label: 'Leach capex', value: 'TZS 2.2B' },
        { label: 'Detox + lined cell', value: 'TZS 0.6B' },
        { label: 'NEMC variation fee', value: 'TZS 90M' },
        { label: 'Approval probability', value: '70%' },
      ],
    },
    decisionQuestion: 'Pursue, negotiate further, or decline?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you size the risk of the 30% chance the cyanide variation is refused or contested?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'What would you ask the EPC contractor and the supplier to commit to before you file?',
      },
    ],
    activity: {
      prompt: 'Build a decision memo covering permit risk, capex recovery, and community/water safety.',
      deliverable: 'One-page memo.',
      timeBoxMinutes: 60,
    },
    discussionQuestions: ['How do you protect the cooperative members nervous about cyanide near the water source?'],
  }),

  defineCaseStudy({
    id: 'cs-15-rainy-season-production-dip',
    title: 'Production dips every rainy season: planning cadence fix',
    wordCount: 220,
    country: 'TZ',
    tags: ['production-planning', 'seasonality', 'operations'],
    difficulty: 'intermediate',
    narrative: `A small Lake Zone open-pit operation shows a stubborn rainy-season production dip three years running: it mills near nameplate in the dry months and drops about 18 percent over March-May as the pit floods, haul roads soften, and the run-of-mine stockpile runs thin. The owner asks whether to build a bigger stockpile buffer or stagger the mining sequence.

Mr. Mwikila's read: the dip is self-inflicted. The mine plan has been run reactively — by the time the rains arrive, there is no dry-mined ore buffer ahead of the plant, dewatering pumps are undersized, and the plant is starved for feed exactly when it cannot be replenished.`,
    dataTable: {
      title: 'Seasonal throughput by period',
      rows: [
        { label: 'Dry-season utilisation', value: '~95%' },
        { label: 'Rainy-season utilisation', value: '~77%' },
        { label: 'Affected months', value: 'March-May' },
        { label: 'Lost production value per wet season', value: 'TZS 770M' },
      ],
    },
    decisionQuestion:
      'What specific actions would you take over the next 12 months to fix the rainy-season dip structurally?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does an un-buffered mine plan amplify the rainy-season bottleneck?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a stockpile-and-dewatering plan that de-risks the wet months.',
      },
    ],
    activity: {
      prompt: 'Draw a 12-month plan showing the ROM stockpile build-up ahead of each wet season.',
      deliverable: 'Plan + narrative.',
      timeBoxMinutes: 45,
    },
    discussionQuestions: ['What investment in dewatering and haul-road maintenance pays for itself in one wet season?'],
  }),

  defineCaseStudy({
    id: 'cs-16-returning-contractor-manipulation',
    title: 'Tender manipulation by a returning contractor: detection and remedy',
    wordCount: 280,
    country: 'TZ',
    tags: ['tender', 'contractor', 'fraud'],
    difficulty: 'advanced',
    narrative: `A Mikocheni-based mid-tier operator runs a quarterly drill-and-blast tender for its Lake Zone pit. Over four cycles, the same contractor — "Kisima Drilling" — has won three, each by a narrow margin. Wanjiku the accountant noticed something off: across the three wins, Kisima's bid is within TZS 80-120k of the runner-up, as if they had seen the competing bids before submitting. Two of the three losing bidders have complained informally.

Mr. Mwikila walks the tender file. The evaluation committee of three has one member — Joshua, the mining superintendent — who has worked with Kisima's principal for eight years. Joshua is always the first to receive competing bids by email before the opening meeting.

The pattern is textbook: either Joshua is leaking bids, or the committee's two-envelope opening procedure is not being enforced. The owner wants to avoid a direct accusation until the evidence is firm — and Kisima currently runs the only drill rig on site, so a clumsy move could stop the blast cycle and the pit with it.`,
    dataTable: {
      title: 'Tender history',
      rows: [
        { label: 'Cycles', value: '4' },
        { label: 'Kisima wins', value: '3' },
        { label: 'Margin over runner-up', value: 'TZS 80-120k' },
        { label: 'Joshua tenure with Kisima', value: '8 years' },
      ],
    },
    decisionQuestion: 'What does the owner do next — and in what sequence, without stopping the blast cycle?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What signals distinguish competitive luck from bid manipulation?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a new two-envelope procedure that would prevent this.',
      },
    ],
    activity: {
      prompt: 'Draft the remediation memo for the owner.',
      deliverable: 'Memo with detection evidence + procedural fix + an interim drilling bridge.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: [
      'What is the labour-law path if Joshua is found to be leaking bids?',
      'How do you re-tender without appearing to favour the losing bidders?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-17-offtake-tcrc-repricing',
    title: 'TC/RC repricing conversation with a long-standing off-taker',
    wordCount: 250,
    country: 'TZ',
    tags: ['offtake', 'buyer-retention', 'pricing'],
    difficulty: 'intermediate',
    narrative: `A Mwanza buyer has taken doré from the same producer — a steady, audited, mercury-free operation — for nine years at a London-fix-less-2.6 percent deduction. Competing buyers now quote fix-less-1.8 percent. The annual review is due; the producer wants to "fix the gap at least halfway." The producer has a flawless delivery and chain-of-custody record, an LBMA-aligned clean-supply story, and a close working relationship with the buyer's assay desk.

Mr. Mwikila's framing: the retention premium for a 9-year clean-supply producer is substantial — re-onboarding a replacement, re-auditing chain of custody, and the throughput gap while a new supplier mobilises. Cutting the deduction all the way to 1.8 percent is defensible but erodes the buyer's margin sharply. A 2.1-2.2 percent deduction paired with a 3-year volume commitment might be the cleanest structure.`,
    dataTable: {
      title: 'TC/RC repricing math',
      rows: [
        { label: 'Current deduction', value: '2.6% of fix' },
        { label: 'Market deduction', value: '1.8% of fix' },
        { label: 'Gap', value: '0.8 percentage points' },
        { label: 'Replacement / re-onboarding cost', value: 'High' },
        { label: 'Supplier tenure', value: '9 years' },
      ],
    },
    decisionQuestion: 'Which approach would you advise — and how would you frame the conversation?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is cutting the deduction all the way to market not always the right answer for the buyer?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the opening line of the off-take review letter.',
      },
    ],
    activity: {
      prompt: 'Write the off-take review letter.',
      deliverable: 'Letter with market evidence + proposed terms.',
      timeBoxMinutes: 30,
    },
    discussionQuestions: ['When is it worth losing a clean-supply producer to protect deduction margin?'],
  }),

  defineCaseStudy({
    id: 'cs-18-tribute-overstay-dispute',
    title: 'Handling a dispute over an artisanal tribute overstay',
    wordCount: 230,
    country: 'TZ',
    tags: ['tribute', 'dispute', 'access'],
    difficulty: 'advanced',
    narrative: `An artisanal group has been working a demarcated tribute block on a producer's Mining Licence under a written tribute agreement that expired four months ago, while a renewal is negotiated. The original tribute set a 15 percent production share to the licence holder; the group has kept paying the original share and ignored a contractual escalation to 18 percent that triggered on renewal-pending status. The producer's accountant booked the share at the escalated rate; receivables show TZS 320,000 outstanding.

The group's counter-argument: the producer accepted the original-rate payments without protest, which implies consent to keep the old share. The producer's rebuttal: the tribute is explicit, and no written waiver exists. Mr. Mwikila's read: by accepting four months of payments without reserving its rights in writing, the producer has weakened the escalation claim.`,
    dataTable: {
      title: 'Tribute-overstay math',
      rows: [
        { label: 'Original share owed', value: 'TZS 320,000' },
        { label: 'Escalated share (18%)', value: 'TZS 400,000' },
        { label: 'Months overstayed', value: '4' },
        { label: 'Receivable at escalated rate', value: 'TZS 320,000' },
      ],
    },
    decisionQuestion:
      'Can the producer still recover the escalation — and if not, what procedural change prevents recurrence?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is "implied consent" and how does it erode contractual rights?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the "without prejudice" cover note for the next tribute-share receipt.',
      },
    ],
    activity: {
      prompt: 'Prepare the written reservation of rights to attach to tribute-share receipts during the renewal period.',
      deliverable: 'Template paragraph.',
      timeBoxMinutes: 20,
    },
    discussionQuestions: ['Should the producer escalate to the Mining Commission or settle?'],
  }),

  defineCaseStudy({
    id: 'cs-19-upgrade-vs-divest-40yr',
    title: 'Asset-level decision: upgrade vs divest a 40-year-old plant',
    wordCount: 310,
    country: 'TZ',
    tags: ['plant-upgrade', 'divest', 'strategy', 'capex'],
    difficulty: 'advanced',
    narrative: `An owner inherited a small 28-tonne-per-hour vat-leach plant near Chunya, built in 1984, from his late father. The operation generates TZS 7.8M-per-month operating surplus against an asset value of about TZS 105M — a tired plant on a marginal recovery. A QS upgrade plan targets TZS 32M to add a gravity concentrator, replace pumps and the thickener, and add a detox circuit — projected to lift recovery and operating surplus to TZS 12.5M/month and the asset value toward TZS 195M post-upgrade.

The alternative: sell now at TZS 105M and redeploy into a newer, higher-grade tenement or a stake in a larger operation. The owner has emotional attachment to the plant — it was his father's first build.

Mr. Mwikila's structured take: the upgrade IRR is roughly 14 percent over 5 years; the redeployed capital could hit 16-18 percent in a higher-grade asset. Both are defensible. The deciding factors are execution risk (does the upgrade finish on time and hit the recovery target?) and whether the owner has the bandwidth for a construction project on an ageing plant.`,
    dataTable: {
      title: 'Upgrade vs divest',
      rows: [
        { label: 'Current monthly surplus', value: 'TZS 7.8M' },
        { label: 'Current value', value: 'TZS 105M' },
        { label: 'Upgrade spend', value: 'TZS 32M' },
        { label: 'Post-upgrade surplus', value: 'TZS 12.5M/month' },
        { label: 'Post-upgrade value', value: 'TZS 195M' },
        { label: 'Upgrade IRR', value: '~14%' },
        { label: 'Redeployed-capital target IRR', value: '16-18%' },
      ],
    },
    decisionQuestion: 'Upgrade or divest — and what additional data would you want before committing?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you weigh execution and recovery risk against opportunity cost?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'What would change your answer if the upgrade IRR were 18 percent instead of 14 percent?',
      },
    ],
    activity: {
      prompt: 'Build the decision tree Mr. Mwikila would present to the owner.',
      deliverable: 'One-page decision tree.',
      timeBoxMinutes: 60,
    },
    discussionQuestions: [
      'How do you incorporate the emotional value of the plant without letting it dominate the decision?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-20-first-90-days-multi-licence',
    title: 'Managing the first 90 days after acquiring a multi-licence portfolio',
    wordCount: 300,
    country: 'TZ',
    tags: ['acquisition', 'first-90-days', 'operations'],
    difficulty: 'advanced',
    narrative: `A pan-African fund has just closed on a cluster of gold tenements across the Lake Zone — one producing ML with a small CIL plant near Geita, two tribute PMLs near Kahama, and a dormant exploration block near Mwanza. The seller's on-site team of 14 stays on a 90-day retention; BORJIE is appointed operator.

Day-1 challenges: production and sales records are split across three spreadsheets and a folder of refiner settlement PDFs. The accountant has left. Reagent and fuel supply contracts are either verbal or expired. The production ledger shows the plant "at nameplate" on paper; a walk-through reveals the gravity circuit is bypassed and two royalty returns are filed late. Gold-room reconciliation has been selective.

Mr. Mwikila's 90-day playbook: Week 1 — meet every staff member individually, re-seal the gold room under dual control, take possession of keys, the magazine, and records. Weeks 2-4 — workforce interviews, baseline plant-and-TSF survey, contractor audit. Weeks 5-8 — quick wins: restore the gravity circuit, fix the worst pump, bring royalty filings current; renegotiate the two most expensive supply contracts; tighten the desk reconciliation. Weeks 9-12 — migrate onto BORJIE systems, first clean month-end metallurgical balance, first owner report. Target: 5 percent all-in cost-per-ounce improvement by day 90.`,
    dataTable: {
      title: 'Acquisition baseline',
      rows: [
        { label: 'Tenements', value: '1 ML + 2 PML + 1 exploration block' },
        { label: 'Reported plant utilisation', value: 'Nameplate (on paper)' },
        { label: 'Actual after walkthrough', value: 'Gravity bypassed; recovery low' },
        { label: 'On-site staff retained', value: '14 (90-day transition)' },
        { label: 'Cost-per-ounce target by day 90', value: '5% improvement' },
      ],
    },
    decisionQuestion: 'What are the 5 highest-leverage actions in the first 30 days?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does speed matter in the first 30 days at a gold operation specifically?',
      },
      {
        bloomLevel: 'create',
        question: 'Prioritise the week-1 action list.',
      },
    ],
    activity: {
      prompt: 'Draft the week-1 team-meeting agenda and the week-1 owner-update note.',
      deliverable: 'Agenda + note.',
      timeBoxMinutes: 50,
    },
    discussionQuestions: ['What do you do about the two late royalty returns inherited at close?'],
  }),

  defineCaseStudy({
    id: 'cs-21-rehabilitation-bond-dispute',
    title: 'Rehabilitation-bond dispute: liability vs natural ground disturbance',
    wordCount: 220,
    country: 'TZ',
    tags: ['rehabilitation', 'closure', 'dispute', 'handover'],
    difficulty: 'intermediate',
    narrative: `A producer relinquished a worked-out satellite pit after 18 months and applied to release its rehabilitation deposit held against closure obligations. The closure inspection found: un-backfilled benches needing re-profiling, a small uncapped tails patch, topsoil not respread on one platform, and a borrow area the producer argues was already disturbed by artisanal miners before they arrived. Deposit held: TZS 180,000,000. The regulator proposes withholding TZS 140M citing the above plus "monitoring TZS 25M."

The producer filed a challenge. Mr. Mwikila's read: the un-backfilled benches and the uncapped tails are clear closure liabilities, the topsoil is a genuine obligation, but the pre-existing artisanal borrow disturbance — if backed by time-stamped baseline photos from the environmental certificate — is not the producer's to remediate.`,
    dataTable: {
      title: 'Closure-cost breakdown',
      rows: [
        { label: 'Rehabilitation deposit', value: 'TZS 180M' },
        { label: 'Proposed withholding', value: 'TZS 140M' },
        { label: 'Bench re-profiling', value: 'TZS 35M' },
        { label: 'Tails capping', value: 'TZS 18M' },
        { label: 'Topsoil respread', value: 'TZS 42M' },
        { label: 'Monitoring', value: 'TZS 25M' },
        { label: 'Pre-existing borrow area', value: 'TZS 20M' },
      ],
    },
    decisionQuestion: 'How much of the TZS 140M withholding is defensible at review?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the test for separating inherited disturbance from a producer\'s closure liability?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'Which items would you concede to strengthen the case on the others?',
      },
    ],
    activity: {
      prompt: 'Prepare the revised closure-cost statement for the regulator review.',
      deliverable: 'Letter + baseline-photo annex.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: ['How would a time-stamped baseline survey at grant have changed this?'],
  }),

  defineCaseStudy({
    id: 'cs-22-gepg-unapplied-royalty',
    title: 'GePG unapplied-royalty-cash cleanup',
    wordCount: 210,
    country: 'TZ',
    tags: ['gepg', 'royalty', 'reconciliation', 'finance'],
    difficulty: 'intermediate',
    narrative: `A Dar-based mining group's finance function has accumulated TZS 4.8M in a GePG clearing account over nine months — payments made toward royalty and clearing-fee control numbers that were never matched back to a specific parcel or return. The accountant treats it as "safer than applying wrong." The finance controller sees it as a compliance time bomb: money paid to the Mining Commission rail, but not reconciled to any royalty return.

Mr. Mwikila's audit: 38 transactions. 22 match cleanly to a same-period parcel and royalty return — just never posted. 9 are partial royalty payments (allocate to the oldest open return first). 4 used a wrong control number — research the parcel, reverse-and-rebook against the correct return. 3 are overpayments — credit the next return with the Mining Commission's confirmation.`,
    dataTable: {
      title: 'Unapplied GePG composition',
      rows: [
        { label: 'Total unapplied', value: 'TZS 4.8M' },
        { label: 'Transactions', value: '38' },
        { label: 'Clean matches', value: '22' },
        { label: 'Partial payments', value: '9' },
        { label: 'Wrong control number', value: '4' },
        { label: 'Overpayments', value: '3' },
      ],
    },
    decisionQuestion: 'What is the cleanup sequence, and what governance change prevents recurrence?',
    socraticPath: [
      {
        bloomLevel: 'apply',
        question: 'Walk through the cleanup steps for one of the wrong-control-number royalty payments.',
      },
      {
        bloomLevel: 'create',
        question: 'Design a daily reconciliation routine that keeps the GePG royalty clearing account at zero.',
      },
    ],
    activity: {
      prompt: 'Write the SOP for daily GePG royalty reconciliation.',
      deliverable: 'One-page SOP.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['When is it safer to leave a royalty payment unapplied than to apply it guessing?'],
  }),

  defineCaseStudy({
    id: 'cs-23-unauthorised-toll-treating',
    title: 'Unauthorised third-party toll-treating discovered at the plant',
    wordCount: 220,
    country: 'TZ',
    tags: ['toll-treating', 'breach', 'compliance'],
    difficulty: 'intermediate',
    narrative: `A plant operator near Geita discovers that the night-shift plant supervisor has, for three months, been quietly running third-party artisanal ore through the CIL circuit on weekends for a fee — without the owner's consent and outside any tolling agreement or royalty declaration. The owner found out via a haul-truck driver's complaint; a check of weighbridge logs confirmed roughly 9 weekend campaigns at an estimated TZS 8M of toll fees collected by the supervisor.

The supervisor argues the side-tolling generated TZS 72M of throughput value he "kept the plant busy with" and offers a revenue share retroactively. The owner's exposure is larger than the toll fees: the third-party gold was never declared, so royalty was not paid, and the chain of custody and the plant's clean-supply story are compromised.`,
    dataTable: {
      title: 'Unauthorised-tolling facts',
      rows: [
        { label: 'Weekend campaigns', value: '9' },
        { label: 'Estimated toll fees taken', value: 'TZS 8M' },
        { label: 'Third-party throughput value', value: 'TZS 72M (3 months)' },
        { label: 'Royalty on third-party gold', value: 'Undeclared / unpaid' },
      ],
    },
    decisionQuestion: 'Enforce strict breach consequences, accept a revenue share, or formalise a tolling line?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the owner actually trying to protect by controlling what runs through the plant?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'How does undeclared royalty and broken chain of custody change the exposure beyond the toll fees?',
      },
    ],
    activity: {
      prompt: 'Draft the owner response with three options, including a properly licensed tolling structure.',
      deliverable: 'Memo.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: [
      'Should the operating procedures be updated with a formal third-party-ore policy and gate controls?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-24-nemc-eia-stop-work',
    title: 'NEMC EIA stop-work on a greenfield mine development',
    wordCount: 220,
    country: 'TZ',
    tags: ['nemc', 'eia', 'compliance', 'development'],
    difficulty: 'advanced',
    narrative: `A developer is 8 months into building a greenfield gold mine near Songea. Earthworks and the plant pad are done; tankage is starting. A neighbouring village lodged an objection to the environmental impact assessment, citing inadequate public participation and concern over a downstream water source. NEMC issued a stop-work notice. The developer's project-finance facility has a 14-day drawdown clock tied to milestones.

Mr. Mwikila's read: the objection has procedural merit — the developer's lead expert held one sparsely-attended consultation and never engaged the downstream ward. Remediation requires a fresh round of genuine stakeholder engagement (4-6 weeks) and a supplementary EIA filing (2-3 weeks NEMC review). Total delay: 6-9 weeks, plus standby costs on the EPC contractor.`,
    dataTable: {
      title: 'NEMC EIA stop-work impact',
      rows: [
        { label: 'Months into build', value: '8' },
        { label: 'Drawdown clock', value: '14 days' },
        { label: 'Delay estimate', value: '6-9 weeks' },
        { label: 'EPC standby + finance penalty', value: 'TZS 1.4B' },
      ],
    },
    decisionQuestion: 'What is the containment + remediation plan?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does a procedural objection stop work even when the engineering is sound?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a stakeholder-engagement plan that would pass NEMC muster.',
      },
    ],
    activity: {
      prompt: 'Write the note to the project-finance lenders explaining the delay and seeking a milestone waiver.',
      deliverable: 'Letter.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['What process change avoids this on the next development?'],
  }),

  defineCaseStudy({
    id: 'cs-25-solar-hybrid-power',
    title: 'Solar-hybrid power capex decision on an off-grid mine',
    wordCount: 230,
    country: 'TZ',
    tags: ['capex', 'solar', 'power', 'sustainability'],
    difficulty: 'intermediate',
    narrative: `An off-grid Lake Zone operation spends about TZS 380M/month on diesel to run its plant, pumps, and camp. A solar-plus-battery proposal from an integrator quotes TZS 4.8 billion capex for a hybrid system covering ~60 percent of daytime load, cutting diesel spend by about TZS 180M/month. Simple payback: ~27 months. Warranty: 10 years, comfortably inside the remaining mine life.

The owner is cash-generative but cautious. Funding the capex from operating cash would suppress distributions for two quarters, and the lenders have a say on any new capital draw.`,
    dataTable: {
      title: 'Solar-hybrid math',
      rows: [
        { label: 'Capex', value: 'TZS 4.8B' },
        { label: 'Monthly diesel saving', value: 'TZS 180M' },
        { label: 'Simple payback', value: '27 months' },
        { label: 'Warranty', value: '10 years' },
      ],
    },
    decisionQuestion: 'Is this a yes, a no, or a "negotiate the financing" situation?',
    socraticPath: [
      {
        bloomLevel: 'apply',
        question: 'Calculate the NPV at 14% over 10 years.',
      },
      {
        bloomLevel: 'evaluate',
        question: 'Which financing structure (cash / lender facility / build-own-operate by the integrator) do you prefer?',
      },
    ],
    activity: {
      prompt: 'Build the owner memo with three funding options.',
      deliverable: 'Memo.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: ['Would your answer change if the mine had only 3 years of reserves left?'],
  }),

  defineCaseStudy({
    id: 'cs-26-liquidated-damages-defensibility',
    title: 'Liquidated-damages clause defensibility in a mining-services dispute',
    wordCount: 210,
    country: 'TZ',
    tags: ['liquidated-damages', 'legal', 'contract'],
    difficulty: 'advanced',
    narrative: `A producer enforced a 5 percent compounding monthly penalty against a haulage contractor who missed tonnage targets for 4 months. The contractor paid the principal shortfall but contested TZS 21M of penalties. The contract has the clause in writing; the contractor argues it is "penal" and therefore unenforceable.

Mr. Mwikila's read: courts generally enforce a damages clause in a commercial contract if it is (a) clearly stated, (b) a genuine pre-estimate of the producer's loss (deferred ounces, idle plant), and (c) not punitive. A 5 percent compounding monthly figure is aggressive. The producer's position is strong on (a) but weaker on (b) and (c).`,
    dataTable: {
      title: 'Liquidated-damages math',
      rows: [
        { label: 'Monthly contract value', value: 'TZS 45M' },
        { label: 'Months in breach', value: '4' },
        { label: 'Penalty claimed', value: 'TZS 21M' },
        { label: 'As % of contract value', value: '11.7%' },
      ],
    },
    decisionQuestion: 'What is the dispute strategy? Defend, negotiate, or withdraw?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the legal difference between liquidated damages and a penalty?',
      },
      {
        bloomLevel: 'create',
        question: 'Redraft the damages clause so it is more defensible.',
      },
    ],
    activity: {
      prompt: 'Write the revised clause for the mining-services contract template.',
      deliverable: 'One-paragraph clause.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: ['When do you waive penalties to preserve a reliable contractor relationship?'],
  }),

  defineCaseStudy({
    id: 'cs-27-commodity-diversification',
    title: 'Portfolio rebalance: adding graphite exposure',
    wordCount: 250,
    country: 'TZ',
    tags: ['portfolio', 'strategy', 'diversification'],
    difficulty: 'advanced',
    narrative: `A Lake Zone gold producer holds a TZS 800M portfolio that is 100 percent gold, 100 percent Lake Zone. A broker offers a graphite prospect near Nachingwea in Lindi region — a different mineral, a different buyer base (battery-anode and refractory off-takers), and a different price cycle — at TZS 180M for the operating interest, with a modeled margin attractive on current flake-graphite prices. The owner is intrigued — it diversifies commodity and geography — but nervous about a mineral and a market he does not know, and about managing an asset 1,000 km away.

Mr. Mwikila's take: commodity-and-geography diversification can cut portfolio volatility 20-30 percent if gold and graphite prices are not correlated — and they largely are not. But operational risk is higher: a different flowsheet, a thinner local skills base, and distance management. A capable on-site team and a credible off-take for the flake size distribution are the make-or-break items, not the headline grade.`,
    dataTable: {
      title: 'Diversification math',
      rows: [
        { label: 'Current portfolio', value: 'TZS 800M, 100% gold / Lake Zone' },
        { label: 'Graphite target', value: 'TZS 180M, Nachingwea' },
        { label: 'Buyer base', value: 'Battery-anode + refractory off-takers' },
        { label: 'Price correlation to gold', value: 'Low' },
      ],
    },
    decisionQuestion:
      'Proceed, pass, or explore graphite but via a different structure?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you decide whether distance-and-flowsheet risk is worth the diversification benefit?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'What additional data would you request before committing?',
      },
    ],
    activity: {
      prompt: 'Build the decision memo for the owner.',
      deliverable: 'Memo.',
      timeBoxMinutes: 45,
    },
    discussionQuestions: ['Would your answer differ for a development-stage vs producing graphite asset?'],
  }),

  defineCaseStudy({
    id: 'cs-28-offtaker-financial-distress',
    title: 'Anchor off-taker showing financial distress',
    wordCount: 250,
    country: 'TZ',
    tags: ['offtake', 'distress', 'commercial'],
    difficulty: 'advanced',
    narrative: `A producer's anchor off-taker — a regional buyer-exporter taking roughly TZS 1.1B of doré a month — shows three pattern-breaks over six months: settlement slipping from days 1 to 8 to 14 to 21; the buyer quietly trimming the parcel sizes it will pre-finance; and word that the buyer's bank cut its trade-finance line. The off-take has 3 years left.

Mr. Mwikila's read: this is pre-default on the buyer side. The producer's options are engage (negotiate a tighter settlement cadence and partial cash-on-delivery tied to a cure plan), enforce (demand cash-on-delivery and accept the buyer may walk), or prepare (quietly line up a backup buyer and a refiner-direct route). The cost of losing the anchor buyer is a 4-6 month throughput-to-sale gap and re-onboarding a new counterparty's chain-of-custody audit.`,
    dataTable: {
      title: 'Off-taker distress signals',
      rows: [
        { label: 'Monthly off-take value', value: 'TZS 1.1B' },
        { label: 'Off-take remaining', value: '3 years' },
        { label: 'Settlement slippage', value: '1 → 8 → 14 → 21 days' },
        { label: 'Pre-finance behaviour', value: 'Parcel sizes trimmed' },
        { label: 'Switching cost estimate', value: '4-6 month sale gap + re-audit' },
      ],
    },
    decisionQuestion: 'What is your sequenced 30/60/90-day plan?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What information is hidden in the settlement-slippage pattern?',
      },
      {
        bloomLevel: 'create',
        question: 'Design the cash-on-delivery / partial-prepayment transition structure.',
      },
    ],
    activity: {
      prompt: 'Draft the meeting agenda for the off-taker conversation.',
      deliverable: 'Agenda.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['When is it right to pre-emptively switch buyers before the anchor defaults?'],
  }),

  defineCaseStudy({
    id: 'cs-29-rehabilitation-fund-underfunded',
    title: 'Rehabilitation fund underfunded — 25-year-old operation',
    wordCount: 230,
    country: 'TZ',
    tags: ['rehabilitation', 'closure', 'reserves'],
    difficulty: 'intermediate',
    narrative: `A 25-year-old operation near Mikocheni-area workings holds a rehabilitation-and-closure fund of TZS 8M. The 5-year closure plan calls for TZS 28M of work (tailings capping TZS 14M in year 2, pit re-profiling TZS 9M in year 4, revegetation TZS 5M in year 3). Current cash flow can fund only about TZS 3.8M/year of closure provisioning.

The owner asks: raise the provisioning rate now, take a one-off top-up from this year's surplus, or stretch the closure schedule?`,
    dataTable: {
      title: 'Rehabilitation-fund math',
      rows: [
        { label: 'Fund balance', value: 'TZS 8M' },
        { label: '5-yr closure plan', value: 'TZS 28M' },
        { label: 'Annual provisioning', value: 'TZS 3.8M' },
        { label: 'Funding gap at Y5', value: 'TZS 1M (if on schedule)' },
      ],
    },
    decisionQuestion:
      'Raise provisioning, take a one-off top-up, or stretch the closure schedule — and how do you justify it to the regulator?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is under-provisioning closure a regulatory and balance-sheet risk, not just a timing question?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a 3-year ramp in closure provisioning.',
      },
    ],
    activity: {
      prompt: 'Write the closure-provisioning plan to file with the regulator.',
      deliverable: 'Plan note.',
      timeBoxMinutes: 30,
    },
    discussionQuestions: ['Does your answer change if the mine is due for sale in 3 years?'],
  }),

  defineCaseStudy({
    id: 'cs-30-dpa-subject-access-employee',
    title: 'DPA subject-access request from a former mine employee',
    wordCount: 210,
    country: 'TZ',
    tags: ['dpa', 'privacy', 'compliance'],
    difficulty: 'intermediate',
    narrative: `A former gold-room operator at a Lake Zone mine files a personal-data subject-access request three months after leaving. He requests "all data held about me." The operator holds: his employment contract (and a co-signed indemnity), KYC and next-of-kin records (his ID, his spouse's ID, a guarantor letter), payroll and PAYE records, disciplinary and grievance notes, gold-room access logs, and CCTV-footage references from the gold room.

Mr. Mwikila's checklist: respond within the statutory window. Redact all third parties in joint documents (spouse, guarantor, co-workers and any investigation subjects who appear). Gold-room CCTV is rarely included unless specifically requested and is constrained by the security exemption. Provide the bundle in a usable format and log the disclosure.`,
    dataTable: {
      title: 'SAR response inventory',
      rows: [
        { label: 'Response window', value: 'Statutory deadline' },
        { label: 'Data categories', value: '6 (contract, KYC, payroll, discipline, access logs, CCTV)' },
        { label: 'Redaction required', value: 'spouse, guarantor, co-workers, investigation subjects' },
        { label: 'Risk of non-compliance', value: 'Regulatory penalty' },
      ],
    },
    decisionQuestion: 'What is the SAR response plan within the statutory window?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Which items require redaction and why?',
      },
      {
        bloomLevel: 'apply',
        question: 'Sketch the cover letter accompanying the SAR bundle.',
      },
    ],
    activity: {
      prompt: 'Build the SAR response checklist + cover letter.',
      deliverable: 'Checklist + letter.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: ['How do you minimise the burden of employee SARs going forward?'],
  }),

  defineCaseStudy({
    id: 'cs-31-jv-cost-recovery-dispute',
    title: 'Cost-recovery true-up dispute with a JV partner',
    wordCount: 230,
    country: 'TZ',
    tags: ['joint-venture', 'cost-recovery', 'reconciliation'],
    difficulty: 'advanced',
    narrative: `A junior partner in a Lake Zone mining joint venture disputes the operator's TZS 1.3 billion year-end cost-recovery true-up. The base-year operating cost (when the JV started in 2022) was modest; the 2025 recovered cost is far higher. The JV agreement gives the non-operator audit rights, which it is now invoking.

Their findings: the operator booked a TZS 4.2 billion plant-expansion item (a clear capital cost) as a recoverable operating cost, and did not gross up shared overheads correctly during a year when the operation ran at 76 percent of plan. Mr. Mwikila's read: the capital-as-operating misclassification is a clear error; the overhead gross-up is a defensible practice if the JV agreement provides for it.`,
    dataTable: {
      title: 'Cost-recovery dispute math',
      rows: [
        { label: 'Base-year operating cost', value: 'Modest' },
        { label: '2025 recovered cost', value: 'Far higher' },
        { label: 'Billed true-up', value: 'TZS 1.3B' },
        { label: 'Capital miscoded as operating', value: 'TZS 4.2B' },
        { label: 'Operation vs plan during year', value: '76%' },
      ],
    },
    decisionQuestion: 'What do you concede, what do you defend, and how do you preserve the JV relationship?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is capital-coded-as-operating a common but costly error in JV cost recovery?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the revised cost-recovery statement.',
      },
    ],
    activity: {
      prompt: 'Write the partner response letter.',
      deliverable: 'Letter + revised cost-recovery table.',
      timeBoxMinutes: 45,
    },
    discussionQuestions: ['How do you prevent this across the whole JV going forward?'],
  }),

  defineCaseStudy({
    id: 'cs-32-workforce-harassment-complaint',
    title: 'Workforce harassment complaint against a shift supervisor',
    wordCount: 220,
    country: 'TZ',
    tags: ['harassment', 'hr', 'compliance'],
    difficulty: 'advanced',
    narrative: `A female plant operator at a Lake Zone mine lodged a written complaint alleging her shift supervisor made inappropriate comments and lingered near her station on two occasions. No physical contact; no witnesses; no CCTV covering that part of the plant floor.

The supervisor has worked at the operation for 6 years with no prior complaints, two positive references, and a clean record. The operator is reliable, 2 years on site, and explicitly asked for confidentiality and protection.`,
    dataTable: {
      title: 'Complaint investigation snapshot',
      rows: [
        { label: 'Allegations', value: '2 incidents' },
        { label: 'Physical contact', value: 'No' },
        { label: 'Witnesses / CCTV', value: 'None' },
        { label: 'Supervisor tenure', value: '6 years' },
        { label: 'Operator tenure', value: '2 years' },
      ],
    },
    decisionQuestion: 'What is the protocol — for the operator, the supervisor, and the record?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you protect both parties while investigating?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'When do you escalate to the labour officer or police?',
      },
    ],
    activity: {
      prompt: 'Write the 3-page incident-handling protocol.',
      deliverable: 'Protocol.',
      timeBoxMinutes: 50,
    },
    discussionQuestions: [
      'What preventative measures would reduce recurrence risk across the workforce?',
    ],
  }),
] as const;

export const SHORT_CASE_STUDIES: readonly CaseStudy[] = Object.freeze(SHORT_CASES);
