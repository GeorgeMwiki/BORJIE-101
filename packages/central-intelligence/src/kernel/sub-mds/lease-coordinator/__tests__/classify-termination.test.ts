import { describe, expect, it } from 'vitest';
import {
  classifyTerminationRequest,
  type TerminationKind,
} from '../tools/classify-termination-request.js';

interface Case {
  readonly text: string;
  readonly expectedKind: TerminationKind;
  readonly note?: string;
}

const CASES: ReadonlyArray<Case> = [
  // NOTICE-OF-INTENT — 12
  { text: 'I am giving notice — I will move out at the end of the month', expectedKind: 'notice-of-intent' },
  { text: 'This is a formal notice of intent to vacate', expectedKind: 'notice-of-intent' },
  { text: 'I will be moving out on 2026-07-31', expectedKind: 'notice-of-intent' },
  { text: 'Please accept my 30-day notice', expectedKind: 'notice-of-intent' },
  { text: '30 day notice — moving on 1 August', expectedKind: 'notice-of-intent' },
  { text: 'Two months notice — leaving in September', expectedKind: 'notice-of-intent' },
  { text: 'Natoa taarifa rasmi ya kuondoka', expectedKind: 'notice-of-intent' },
  { text: 'Nataka kuondoka mwezi ujao', expectedKind: 'notice-of-intent' },
  { text: 'Taarifa rasmi ya kuondoka tarehe 30/06/2026', expectedKind: 'notice-of-intent' },
  { text: 'I will vacate the unit by July 31', expectedKind: 'notice-of-intent' },
  { text: 'Giving notice — moving day is Saturday', expectedKind: 'notice-of-intent' },
  { text: 'Please consider this as formal notice', expectedKind: 'notice-of-intent' },

  // URGENT-EMERGENCY — 10
  { text: 'I lost my job and cannot stay in the apartment', expectedKind: 'urgent-emergency' },
  { text: 'Family emergency, need to leave immediately', expectedKind: 'urgent-emergency' },
  { text: 'Medical emergency in my family, I must move', expectedKind: 'urgent-emergency' },
  { text: 'Nimepoteza kazi, siwezi kukaa hapa', expectedKind: 'urgent-emergency' },
  { text: 'Dharura ya matibabu, lazima niondoke haraka', expectedKind: 'urgent-emergency' },
  { text: 'I cannot stay another day, urgent please', expectedKind: 'urgent-emergency' },
  { text: 'Need to leave immediately due to health issues', expectedKind: 'urgent-emergency' },
  { text: 'My job ended yesterday, what do I do?', expectedKind: 'urgent-emergency' },
  { text: 'Family emergency at home, must vacate', expectedKind: 'urgent-emergency' },
  { text: 'Siwezi kukaa kwa sababu ya matatizo ya kifamilia', expectedKind: 'urgent-emergency' },

  // DISPUTE-DRIVEN — 10
  { text: 'Because of the maintenance issues I cannot live here anymore', expectedKind: 'dispute-driven' },
  { text: 'Landlord did not fix the leak; this is breach of contract', expectedKind: 'dispute-driven' },
  { text: 'Mmiliki hakufanya matengenezo, naomba kumaliza mkataba', expectedKind: 'dispute-driven' },
  { text: 'Kuvunja mkataba ni jambo la mmiliki, si langu', expectedKind: 'dispute-driven' },
  { text: 'Unfair treatment by the property manager, I am leaving', expectedKind: 'dispute-driven' },
  { text: 'I cannot live here anymore because of constant problems', expectedKind: 'dispute-driven' },
  { text: 'The landlord did not honour the contract — breach of contract', expectedKind: 'dispute-driven' },
  { text: 'Kwa sababu ya matengenezo yaliyochelewa, nataka kuondoka', expectedKind: 'dispute-driven' },
  { text: 'Continuous unfair treatment leaves me no choice', expectedKind: 'dispute-driven' },
  { text: 'Landlord did not respond to my complaints for three months', expectedKind: 'dispute-driven' },

  // EXPLORATORY — 10
  { text: 'What is the process to terminate my lease early?', expectedKind: 'exploratory' },
  { text: 'How do I terminate my lease?', expectedKind: 'exploratory' },
  { text: 'Thinking about moving out — what is the process?', expectedKind: 'exploratory' },
  { text: 'I am considering moving out, can you advise?', expectedKind: 'exploratory' },
  { text: 'What is the process for ending lease early?', expectedKind: 'exploratory' },
  { text: 'Naomba kujua utaratibu wa kumaliza mkataba', expectedKind: 'exploratory' },
  { text: 'Utaratibu wa kumaliza mkataba ni upi?', expectedKind: 'exploratory' },
  { text: 'How do I terminate without losing my deposit?', expectedKind: 'exploratory' },
  { text: 'What is the process for early termination?', expectedKind: 'exploratory' },
  { text: 'I am considering moving, just exploring', expectedKind: 'exploratory' },

  // SILENT — 8 (no termination tokens)
  { text: 'Hi just saying hello', expectedKind: 'silent' },
  { text: 'When is the next maintenance day?', expectedKind: 'silent' },
  { text: 'Habari, ninataka kujua kuhusu malipo', expectedKind: 'silent' },
  { text: 'Can I have a longer parking permit?', expectedKind: 'silent' },
  { text: 'The wifi was down yesterday', expectedKind: 'silent' },
  { text: 'Asante kwa huduma nzuri', expectedKind: 'silent' },
  { text: 'Just letting you know I will be travelling', expectedKind: 'silent' },
  { text: 'Hi there, hope you are well', expectedKind: 'silent' },
];

describe('classifyTerminationRequest — accuracy harness', () => {
  it('classifies at least 85% of holdout correctly', () => {
    let hits = 0;
    const misses: Array<{ text: string; expected: TerminationKind; got: TerminationKind }> = [];
    for (const c of CASES) {
      const r = classifyTerminationRequest(c.text);
      if (r.kind === c.expectedKind) {
        hits += 1;
      } else {
        misses.push({ text: c.text, expected: c.expectedKind, got: r.kind });
      }
    }
    const accuracy = hits / CASES.length;
    if (accuracy < 0.85) console.error('Termination misses:', misses);
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('extracts a notice date when present', () => {
    const r = classifyTerminationRequest('I will move out on 2026-07-31');
    expect(r.noticeRequestedDate).toBeDefined();
  });

  it('Swahili language detected', () => {
    const r = classifyTerminationRequest('Natoa taarifa rasmi ya kuondoka tarehe 30');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });
});
