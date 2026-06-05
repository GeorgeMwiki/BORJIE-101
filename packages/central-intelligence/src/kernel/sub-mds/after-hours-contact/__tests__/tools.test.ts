import { describe, expect, it } from 'vitest';
import { classifyInquiry } from '../tools/classify-inquiry.js';
import { fetchLotMatch, type LotRecord } from '../tools/fetch-lot-match.js';
import { draftResponse } from '../tools/draft-response.js';
import { scheduleInspectionDraft } from '../tools/schedule-inspection-draft.js';

const LOTS: ReadonlyArray<LotRecord> = [
  { id: 'l1', siteId: 's1', lotRef: 'GEI-4B', mineral: 'gold', grade: '22ct', quantityKg: 2, region: 'Geita', priceMinor: 7500000, currency: 'TZS', available: true, availableFromMs: 0 },
  { id: 'l2', siteId: 's1', lotRef: 'GEI-5C', mineral: 'gold', grade: '18ct', quantityKg: 1, region: 'Geita', priceMinor: 4500000, currency: 'TZS', available: true, availableFromMs: 0 },
  { id: 'l3', siteId: 's2', lotRef: 'MER-1A', mineral: 'tanzanite', grade: 'AA', quantityKg: 3, region: 'Mererani', priceMinor: 12000000, currency: 'TZS', available: false, availableFromMs: 0 },
  { id: 'l4', siteId: 's1', lotRef: 'GEI-6A', mineral: 'gold', grade: '24ct', quantityKg: 2, region: 'Geita', priceMinor: 9000000, currency: 'TZS', available: true, availableFromMs: 0 },
];

describe('fetchLotMatch', () => {
  it('finds available matching lots by mineral', () => {
    const r = fetchLotMatch({ lots: LOTS, mineral: 'gold' });
    expect(r.matches.length).toBe(3);
    expect(r.matches.every(m => m.lot.available)).toBe(true);
  });

  it('filters out unavailable lots', () => {
    const r = fetchLotMatch({ lots: LOTS, mineral: 'tanzanite' });
    expect(r.matches.find(m => m.lot.id === 'l3')).toBeUndefined();
  });

  it('drops over-budget lots beyond 10% tolerance', () => {
    const r = fetchLotMatch({ lots: LOTS, mineral: 'gold', maxBudgetMinor: 4000000 });
    expect(r.matches.length).toBe(0);
  });

  it('returns a price band when matches exist', () => {
    const r = fetchLotMatch({ lots: LOTS, mineral: 'gold' });
    expect(r.priceBand).toBeDefined();
    expect(r.priceBand?.currency).toBe('TZS');
  });
});

describe('draftResponse', () => {
  it('returns a draft (never auto-sends)', () => {
    const inquiry = classifyInquiry('Looking for a gold parcel in Geita, budget 80000');
    const matches = fetchLotMatch({ lots: LOTS, mineral: 'gold' });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.draftStatus).toBe('queued-for-owner-review');
    expect(d.body.length).toBeGreaterThan(0);
  });

  it('uses apologetic tone when no match', () => {
    const inquiry = classifyInquiry('Looking for a platinum parcel');
    const matches = fetchLotMatch({ lots: LOTS, mineral: 'platinum' });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.toneTag).toBe('apologetic-no-match');
    expect(d.suggestedNextStep).toBe('no-match');
  });

  it('cites a price band, not a point price', () => {
    const inquiry = classifyInquiry('How much for a gold parcel?');
    const matches = fetchLotMatch({ lots: LOTS, mineral: 'gold' });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.body).toMatch(/TZS \d+.+TZS \d+/);
  });

  it('responds in Swahili when buyer writes in Swahili', () => {
    const inquiry = classifyInquiry('Naomba kuja kukagua madini kesho tafadhali');
    const matches = fetchLotMatch({ lots: LOTS, mineral: 'gold' });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.language === 'sw' || d.language === 'mixed').toBe(true);
  });
});

describe('scheduleInspectionDraft', () => {
  it('proposes up to 3 free slots within window', () => {
    const now = 0;
    const slots = [
      { startMs: now + 36 * 3600 * 1000, endMs: now + 37 * 3600 * 1000, free: true },
      { startMs: now + 60 * 3600 * 1000, endMs: now + 61 * 3600 * 1000, free: true },
      { startMs: now + 84 * 3600 * 1000, endMs: now + 85 * 3600 * 1000, free: true },
      { startMs: now + 108 * 3600 * 1000, endMs: now + 109 * 3600 * 1000, free: true },
    ];
    const r = scheduleInspectionDraft({
      slots,
      nowMs: now,
      lotId: 'l1',
      buyerName: 'Pamela',
      language: 'en',
    });
    expect(r.proposals.length).toBe(3);
    expect(r.draftStatus).toBe('queued-for-owner-review');
  });

  it('refuses slots inside the 24h lead window', () => {
    const now = 0;
    const slots = [
      { startMs: now + 2 * 3600 * 1000, endMs: now + 3 * 3600 * 1000, free: true },
    ];
    const r = scheduleInspectionDraft({ slots, nowMs: now, lotId: 'l1', buyerName: 'P', language: 'en' });
    expect(r.proposals.length).toBe(0);
  });

  it('renders Swahili message when buyer speaks Swahili', () => {
    const now = 0;
    const slots = [
      { startMs: now + 36 * 3600 * 1000, endMs: now + 37 * 3600 * 1000, free: true },
    ];
    const r = scheduleInspectionDraft({ slots, nowMs: now, lotId: 'l1', buyerName: 'Asha', language: 'sw' });
    expect(r.buyerMessage).toContain('Habari');
  });
});
