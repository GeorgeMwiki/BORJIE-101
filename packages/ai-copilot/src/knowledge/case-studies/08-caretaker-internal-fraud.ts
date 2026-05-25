import { defineCaseStudy } from './case-study-types.js';

export const CASE_STUDY_08_CARETAKER_FRAUD = defineCaseStudy({
  id: 'cs-08-caretaker-internal-fraud',
  title: 'When the caretaker is stealing: an uncomfortable investigation',
  wordCount: 890,
  country: 'TZ',
  tags: ['fraud', 'caretaker', 'internal-audit', 'governance', 'compassion'],
  difficulty: 'intermediate',
  narrative: `Mikocheni Apartments has an in-house caretaker, Mzee Juma, who has been at the block for 11 years. Tenants love him. He knows every child\'s name. He shows up for funerals. The property manager, Maria, inherits the building when her firm takes over the contract in September 2025.

In December, a routine audit flags three anomalies. First, petty cash reconciliation shows Tsh 2.3 M more spent on "minor repairs" in 2025 than 2024 with no increase in reported incidents. Second, three repeat payments for the same gate-motor servicing (same vendor, three different dates) at Tsh 180,000 each — only one of which appears in the service log. Third, the weekly water-tank cleaning is invoiced at Tsh 30,000 — industry rate is Tsh 12,000-18,000.

Maria wants to be careful. Over 11 years Mzee Juma has built trust. He is the reason three long-term tenants have never left. He is also the only person in the compound who can calmly defuse a domestic dispute at 2 a.m. If Maria is wrong, or if she handles this badly, she destroys the block\'s culture. If she is right and does nothing, the firm is complicit.

Maria runs a quiet three-week investigation. She personally verifies the gate-motor vendor — it is a real company with a real invoice book. Two of the three "servicing" visits happened. The third was a phantom. She inquires with three other caretakers at peer buildings in Mikocheni what water-tank cleaning costs — Tsh 15,000 is the high end. She pulls petty-cash receipts for the year and finds 17 receipts that are handwritten, no letterhead, no TRA pin, for amounts between Tsh 8,000 and Tsh 42,000 — total Tsh 380,000.

Maria also quietly asks the previous property manager, who handled the block from 2018-2025, if there had been concerns. The previous manager, visibly uncomfortable, admits "there were signs three years ago but we let it go because Mzee Juma was good with the tenants and the owner did not want to rock the boat."

The estimated gross exposure is Tsh 1.4-2.1 M over 12 months, plus whatever went undetected before. Mzee Juma\'s monthly salary is Tsh 380,000. The skim is roughly 30-45 percent of his legitimate pay.

Maria is 32. She has to have a conversation that her predecessor avoided for three years. She also has to decide whether to fire the person three tenants call "uncle."`,
  dataTable: {
    title: 'Mikocheni — 12-month petty-cash review',
    rows: [
      { label: 'Caretaker tenure', value: '11 years' },
      { label: 'Caretaker monthly salary', value: 'Tsh 380,000' },
      { label: 'Excess repairs 2024 vs 2025', value: 'Tsh 2.3 M' },
      { label: 'Phantom gate-motor service', value: 'Tsh 180,000' },
      { label: 'Water-tank cleaning markup vs peer', value: '~100%' },
      { label: 'Non-compliant receipts', value: '17 receipts, Tsh 380k total' },
      { label: 'Estimated annual skim', value: 'Tsh 1.4-2.1 M' },
      { label: 'Skim as % of salary', value: '30-45%' },
      { label: 'Prior manager signal', value: 'Concerns noted 2022; ignored' },
    ],
  },
  decisionQuestion:
    'What does Maria do? How does she frame the conversation with Mzee Juma, and what is the path that protects the tenants, the owner, and Mzee Juma\'s dignity as much as possible?',
  socraticPath: [
    {
      bloomLevel: 'remember',
      question:
        'What are the three most common categories of caretaker-level fraud?',
      idealAnswerSketch:
        'Phantom invoices, vendor markup kickbacks, petty-cash receipt forgery.',
    },
    {
      bloomLevel: 'understand',
      question:
        'Why is long tenure both a protection for and a risk factor in caretaker fraud?',
    },
    {
      bloomLevel: 'apply',
      question:
        'Design Maria\'s evidence file: what exactly does she bring to the conversation?',
      idealAnswerSketch:
        'Side-by-side petty-cash receipts, vendor call records confirming the phantom visit, peer-benchmarking for water-tank rates, 12-month spend comparison. Facts only, no accusations.',
    },
    {
      bloomLevel: 'apply',
      question:
        'What is the shape of the 60-minute conversation Maria has with Mzee Juma?',
      idealAnswerSketch:
        'Open with respect for tenure. Present the facts without narration. Ask for his explanation. Listen. Name the gap. Offer a path (repayment schedule + resignation vs termination with cause). Confidentiality terms.',
    },
    {
      bloomLevel: 'analyze',
      question:
        'The tenants love Mzee Juma. Does that change the facts or change the execution?',
    },
    {
      bloomLevel: 'analyze',
      question:
        'What is the risk that Mzee Juma has co-opted the gardener or the security guard?',
    },
    {
      bloomLevel: 'evaluate',
      question:
        'Is it ever right to overlook a confirmed fraud because the employee has cultural value to the block?',
      idealAnswerSketch:
        'No. But execution matters: termination can be with dignity, with a referenced exit, and with a structured handover that protects tenant continuity. Overlooking sets a precedent that will cost the block orders of magnitude more in future.',
    },
    {
      bloomLevel: 'create',
      question:
        'Draft the announcement Maria sends tenants the day after Mzee Juma departs.',
      idealAnswerSketch:
        'Short, factual, warm. Acknowledges his service without disclosing confidential terms. Introduces the transition plan. Invites tenants to meet the interim caretaker.',
    },
  ],
  activity: {
    prompt:
      'You are Maria. Produce (1) the facts file for the conversation, (2) the script for the 60-minute meeting with Mzee Juma, (3) the tenant announcement.',
    deliverable: 'Three documents, each under 1 page.',
    timeBoxMinutes: 45,
  },
  discussionQuestions: [
    'How does Maria protect the firm against a future wrongful-termination claim?',
    'Should the owner be told before or after the conversation with Mzee Juma?',
    'How do you rebuild the block\'s trust in caretaker-managed petty cash after this?',
    'What are the cultural dynamics (age, respect for elders) that make this specific conversation harder in East Africa than in other markets?',
    'If Mzee Juma denies everything and refuses to resign, what is Maria\'s next move?',
  ],
});
