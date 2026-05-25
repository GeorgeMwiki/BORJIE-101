/**
 * Wave 13 short-form case corpus — 22 additional 200-400 word case
 * studies covering leasing, maintenance, compliance, finance, and
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
    id: 'cs-11-45-day-arrears-kinondoni',
    title: 'The 45-day arrears pattern in a 24-unit Kinondoni block',
    wordCount: 260,
    country: 'TZ',
    tags: ['arrears', 'operations', 'collections'],
    difficulty: 'intermediate',
    narrative: `Seven of 24 units in a Kinondoni walk-up have slipped into a stable 30-45 day arrears rhythm. The owner is an upcountry banker who takes a 10-day trip home every quarter, and the caretaker has grown accustomed to excuses — "TSh 200k on Friday," "school fees this week," "GePG was down." The ledger shows balances bouncing between TSh 450k and TSh 1.2M per unit, never clearing, never escalating. Late fees are in the lease but never applied. Tenant turnover is low, which the owner reads as loyalty; Mr. Mwikila reads it as a pattern of tolerated slippage that has become the new normal.

Three of the seven tenants are long-standing (>5 years); two are recent; two are tied to the same M-Pesa sender, hinting at a family cluster. Rent across the 24 units is TSh 380-420k; total arrears on any given day hover at TSh 6.5M — roughly two weeks of gross collections. The owner asks whether to "just write it off and move on."`,
    dataTable: {
      title: 'Kinondoni arrears snapshot',
      rows: [
        { label: 'Units in chronic arrears', value: '7 of 24' },
        { label: 'Average balance per chronic unit', value: 'TSh 780k' },
        { label: 'Total portfolio arrears', value: 'TSh 6.5M' },
        { label: 'Late fees applied', value: 'TSh 0' },
      ],
    },
    decisionQuestion:
      'What would you do in the next 30 days to reset the collections culture without losing the long-standing tenants?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why do chronic arrears persist even when late fees exist in the lease?',
      },
      {
        bloomLevel: 'evaluate',
        question:
          'Is aggressive enforcement or phased catch-up plans the right lever here?',
      },
    ],
    activity: {
      prompt: 'Draft the first 30-day collections plan for these 7 units.',
      deliverable: 'One-page memo to the owner with ladder + expected recoveries.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: [
      'How would you split these seven into enforcement tiers?',
      'What would make you walk away from a chronic tenant?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-12-water-meter-drift',
    title: 'When the service-charge does not balance: reconciling 6 months of water-meter drift',
    wordCount: 240,
    country: 'KE',
    tags: ['service-charge', 'utilities', 'reconciliation'],
    difficulty: 'intermediate',
    narrative: `A Lavington 20-unit block has been showing a stubborn KSh 42,000-per-month gap between billed water and actual utility invoices for six months running. The owner wants to raise the service charge to absorb it. The caretaker blames "Nairobi Water" for over-billing; the accountant blames "meter drift."

Mr. Mwikila walks the block with the building engineer. Two of the 20 units have had new tenants within the last year, both of whom installed extra washing machines without notification. One meter has a cracked housing and reads low. The bulk meter on the compound shows KSh 42k more consumption than the sum of unit meters — an almost-perfect match for the gap.

The owner considers three actions: (1) raise service charge 3 percent to absorb; (2) replace all 20 unit meters at KSh 8,000 each; (3) investigate the meter drift and bill the two washing-machine tenants retroactively. Mr. Mwikila's framing: the service charge is for common services, not to subsidise individual over-consumption.`,
    dataTable: {
      title: 'Water-drift reconciliation',
      rows: [
        { label: 'Monthly gap', value: 'KSh 42,000' },
        { label: 'Duration', value: '6 months' },
        { label: 'Total gap', value: 'KSh 252,000' },
        { label: 'Unit-meter replacement cost', value: 'KSh 160,000 (20 units)' },
      ],
    },
    decisionQuestion: 'Which of the three actions — or which combination — would you recommend?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is it dangerous to use the service charge to close this gap?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the email to the two washing-machine tenants.',
      },
    ],
    activity: {
      prompt: 'Write the owner memo explaining the root cause and proposed fix.',
      deliverable: 'Two-paragraph email.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: [
      'What governance change prevents this drift from happening again?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-13-early-termination-midlease',
    title: 'A tenant requesting early termination mid-lease',
    wordCount: 230,
    country: 'KE',
    tags: ['lease', 'termination', 'leasing'],
    difficulty: 'intermediate',
    narrative: `A Kilimani 2-bedroom lease runs through December 2027. In April 2026, the tenant — a young finance professional recently promoted to Rwanda — requests an early termination effective end-May. The lease has a standard break clause: 2 months' notice plus 2 months' rent buyout. He is asking for the clause to be waived on grounds of "unavoidable transfer."

The unit is currently rented at KSh 68,000, slightly below market. Mr. Mwikila's read: the tenant could credibly re-lease the unit himself via a handover tenant, and the owner could capture a market reset. The question is whether to strictly enforce the buyout, waive entirely, or find a middle path.`,
    dataTable: {
      title: 'Break-clause math',
      rows: [
        { label: 'Months remaining', value: '19' },
        { label: 'Current rent', value: 'KSh 68,000' },
        { label: 'Market rent', value: 'KSh 75,000' },
        { label: 'Buyout per lease', value: 'KSh 136,000' },
      ],
    },
    decisionQuestion: 'Enforce, waive, or structure a handover?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the landlord actually trying to protect with the break clause?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'How does the below-market rent change the calculation?',
      },
    ],
    activity: {
      prompt: 'Draft the counter-proposal to the tenant.',
      deliverable: 'One-paragraph response.',
      timeBoxMinutes: 20,
    },
    discussionQuestions: ['Would your answer change if the unit were above market?'],
  }),

  defineCaseStudy({
    id: 'cs-14-mixed-use-conversion',
    title: 'Converting a single building into mixed-use: zoning and capex',
    wordCount: 300,
    country: 'KE',
    tags: ['mixed-use', 'zoning', 'capex'],
    difficulty: 'advanced',
    narrative: `A Westlands owner holds a 4-storey residential building with ground-floor parking. The top three floors are 12 apartments; the ground floor is under-utilised. A coffee chain has offered KSh 380,000/month for the ground floor on a 10-year triple-net lease — four times the per-sqm rent of the residential floors — provided the owner can deliver zoning change-of-user, a dedicated service entrance, and a grease trap.

The owner's planner consultant estimates change-of-user approval at KSh 450,000 in fees and 4-6 months. Fit-out capex to landlord account: KSh 2.2M. The 12 residents are on month-to-month tenancies; three would move if the coffee chain opens. The existing parking can be partly converted to an outdoor seating area.

The decision: pursue the change, negotiate, or decline. Mr. Mwikila's frame: a real option — every month delayed is a month of foregone rent if approval succeeds, but rejected applications leave legal hair to untangle.`,
    dataTable: {
      title: 'Mixed-use conversion math',
      rows: [
        { label: 'New NOI from ground floor', value: 'KSh 4.56M/yr' },
        { label: 'Current NOI from parking', value: 'KSh 0' },
        { label: 'Change-of-user fee', value: 'KSh 450k' },
        { label: 'Landlord fit-out', value: 'KSh 2.2M' },
        { label: 'Approval probability', value: '70%' },
      ],
    },
    decisionQuestion: 'Pursue, negotiate further, or decline?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you size the risk of the 30% rejection probability?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'What would you ask the coffee chain to commit to before you file?',
      },
    ],
    activity: {
      prompt: 'Build a decision memo covering approval risk, capex recovery, and tenant displacement.',
      deliverable: 'One-page memo.',
      timeBoxMinutes: 60,
    },
    discussionQuestions: ['How do you protect the three residents likely to move?'],
  }),

  defineCaseStudy({
    id: 'cs-15-q4-vacancy-spike',
    title: 'Vacancy spikes in Q4: renewal cadence fix',
    wordCount: 220,
    country: 'KE',
    tags: ['vacancy', 'renewals', 'operations'],
    difficulty: 'intermediate',
    narrative: `A 40-unit Kileleshwa portfolio has shown a stubborn Q4 vacancy spike three years running: 92% occupancy in Q1-Q3, dropping to 84% in Q4 as a cluster of leases (14 of 40) all expire in November-December simultaneously. The owner asks whether to spread renewals or stagger lease lengths.

Mr. Mwikila's read: the bunching is legacy from an opening campaign in 2022. The 90/60/30 renewal cadence has been applied reactively rather than proactively; by the time December hits, the leasing agent is doing 14 renegotiations at once and drops three.`,
    dataTable: {
      title: 'Kileleshwa occupancy by quarter',
      rows: [
        { label: 'Q1-Q3 occupancy', value: '92%' },
        { label: 'Q4 occupancy', value: '84%' },
        { label: 'Nov-Dec expiries', value: '14 of 40 leases' },
        { label: 'Economic loss per Q4', value: 'KSh 770k' },
      ],
    },
    decisionQuestion:
      'What specific actions would you take over the next 12 months to fix the Q4 spike structurally?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does bunching amplify the leasing-agent bottleneck?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a stagger plan that de-clusters expiries.',
      },
    ],
    activity: {
      prompt: 'Draw a 12-month Gantt showing each lease expiry and the proposed stagger.',
      deliverable: 'Gantt + narrative.',
      timeBoxMinutes: 45,
    },
    discussionQuestions: ['What incentives would you offer tenants willing to shift their renewal date?'],
  }),

  defineCaseStudy({
    id: 'cs-16-returning-vendor-manipulation',
    title: 'Tender manipulation by a returning vendor: detection and remedy',
    wordCount: 280,
    country: 'TZ',
    tags: ['tender', 'vendor', 'fraud'],
    difficulty: 'advanced',
    narrative: `A three-building Mikocheni portfolio runs a quarterly maintenance tender. Over four cycles, the same vendor — "Kisima Solutions" — has won three, each time by a narrow margin. Wanjiku the accountant noticed something off: across the three wins, Kisima's bid is within TSh 80-120k of the runner-up, as if they had seen the competing bids before submitting. Two of the three losing bidders have complained informally.

Mr. Mwikila walks the tender file. The evaluation committee of three has one member — Joshua, the maintenance supervisor — who has worked with Kisima's principal for eight years. Joshua is always the first to receive competing bids by email before the opening meeting.

The pattern is textbook: either Joshua is leaking bids, or the committee's two-envelope opening procedure is not being enforced. The owner wants to avoid a direct accusation until evidence is firm.`,
    dataTable: {
      title: 'Tender history',
      rows: [
        { label: 'Cycles', value: '4' },
        { label: 'Kisima wins', value: '3' },
        { label: 'Margin over runner-up', value: 'TSh 80-120k' },
        { label: 'Joshua tenure with Kisima', value: '8 years' },
      ],
    },
    decisionQuestion: 'What does the owner do next — and in what sequence?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What are the signals that distinguish competitive luck from manipulation?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a new two-envelope procedure that would prevent this.',
      },
    ],
    activity: {
      prompt: 'Draft the remediation memo for the owner.',
      deliverable: 'Memo with detection evidence + procedural fix.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: [
      'What is the labour-law path if Joshua is guilty?',
      'How do you re-tender without appearing to favour the losing bidders?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-17-rent-repricing-longstanding-tenant',
    title: 'Rent repricing conversation with a long-standing tenant',
    wordCount: 250,
    country: 'KE',
    tags: ['rent-repricing', 'tenant-retention', 'leasing'],
    difficulty: 'intermediate',
    narrative: `A Kilimani 3-bed has housed the same tenant — a consultant at a UN agency — for nine years. Current rent KSh 95,000; market KSh 125,000. The lease comes up for annual review; the owner wants to "fix the gap at least halfway." The tenant has perfect payment history, a daughter at a nearby school, and a close relationship with the caretaker.

Mr. Mwikila's framing: the retention premium for a 9-year perfect-payment tenant is substantial — 3-4 months of gross rent in turnover costs, plus 2-3 weeks of vacancy, plus uncertain replacement quality. A 30% increase is legally and market-defensible but likely to precipitate a move. A 10-12% increase paired with a 3-year commitment might be the cleanest structure.`,
    dataTable: {
      title: 'Repricing math',
      rows: [
        { label: 'Current rent', value: 'KSh 95,000' },
        { label: 'Market rent', value: 'KSh 125,000' },
        { label: 'Gap', value: '31.6%' },
        { label: 'Turnover cost estimate', value: 'KSh 360k' },
        { label: 'Tenant tenure', value: '9 years' },
      ],
    },
    decisionQuestion: 'Which approach would you advise — and how would you frame the conversation?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is a 30% market-close not always the right answer?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the opening line of the rent-review letter.',
      },
    ],
    activity: {
      prompt: 'Write the rent-review letter.',
      deliverable: 'Letter with market evidence + proposed terms.',
      timeBoxMinutes: 30,
    },
    discussionQuestions: ['When is it worth losing a great tenant to capture market rent?'],
  }),

  defineCaseStudy({
    id: 'cs-18-holdover-dispute',
    title: 'Handling a dispute over holdover rent',
    wordCount: 230,
    country: 'KE',
    tags: ['holdover', 'dispute', 'lease'],
    difficulty: 'advanced',
    narrative: `A commercial tenant in an Industrial Area warehouse is holding over 4 months past the lease end while negotiating a renewal. The original lease has a 125% holdover-rent clause; the tenant has been paying the original rent and ignoring the uplift. The landlord's accountant booked holdover rent at the uplifted rate; receivables show KSh 320,000 outstanding.

The tenant's counter-argument: the landlord accepted rent payments without protest, which implies consent to the original rate. The landlord's rebuttal: the lease is explicit, and no written waiver exists. Mr. Mwikila's read: by accepting four months of rent payments without reserving rights in writing, the landlord has weakened the holdover claim.`,
    dataTable: {
      title: 'Holdover math',
      rows: [
        { label: 'Original rent', value: 'KSh 320,000' },
        { label: 'Holdover rate (125%)', value: 'KSh 400,000' },
        { label: 'Months held over', value: '4' },
        { label: 'Receivable at uplifted rate', value: 'KSh 320,000' },
      ],
    },
    decisionQuestion:
      'Can the landlord still recover the uplift — and if not, what procedural change prevents recurrence?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is "implied consent" and how does it erode contract rights?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the "without prejudice" cover letter for the next rent receipt.',
      },
    ],
    activity: {
      prompt: 'Prepare the written reservation of rights to attach to rent receipts during holdover.',
      deliverable: 'Template paragraph.',
      timeBoxMinutes: 20,
    },
    discussionQuestions: ['Should the landlord pursue the tribunal or settle?'],
  }),

  defineCaseStudy({
    id: 'cs-19-refurb-vs-divest-40yr',
    title: 'Portfolio-level decision: refurbish vs divest a 40-year-old block',
    wordCount: 310,
    country: 'KE',
    tags: ['refurbish', 'divest', 'strategy', 'capex'],
    difficulty: 'advanced',
    narrative: `The owner inherited a 28-unit block in South B, built in 1984, from his late father. The building generates KSh 7.8M NOI against a valuation of KSh 105M — a 7.4% cap. Comparable new-builds in the area trade at 6.2% cap. A refurb plan from a QS targets KSh 32M spend to modernize kitchens, bathrooms, lifts, and facade — projected NOI lift to KSh 12.5M and valuation to KSh 195M post-refurb.

The alternative: sell now at KSh 105M and redeploy into a newer asset or a shareholding in a REIT. The owner has emotional attachment to the building — it was his father's flagship.

Mr. Mwikila's structured take: refurb IRR roughly 14% over 5 years; re-deployed capital could hit 16-18% in a value-add strategy. Both are defensible. The deciding factors are execution risk (does the refurb finish on time?) and whether the owner has the bandwidth for an 18-month construction project.`,
    dataTable: {
      title: 'Refurb vs divest',
      rows: [
        { label: 'Current NOI', value: 'KSh 7.8M' },
        { label: 'Current value', value: 'KSh 105M' },
        { label: 'Refurb spend', value: 'KSh 32M' },
        { label: 'Post-refurb NOI', value: 'KSh 12.5M' },
        { label: 'Post-refurb value', value: 'KSh 195M' },
        { label: 'Refurb IRR', value: '~14%' },
        { label: 'Redeployed capital target IRR', value: '16-18%' },
      ],
    },
    decisionQuestion: 'Refurbish or divest — and what additional data would you want before committing?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you weigh execution risk against opportunity cost?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'What would change your answer if the refurb IRR was 18% instead of 14%?',
      },
    ],
    activity: {
      prompt: 'Build the decision tree Mr. Mwikila would present to the owner.',
      deliverable: 'One-page decision tree.',
      timeBoxMinutes: 60,
    },
    discussionQuestions: [
      'How do you incorporate the emotional value of the asset without letting it dominate the decision?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-20-first-90-days-200unit',
    title: 'Managing the first 90 days after acquisition of a 200-unit portfolio',
    wordCount: 300,
    country: 'KE',
    tags: ['acquisition', 'first-90-days', 'operations'],
    difficulty: 'advanced',
    narrative: `A pan-African fund has just closed on a 200-unit mid-market residential portfolio across three Nairobi estates — 80 units in Kileleshwa, 60 in South C, 60 in Lavington. The seller's on-site team of 14 stays on a 90-day retention; BORJIE is appointed asset manager.

Day 1 challenges: records are split between three Excel workbooks and a shoebox of lease PDFs. The accountant has left. Vendor contracts are either verbal or expired. The rent roll shows 94% occupancy on paper; a walk-through reveals two units are used by the seller's family and one is empty but reported as occupied. Arrears reporting has been selective.

Mr. Mwikila's 90-day playbook: Week 1 — meet every staff member individually, take possession of keys and records. Week 2-4 — tenant interviews, baseline condition survey, vendor audit. Week 5-8 — quick wins: paint, gate repair, signage; renegotiate the two most expensive vendor contracts; tighten collections. Week 9-12 — migrate onto BORJIE systems, first clean month-end, first owner report. Target: 5% NOI uplift by day 90.`,
    dataTable: {
      title: 'Acquisition baseline',
      rows: [
        { label: 'Units', value: '200' },
        { label: 'Reported occupancy', value: '94%' },
        { label: 'Actual occupancy after walkthrough', value: '92%' },
        { label: 'On-site staff retained', value: '14 (90-day transition)' },
        { label: 'NOI uplift target by day 90', value: '5%' },
      ],
    },
    decisionQuestion: 'What are the 5 highest-leverage actions in the first 30 days?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does speed matter in the first 30 days?',
      },
      {
        bloomLevel: 'create',
        question: 'Prioritise the week-1 action list.',
      },
    ],
    activity: {
      prompt: 'Draft the week-1 team meeting agenda and the week-1 owner-update note.',
      deliverable: 'Agenda + note.',
      timeBoxMinutes: 50,
    },
    discussionQuestions: ['What do you do about the two units used by the seller family?'],
  }),

  defineCaseStudy({
    id: 'cs-21-security-deposit-dispute',
    title: 'Security-deposit dispute: damage vs fair wear and tear',
    wordCount: 220,
    country: 'KE',
    tags: ['deposit', 'dispute', 'move-out'],
    difficulty: 'intermediate',
    narrative: `A tenant vacated a Westlands 2-bed after 18 months. Move-out inspection showed: wall scuffs on corridor (paint required), cracked tile in kitchen, scratched hardwood in living room, and a slightly-stained mattress cover in the landlord-provided beds. Deposit: KSh 180,000. Landlord withheld KSh 140k citing the above plus "cleaning KSh 25k."

The tenant filed at the tribunal claiming fair wear and tear. Mr. Mwikila's read: paint after 18 months is borderline (normal cycle 2-3 years), the cracked tile is damage, the hardwood scratches are damage, and the mattress stain with time-stamped move-in photos is wear-and-tear.`,
    dataTable: {
      title: 'Disposition breakdown',
      rows: [
        { label: 'Deposit', value: 'KSh 180,000' },
        { label: 'Withheld', value: 'KSh 140,000' },
        { label: 'Paint (18 mo)', value: 'KSh 35,000' },
        { label: 'Tile repair', value: 'KSh 18,000' },
        { label: 'Hardwood refinish', value: 'KSh 42,000' },
        { label: 'Cleaning', value: 'KSh 25,000' },
        { label: 'Mattress cover', value: 'KSh 20,000' },
      ],
    },
    decisionQuestion: 'How much of the KSh 140k withholding is defensible at tribunal?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the legal test for fair wear and tear?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'Which items would you concede to strengthen the case on the others?',
      },
    ],
    activity: {
      prompt: 'Prepare the revised disposition statement for the tribunal.',
      deliverable: 'Letter + photo annex.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: ['How would earlier move-in photos have changed this?'],
  }),

  defineCaseStudy({
    id: 'cs-22-gepg-unapplied-cash',
    title: 'GePG unapplied cash cleanup',
    wordCount: 210,
    country: 'TZ',
    tags: ['gepg', 'reconciliation', 'finance'],
    difficulty: 'intermediate',
    narrative: `A Dar property-management operation has accumulated TSh 4.8M in an unapplied-cash clearing account over nine months. The accountant treats it as "safer than applying wrong." The operations manager sees it as a Sarbanes-like time bomb: money that belongs to someone, but no one is sure who.

Mr. Mwikila's audit: 38 transactions. 22 match cleanly with a same-day rent invoice — just never posted. 9 are partial payments (allocate oldest arrears first). 4 are wrong control numbers — research the sender, reverse-and-rebook. 3 are overpayments — credit next invoice with tenant confirmation.`,
    dataTable: {
      title: 'Unapplied cash composition',
      rows: [
        { label: 'Total unapplied', value: 'TSh 4.8M' },
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
        question: 'Walk through the cleanup steps for one of the wrong-control-number transactions.',
      },
      {
        bloomLevel: 'create',
        question: 'Design a daily reconciliation routine that keeps unapplied cash at zero.',
      },
    ],
    activity: {
      prompt: 'Write the SOP for daily GePG reconciliation.',
      deliverable: 'One-page SOP.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['When is it safer to leave cash unapplied than to apply it guessing?'],
  }),

  defineCaseStudy({
    id: 'cs-23-airbnb-sublet-breach',
    title: 'Airbnb sublet discovered mid-lease',
    wordCount: 220,
    country: 'KE',
    tags: ['sublet', 'breach', 'lease'],
    difficulty: 'intermediate',
    narrative: `A Westlands 1-bed tenant has been listing the unit on Airbnb on weekends for 3 months without landlord consent. The lease has a standard "no sublet without written consent" clause. The landlord discovered via a neighbour's complaint; a quick search confirmed 12 weekend bookings at KSh 8,000/night average.

The tenant argues the sublet generated KSh 288k of income on her side — significantly more than her KSh 55k monthly rent — and offers a revenue-share retroactively.`,
    dataTable: {
      title: 'Airbnb breach facts',
      rows: [
        { label: 'Bookings', value: '12' },
        { label: 'Avg nightly', value: 'KSh 8,000' },
        { label: 'Gross revenue', value: 'KSh 288,000 (3 months)' },
        { label: 'Tenant rent', value: 'KSh 55,000/month' },
      ],
    },
    decisionQuestion: 'Enforce strict breach consequences, accept revenue share, or renegotiate the lease?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the landlord actually trying to protect with the no-sublet clause?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'How does insurance coverage change if Airbnb is allowed?',
      },
    ],
    activity: {
      prompt: 'Draft the landlord response letter with three options for the tenant.',
      deliverable: 'Letter.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: [
      'Should the lease template be updated with a platform-specific clause?',
    ],
  }),

  defineCaseStudy({
    id: 'cs-24-nema-eia-delay',
    title: 'NEMA EIA delay on a greenfield 50-unit project',
    wordCount: 220,
    country: 'KE',
    tags: ['nema', 'eia', 'compliance', 'development'],
    difficulty: 'advanced',
    narrative: `A developer is 8 months into a 50-unit residential project in Kitengela. Foundation is complete; superstructure is starting. A neighbour lodged an objection to the NEMA EIA citing inadequate public participation. NEMA issued a stop-work notice. The developer's financing has a 14-day drawdown clock.

Mr. Mwikila's read: the objection has merit on procedure — the developer's lead expert held one sparsely-attended public meeting. Remediation requires a fresh round of stakeholder engagement (4-6 weeks) and supplementary EIA filing (2-3 weeks NEMA review). Total delay: 6-9 weeks, plus bank fees.`,
    dataTable: {
      title: 'NEMA EIA delay impact',
      rows: [
        { label: 'Months into project', value: '8' },
        { label: 'Drawdown clock', value: '14 days' },
        { label: 'Delay estimate', value: '6-9 weeks' },
        { label: 'Bank penalty', value: 'KSh 1.4M' },
      ],
    },
    decisionQuestion: 'What is the containment + remediation plan?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why does a procedural objection stop work when the substance is compliant?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a stakeholder-engagement plan that would pass NEMA muster.',
      },
    ],
    activity: {
      prompt: 'Write the email to the bank explaining the delay and seeking a covenant waiver.',
      deliverable: 'Email.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['What process change avoids this in future projects?'],
  }),

  defineCaseStudy({
    id: 'cs-25-solar-panel-decision',
    title: 'Solar panel capex decision on a 30-unit block',
    wordCount: 230,
    country: 'KE',
    tags: ['capex', 'solar', 'sustainability'],
    difficulty: 'intermediate',
    narrative: `A Lavington 30-unit block spends KSh 380k/month on Kenya Power for common-area lighting, water pumps, and the borehole. A solar proposal from a local integrator quotes KSh 4.8M capex for a system covering 60% of daytime load, with KSh 180k/month savings. Payback: ~27 months. Warranty: 10 years.

The owner is cash-rich but cautious. The service charge could not easily absorb the capex without a special assessment, and tenants resist those.`,
    dataTable: {
      title: 'Solar capex math',
      rows: [
        { label: 'Capex', value: 'KSh 4.8M' },
        { label: 'Monthly saving', value: 'KSh 180k' },
        { label: 'Simple payback', value: '27 months' },
        { label: 'Warranty', value: '10 years' },
      ],
    },
    decisionQuestion: 'Is this a yes, a no, or a "negotiate the financing" situation?',
    socraticPath: [
      {
        bloomLevel: 'apply',
        question: 'Calculate the NPV at 12% over 10 years.',
      },
      {
        bloomLevel: 'evaluate',
        question: 'Which financing structure (cash / sinking fund / vendor financing) do you prefer?',
      },
    ],
    activity: {
      prompt: 'Build the owner memo with three funding options.',
      deliverable: 'Memo.',
      timeBoxMinutes: 40,
    },
    discussionQuestions: ['Would your answer change if the block had only 3 years of hold left?'],
  }),

  defineCaseStudy({
    id: 'cs-26-late-fee-legal-defensibility',
    title: 'Late-fee legal defensibility at tribunal',
    wordCount: 210,
    country: 'KE',
    tags: ['late-fee', 'legal', 'arrears'],
    difficulty: 'advanced',
    narrative: `A landlord enforced a 5% compounding monthly late fee on a tenant 4 months in arrears. The tenant paid the principal and contested the KSh 21k late fees at the BPRT. The lease has the clause in writing; the tenant argues it is "penal" and therefore unenforceable.

Mr. Mwikila's read: East African courts generally enforce late fees if they are (a) clearly stated, (b) a reasonable pre-estimate of the landlord's loss, and (c) not punitive. A 5% compounding monthly fee is aggressive. The landlord's position is strong on (a) but weaker on (b) and (c).`,
    dataTable: {
      title: 'Late-fee math',
      rows: [
        { label: 'Rent', value: 'KSh 45,000/month' },
        { label: 'Months late', value: '4' },
        { label: 'Late fee claimed', value: 'KSh 21,000' },
        { label: 'As % of principal', value: '11.7%' },
      ],
    },
    decisionQuestion: 'What is the litigation strategy? Defend, negotiate, withdraw?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What is the legal difference between liquidated damages and a penalty?',
      },
      {
        bloomLevel: 'create',
        question: 'Redraft the late-fee clause so it is more defensible.',
      },
    ],
    activity: {
      prompt: 'Write the revised clause for the lease template.',
      deliverable: 'One-paragraph clause.',
      timeBoxMinutes: 25,
    },
    discussionQuestions: ['When do you waive fees to preserve a good tenant?'],
  }),

  defineCaseStudy({
    id: 'cs-27-portfolio-rebalance-coastal',
    title: 'Portfolio rebalance: adding coastal exposure',
    wordCount: 250,
    country: 'KE',
    tags: ['portfolio', 'strategy', 'diversification'],
    difficulty: 'advanced',
    narrative: `A Nairobi-based owner has a KSh 800M portfolio — 85% residential, 100% Nairobi. A Mombasa broker offers a 12-unit beachfront apartment building at KSh 180M, yielding 9.5% gross. The owner is intrigued — diversifies geography, adds tourism exposure — but nervous about distance-management.

Mr. Mwikila's take: geography diversification cuts portfolio volatility 20-30% if the assets are not correlated. Mombasa tourism correlates with coastal KSh/USD flows more than Nairobi office. Operational risk is higher — distance means reliance on on-site staff. A third-party manager at 8-10% of collections absorbs ~100bps of the yield.`,
    dataTable: {
      title: 'Portfolio rebalance math',
      rows: [
        { label: 'Current portfolio', value: 'KSh 800M, 100% Nairobi' },
        { label: 'Mombasa target', value: 'KSh 180M, 9.5% gross' },
        { label: 'Management fee', value: '8-10% of collections' },
        { label: 'Net yield after fee', value: '~8.5%' },
      ],
    },
    decisionQuestion:
      'Proceed, pass, or explore Coastal but on a different asset?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you decide whether distance-management risk is worth the diversification benefit?',
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
    discussionQuestions: ['Would your answer differ for a value-add vs stabilised coastal asset?'],
  }),

  defineCaseStudy({
    id: 'cs-28-anchor-tenant-financial-distress',
    title: 'Anchor tenant showing financial distress',
    wordCount: 250,
    country: 'KE',
    tags: ['anchor-tenant', 'distress', 'commercial'],
    difficulty: 'advanced',
    narrative: `A Westlands mixed-use building's ground-floor anchor is a fashion retailer with 3 years left on a 7-year lease at KSh 1.1M/month. Three pattern-breaks over the last 6 months: rent payments slipping from day 1 to days 8, 14, 21. Q3 sales (per the tenant's own reporting under the percentage-rent clause) down 30%. The tenant's listed parent in South Africa just cut its East African store count from 40 to 28.

Mr. Mwikila's read: this is pre-default. Options are engage (negotiate temporary abatement tied to a cure plan), enforce (pressure full payment, accept possible default), or prepare (line up a backup anchor quietly). The cost of losing the anchor is 4-6 months vacancy and KSh 200-400k of TI on a replacement.`,
    dataTable: {
      title: 'Anchor tenant distress signals',
      rows: [
        { label: 'Monthly rent', value: 'KSh 1.1M' },
        { label: 'Lease remaining', value: '3 years' },
        { label: 'Payment slippage', value: '1 → 8 → 14 → 21 days' },
        { label: 'Q3 sales drop', value: '-30%' },
        { label: 'Vacancy cost estimate', value: 'KSh 6M + TI' },
      ],
    },
    decisionQuestion: 'What is your sequenced 30/60/90-day plan?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'What information is hidden in the payment-slippage pattern?',
      },
      {
        bloomLevel: 'create',
        question: 'Design the temporary abatement structure.',
      },
    ],
    activity: {
      prompt: 'Draft the meeting agenda for the tenant conversation.',
      deliverable: 'Agenda.',
      timeBoxMinutes: 35,
    },
    discussionQuestions: ['When is it right to pre-emptively replace an anchor before they default?'],
  }),

  defineCaseStudy({
    id: 'cs-29-sinking-fund-underfunded',
    title: 'Sinking fund underfunded — 25-year-old block',
    wordCount: 230,
    country: 'TZ',
    tags: ['sinking-fund', 'capex', 'reserves'],
    difficulty: 'intermediate',
    narrative: `A 32-unit block in Mikocheni, built in 2001, has a sinking fund of TSh 8M. The 5-year capex plan calls for TSh 28M of work (roof TSh 14M in year 2, lifts TSh 9M in year 4, painting TSh 5M in year 3). Current service-charge collections can only fund a 10% sinking-fund contribution — about TSh 3.8M/year.

The owner asks: raise the service charge, special assessment, or stretch the capex schedule?`,
    dataTable: {
      title: 'Sinking fund math',
      rows: [
        { label: 'Sinking fund balance', value: 'TSh 8M' },
        { label: '5-yr capex plan', value: 'TSh 28M' },
        { label: 'Annual contribution', value: 'TSh 3.8M' },
        { label: 'Funding gap at Y5', value: 'TSh 1M (assuming on-schedule)' },
      ],
    },
    decisionQuestion:
      'Service-charge increase, special assessment, or capex stretch — and how do you explain to tenants?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why are special assessments the last resort?',
      },
      {
        bloomLevel: 'create',
        question: 'Design a 3-year ramp in service-charge contributions.',
      },
    ],
    activity: {
      prompt: 'Write the service-charge-review letter to tenants.',
      deliverable: 'Letter.',
      timeBoxMinutes: 30,
    },
    discussionQuestions: ['Does your answer change if the building is due for sale in 3 years?'],
  }),

  defineCaseStudy({
    id: 'cs-30-dpa-subject-access-request',
    title: 'DPA subject-access request from former tenant',
    wordCount: 210,
    country: 'KE',
    tags: ['dpa', 'privacy', 'compliance'],
    difficulty: 'intermediate',
    narrative: `A former tenant of a Nairobi 40-unit block filed a subject-access request under the Data Protection Act 2019 three months after moving out. She requests "all data held about me." The PM has: lease agreements (hers + co-tenant), KYC docs (her ID, her husband's ID, employer letter), rent ledger, complaint emails, maintenance case notes, move-out photos, CCTV footage references.

Mr. Mwikila's checklist: 30 days to respond. Redact all third parties in joint documents (co-tenant, husband where they appear, maintenance contractor identities). CCTV footage is rarely included unless the subject specifically requested it. Format must be machine-readable.`,
    dataTable: {
      title: 'SAR response inventory',
      rows: [
        { label: 'Response window', value: '30 days' },
        { label: 'Data categories', value: '7 (lease, KYC, ledger, emails, maintenance, photos, CCTV)' },
        { label: 'Redaction required', value: 'co-tenant, husband, third parties' },
        { label: 'Penalty for non-compliance', value: 'up to KSh 5M' },
      ],
    },
    decisionQuestion: 'What is the 30-day SAR response plan?',
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
    discussionQuestions: ['How do you minimise the burden of SARs going forward?'],
  }),

  defineCaseStudy({
    id: 'cs-31-cam-dispute-office',
    title: 'CAM reconciliation dispute with office tenant',
    wordCount: 230,
    country: 'KE',
    tags: ['cam', 'commercial', 'reconciliation'],
    difficulty: 'advanced',
    narrative: `A Westlands office-building tenant disputes the KSh 1.3M year-end CAM true-up bill. The base-year OpEx (when the lease started in 2022) was KSh 95/sqft. The 2025 CAM came in at KSh 138/sqft. The tenant's audit rights permit a review, which they are now invoking.

Their findings: the landlord included a lobby-refurbishment capex line (KSh 4.2M) as OpEx, and did not gross up variable OpEx during a 76%-occupied year. Mr. Mwikila's read: the capex inclusion is a clear error; the gross-up is a defensible practice if the lease says so.`,
    dataTable: {
      title: 'CAM dispute math',
      rows: [
        { label: 'Base-year OpEx', value: 'KSh 95/sqft' },
        { label: '2025 OpEx', value: 'KSh 138/sqft' },
        { label: 'Billed passthrough', value: 'KSh 1.3M' },
        { label: 'Capex misposted', value: 'KSh 4.2M' },
        { label: 'Building occupancy during year', value: '76%' },
      ],
    },
    decisionQuestion: 'What concessions do you make, what do you defend, and how do you preserve the relationship?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'Why is capex-as-OpEx a common but costly error?',
      },
      {
        bloomLevel: 'create',
        question: 'Draft the revised CAM statement.',
      },
    ],
    activity: {
      prompt: 'Write the tenant response letter.',
      deliverable: 'Letter + revised CAM table.',
      timeBoxMinutes: 45,
    },
    discussionQuestions: ['How do you prevent this across the whole building?'],
  }),

  defineCaseStudy({
    id: 'cs-32-tenant-harassment-complaint',
    title: 'Tenant harassment complaint against a caretaker',
    wordCount: 220,
    country: 'KE',
    tags: ['harassment', 'hr', 'compliance'],
    difficulty: 'advanced',
    narrative: `A single-tenant female resident in a 40-unit South C block lodged a written complaint alleging the caretaker made inappropriate comments and lingered outside her unit on two occasions. No physical contact; no witnesses; no CCTV on her corridor.

The caretaker has worked on the block for 6 years with no prior complaints, two positive tenant references, and a clean record. The tenant is a reliable payer, 2-year tenure, and explicitly asked for confidentiality and protection.`,
    dataTable: {
      title: 'Complaint investigation snapshot',
      rows: [
        { label: 'Allegations', value: '2 incidents' },
        { label: 'Physical contact', value: 'No' },
        { label: 'Witnesses / CCTV', value: 'None' },
        { label: 'Caretaker tenure', value: '6 years' },
        { label: 'Tenant tenure', value: '2 years' },
      ],
    },
    decisionQuestion: 'What is the protocol — for the tenant, the caretaker, and the record?',
    socraticPath: [
      {
        bloomLevel: 'analyze',
        question: 'How do you protect both parties while investigating?',
      },
      {
        bloomLevel: 'evaluate',
        question: 'When do you escalate to the labour office or police?',
      },
    ],
    activity: {
      prompt: 'Write the 3-page incident-handling protocol.',
      deliverable: 'Protocol.',
      timeBoxMinutes: 50,
    },
    discussionQuestions: [
      'What preventative measures would reduce recurrence risk across the portfolio?',
    ],
  }),
] as const;

export const SHORT_CASE_STUDIES: readonly CaseStudy[] = Object.freeze(SHORT_CASES);
