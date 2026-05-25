import { describe, expect, it } from 'vitest';
import { classifyInquiry, type InquiryIntent } from '../tools/classify-inquiry.js';

interface Case {
  readonly text: string;
  readonly expectedIntent: InquiryIntent;
  readonly note?: string;
}

const CASES: ReadonlyArray<Case> = [
  // VIEWING-REQUEST — 10
  { text: 'Can I come see the unit tomorrow morning?', expectedIntent: 'viewing-request' },
  { text: 'I want to arrange a viewing for the 2BR in Kilimani', expectedIntent: 'viewing-request' },
  { text: 'Naomba kuja kuangalia nyumba kesho', expectedIntent: 'viewing-request' },
  { text: 'When can I see the apartment in person?', expectedIntent: 'viewing-request' },
  { text: 'I would like to book a viewing this weekend', expectedIntent: 'viewing-request' },
  { text: 'Ninaomba kuangalia chumba siku ya Jumamosi', expectedIntent: 'viewing-request' },
  { text: 'Can we schedule a viewing for Saturday at 2pm?', expectedIntent: 'viewing-request' },
  { text: 'Naomba kuja kuona nyumba leo jioni', expectedIntent: 'viewing-request' },
  { text: 'I want to come over to see the place', expectedIntent: 'viewing-request' },
  { text: 'Site visit possible tomorrow?', expectedIntent: 'viewing-request' },

  // PRICING — 10
  { text: 'How much is the monthly rent?', expectedIntent: 'pricing' },
  { text: 'What is the cost per month for the 1BR?', expectedIntent: 'pricing' },
  { text: 'Kodi ni pesa ngapi kwa mwezi?', expectedIntent: 'pricing' },
  { text: 'Bei ni shilingi ngapi?', expectedIntent: 'pricing' },
  { text: 'How much does the unit go for?', expectedIntent: 'pricing' },
  { text: 'Gharama za nyumba ya vyumba viwili?', expectedIntent: 'pricing' },
  { text: 'Monthly rent for the apartment please', expectedIntent: 'pricing' },
  { text: 'I would like to know the rate per month', expectedIntent: 'pricing' },
  { text: 'What rent are you charging right now?', expectedIntent: 'pricing' },
  { text: 'Bei ni kiasi gani kwa unit hii?', expectedIntent: 'pricing' },

  // AVAILABILITY — 10
  { text: 'Is the apartment still available?', expectedIntent: 'availability' },
  { text: 'Iko bado nyumba ile?', expectedIntent: 'availability' },
  { text: 'When will it be ready for move-in?', expectedIntent: 'availability' },
  { text: 'Inapatikana lini chumba hicho?', expectedIntent: 'availability' },
  { text: 'When can I move in to that unit?', expectedIntent: 'availability' },
  { text: 'Still vacant? Or already rented?', expectedIntent: 'availability' },
  { text: 'Is the listing still available now?', expectedIntent: 'availability' },
  { text: 'Iko vacant bado nyumba ya block B?', expectedIntent: 'availability' },
  { text: 'When will the 2BR in Block C be available?', expectedIntent: 'availability' },
  { text: 'Move-in date for the master en-suite?', expectedIntent: 'availability' },

  // VACANCY-CHECK — 12
  { text: 'I am looking for a 2-bedroom apartment in Kilimani', expectedIntent: 'vacancy-check' },
  { text: 'Do you have any 1BR units near Westlands?', expectedIntent: 'vacancy-check' },
  { text: 'I need a 3-bedroom house, budget 80000', expectedIntent: 'vacancy-check' },
  { text: 'Searching for an apartment around Kileleshwa', expectedIntent: 'vacancy-check' },
  { text: 'Nahitaji nyumba ya vyumba viwili Kinondoni', expectedIntent: 'vacancy-check' },
  { text: 'Natafuta nyumba ndogo karibu na Mlimani', expectedIntent: 'vacancy-check' },
  { text: 'Unayo nyumba ya bedroom moja?', expectedIntent: 'vacancy-check' },
  { text: 'Mna chumba kimoja katika block A?', expectedIntent: 'vacancy-check' },
  { text: 'Any vacancies in your portfolio right now?', expectedIntent: 'vacancy-check' },
  { text: 'I want to rent an apartment within 30 days', expectedIntent: 'vacancy-check' },
  { text: 'Is there a studio I can rent near downtown?', expectedIntent: 'vacancy-check' },
  { text: 'I need an apartment urgently this month', expectedIntent: 'vacancy-check' },

  // GENERAL — 8
  { text: 'Hi, do you handle pets?', expectedIntent: 'general' },
  { text: 'Are utilities included in the rent?', expectedIntent: 'general' },
  { text: 'Mna parking ya magari?', expectedIntent: 'general' },
  { text: 'Is there a swimming pool on site?', expectedIntent: 'general' },
  { text: 'What documents do I need to submit?', expectedIntent: 'general' },
  { text: 'Do you accept M-Pesa?', expectedIntent: 'general' },
  { text: 'Ina security 24 saa?', expectedIntent: 'general' },
  { text: 'Hello, just exploring options', expectedIntent: 'general' },
];

describe('classifyInquiry — accuracy harness', () => {
  it('classifies at least 85% of holdout correctly', () => {
    let hits = 0;
    const misses: Array<{ text: string; expected: InquiryIntent; got: InquiryIntent }> = [];
    for (const c of CASES) {
      const r = classifyInquiry(c.text);
      if (r.intent === c.expectedIntent) {
        hits += 1;
      } else {
        misses.push({ text: c.text, expected: c.expectedIntent, got: r.intent });
      }
    }
    const accuracy = hits / CASES.length;
    if (accuracy < 0.85) {
      console.error('Holdout misses:', misses);
    }
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('detects Swahili on heavy-Swahili input', () => {
    const r = classifyInquiry('Naomba kuja kuangalia nyumba kesho asubuhi tafadhali');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });

  it('extracts bedroom and budget when present', () => {
    const r = classifyInquiry('I am looking for a 2-bedroom apartment, budget 80000');
    expect(r.features.bedrooms).toBe(2);
    expect(r.features.budgetMinor).toBeGreaterThan(0);
  });

  it('returns general intent for unclassifiable text', () => {
    const r = classifyInquiry('Hi there');
    expect(r.intent).toBe('general');
  });
});
