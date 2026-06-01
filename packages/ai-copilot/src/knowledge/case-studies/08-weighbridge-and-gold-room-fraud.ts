import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_08_GOLD_ROOM_FRAUD = defineCaseStudy({
  id: 'cs-08-weighbridge-and-gold-room-fraud',
  title: 'When the gold-room foreman is stealing: an uncomfortable investigation',
  wordCount: 910,
  country: 'TZ',
  tags: ['fraud', 'gold-room', 'weighbridge', 'internal-audit', 'governance', 'compassion'],
  difficulty: 'intermediate',
  narrative: `The "Nyakato" mill has an in-house gold-room and weighbridge foreman, Mzee Juma, who has been at the operation for 11 years. The crews trust him. He knows every operator's name. He shows up for funerals. The new site manager, Maria, inherits the plant when her firm takes over the operating contract in September 2025.

In December, a routine reconciliation flags three anomalies. First, the metallurgical balance shows the gold room's "smelt loss" running at 6-7 percent of contained gold in the loaded carbon, against a circuit that should lose under 2 percent — an unexplained Mzee-Juma-supervised gap worth tens of millions of shillings a month. Second, three "re-melt" entries in the gold-room logbook record the same crucible batch being re-smelted on three different dates, only one of which ties to a bar dispatched to the refiner. Third, the weighbridge tickets for reagent and consumables deliveries show carbon and caustic quantities 20-30 percent above the metallurgical reagent model, with the surplus signed in by Mzee Juma against a single supplier.

Maria wants to be careful. Over 11 years Mzee Juma has built trust; he is the reason two long-serving operators have never left, and the only person who can calmly settle a night-shift dispute in the plant. If she is wrong, or handles this badly, she destroys the crew's culture. If she is right and does nothing, the firm is complicit and the State is being under-paid its royalty on under-declared gold.

Maria runs a quiet three-week investigation. She re-runs the metallurgical balance with an independent metallurgist and a sealed split of the loaded carbon assay — the true smelt loss is 1.8 percent, not 7. She has the gold-room CCTV pulled and finds a blind corner over the smelt furnace and a 90-second gap in the recording each evening. She benchmarks the reagent consumption against two peer mills of similar throughput — both run 20-25 percent below Nyakato's signed quantities. She pulls the weighbridge tickets and finds 17 deliveries with handwritten dockets, no supplier TIN, and no gatehouse counter-signature, for amounts that do not reconcile to stores receipts.

Maria also quietly asks the previous site manager, who ran Nyakato from 2018-2025, whether there had been concerns. The previous manager, visibly uncomfortable, admits "there were signs three years ago, but we let it go because Mzee Juma kept the gold room running and the owner did not want to rock the boat."

The estimated gross exposure is TZS 280-420 million over 12 months in lost gold and inflated reagents, plus whatever went undetected before, plus the under-remitted 7 percent royalty-and-clearing on the missing metal. Mzee Juma's monthly salary is TZS 1.9 million. The skim dwarfs his legitimate pay.

Maria is 32. She has to have the conversation her predecessor avoided for three years. She also has to decide whether to dismiss the person two operators call "uncle."`,
  dataTable: {
    title: 'Nyakato mill — 12-month gold-room & reagent review',
    rows: [
      { label: 'Foreman tenure', value: '11 years' },
      { label: 'Foreman monthly salary', value: 'TZS 1.9 M' },
      { label: 'Reported smelt loss', value: '6-7% of contained gold' },
      { label: 'True smelt loss (independent)', value: '1.8%' },
      { label: 'Phantom re-melt entries', value: '2 of 3 batches never dispatched' },
      { label: 'Reagent over-signing vs peers', value: '20-30%' },
      { label: 'Non-compliant weighbridge dockets', value: '17, no TIN, no counter-sign' },
      { label: 'Estimated annual exposure', value: 'TZS 280-420 M' },
      { label: 'Under-remitted royalty + clearing', value: '7% of missing metal value' },
      { label: 'Prior manager signal', value: 'Concerns noted 2022; ignored' },
    ],
  },
  decisionQuestion:
    'What does Maria do? How does she frame the conversation with Mzee Juma, and what path protects the crew, the owner, the State\'s royalty, and Mzee Juma\'s dignity as much as possible?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What are the three most common categories of gold-room and weighbridge fraud?',
      idealAnswerSketch:
        'Inflated smelt loss (skimming metal as "loss"), phantom re-melt / under-declaration of poured bars, and reagent/consumables over-signing kickbacks.',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is long tenure both a protection for and a risk factor in gold-room fraud?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design Maria\'s evidence file: what exactly does she bring to the conversation?',
      idealAnswerSketch:
        'Independent metallurgical balance with the sealed-split assay, the CCTV gap log, peer reagent benchmarks, the 17 non-compliant weighbridge dockets, and the re-melt logbook versus refiner-dispatch reconciliation. Facts only, no accusations.',
    },
    {
      bloomLevel: 'apply',
      question:
        'What is the shape of the 60-minute conversation Maria has with Mzee Juma?',
      idealAnswerSketch:
        'Open with respect for tenure. Present the facts without narration. Ask for his explanation. Listen. Name the gap. Offer a path (repayment schedule + resignation versus dismissal with cause). State confidentiality terms.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'The crew loves Mzee Juma. Does that change the facts or change the execution?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What is the risk that Mzee Juma has co-opted the weighbridge clerk or a security guard, and how does that change the security plan around the gold room during the investigation?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is it ever right to overlook a confirmed gold-room fraud because the employee is valued by the crew?',
      idealAnswerSketch:
        'No. But execution matters: dismissal can be done with dignity, a referenced exit, and a structured handover that protects shift continuity. Overlooking it sets a precedent that costs the operation orders of magnitude more in lost metal and royalty exposure — and is a direct compliance breach.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the briefing Maria gives the gold-room crew the day after Mzee Juma departs.',
      idealAnswerSketch:
        'Short, factual, calm. Acknowledges his service without disclosing confidential terms. Introduces the dual-control gold-room procedure and the interim foreman. Reassures the crew that pay and shifts are unaffected.',
    },
  ],
  activity: {
    prompt:
      'You are Maria. Produce (1) the facts file for the conversation, (2) the script for the 60-minute meeting with Mzee Juma, (3) the crew briefing.',
    deliverable: 'Three documents, each under 1 page.',
    timeBoxMinutes: 45,
  },
  discussionQuestions: [
    'How does Maria protect the firm against a future wrongful-dismissal claim under Tanzanian labour law?',
    'Should the owner be told before or after the conversation with Mzee Juma?',
    'How do you rebuild the crew\'s trust in the gold room after this, and what dual-control procedure do you install?',
    'What are the cultural dynamics (age, respect for elders) that make this conversation harder in this setting than in others?',
    'If Mzee Juma denies everything and refuses to resign, what is Maria\'s next move?',
  ],
});
