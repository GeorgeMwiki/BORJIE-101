import { describe, expect, it } from 'vitest';
import { classifyInquiry, type InquiryIntent } from '../tools/classify-inquiry.js';

interface Case {
  readonly text: string;
  readonly expectedIntent: InquiryIntent;
  readonly note?: string;
}

const CASES: ReadonlyArray<Case> = [
  // INSPECTION-REQUEST — 10
  { text: 'Can I come see the lot tomorrow morning?', expectedIntent: 'inspection-request' },
  { text: 'I want to arrange an inspection for the gold parcel in Geita', expectedIntent: 'inspection-request' },
  { text: 'Naomba kuja kukagua madini kesho', expectedIntent: 'inspection-request' },
  { text: 'When can I see the parcel in person?', expectedIntent: 'inspection-request' },
  { text: 'I would like to book an inspection this weekend', expectedIntent: 'inspection-request' },
  { text: 'Ninaomba kukagua mzigo siku ya Jumamosi', expectedIntent: 'inspection-request' },
  { text: 'Can we schedule an inspection for Saturday at 2pm?', expectedIntent: 'inspection-request' },
  { text: 'Naomba kuja kuangalia madini leo jioni', expectedIntent: 'inspection-request' },
  { text: 'I want to come over to see the consignment', expectedIntent: 'inspection-request' },
  { text: 'Site visit possible tomorrow to assay the lot?', expectedIntent: 'inspection-request' },

  // PRICING — 10
  { text: 'How much is the lot?', expectedIntent: 'pricing' },
  { text: 'What is the price per gram for the gold?', expectedIntent: 'pricing' },
  { text: 'Bei ni pesa ngapi kwa kilo?', expectedIntent: 'pricing' },
  { text: 'Bei ni shilingi ngapi?', expectedIntent: 'pricing' },
  { text: 'How much does the parcel go for? what is the cost', expectedIntent: 'pricing' },
  { text: 'Gharama za mzigo wa dhahabu?', expectedIntent: 'pricing' },
  { text: 'Price per kg for the consignment please', expectedIntent: 'pricing' },
  { text: 'I would like to know the rate per gram', expectedIntent: 'pricing' },
  { text: 'What price are you asking right now? rate per kg?', expectedIntent: 'pricing' },
  { text: 'Bei ni kiasi gani, pesa ngapi kwa lot hii?', expectedIntent: 'pricing' },

  // AVAILABILITY — 10
  { text: 'Is the parcel still available?', expectedIntent: 'availability' },
  { text: 'Iko bado ile dhahabu?', expectedIntent: 'availability' },
  { text: 'When will it be ready for collection?', expectedIntent: 'availability' },
  { text: 'Inapatikana lini mzigo huo?', expectedIntent: 'availability' },
  { text: 'When can I collect that lot?', expectedIntent: 'availability' },
  { text: 'Still in stock? Or already sold?', expectedIntent: 'availability' },
  { text: 'Is the listing available now?', expectedIntent: 'availability' },
  { text: 'Ipo bado mzigo wa block B?', expectedIntent: 'availability' },
  { text: 'When will it be ready, the tanzanite in Block C?', expectedIntent: 'availability' },
  { text: 'Collection date for the high-grade parcel?', expectedIntent: 'availability' },

  // LOT-SEARCH — 12
  { text: 'I am looking for a gold parcel in Geita', expectedIntent: 'lot-search' },
  { text: 'Do you have any tanzanite lots near Mererani?', expectedIntent: 'lot-search' },
  { text: 'I want to buy a 3 kg parcel, budget 80000', expectedIntent: 'lot-search' },
  { text: 'Searching for a consignment around Shinyanga', expectedIntent: 'lot-search' },
  { text: 'Nahitaji madini ya dhahabu Kahama', expectedIntent: 'lot-search' },
  { text: 'Natafuta madini karibu na Mwanza', expectedIntent: 'lot-search' },
  { text: 'Unayo dhahabu ya kiwango cha juu?', expectedIntent: 'lot-search' },
  { text: 'Mna madini ya shaba katika site A?', expectedIntent: 'lot-search' },
  { text: 'Any lots in your inventory right now?', expectedIntent: 'lot-search' },
  { text: 'I want to buy a parcel within 30 days', expectedIntent: 'lot-search' },
  { text: 'Is there a small lot I can buy near the mine?', expectedIntent: 'lot-search' },
  { text: 'Do you have available lots this month?', expectedIntent: 'lot-search' },

  // GENERAL — 8
  { text: 'Hi, do you handle export paperwork?', expectedIntent: 'general' },
  { text: 'Are assay certificates included?', expectedIntent: 'general' },
  { text: 'Mna usafiri wa mzigo?', expectedIntent: 'general' },
  { text: 'Is there secure storage on site?', expectedIntent: 'general' },
  { text: 'What documents do I need to submit?', expectedIntent: 'general' },
  { text: 'Do you accept M-Pesa?', expectedIntent: 'general' },
  { text: 'Ina ulinzi wa saa 24?', expectedIntent: 'general' },
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
    const r = classifyInquiry('Naomba kuja kukagua madini kesho asubuhi tafadhali');
    expect(r.detectedLanguage === 'sw' || r.detectedLanguage === 'mixed').toBe(true);
  });

  it('extracts quantity and budget when present', () => {
    const r = classifyInquiry('I am looking for a 3 kg gold parcel, budget 80000');
    expect(r.features.quantityKg).toBe(3);
    expect(r.features.budgetMinor).toBeGreaterThan(0);
  });

  it('returns general intent for unclassifiable text', () => {
    const r = classifyInquiry('Hi there');
    expect(r.intent).toBe('general');
  });
});
