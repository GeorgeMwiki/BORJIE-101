import { describe, expect, it } from 'vitest';
import { classifyInquiry } from '../tools/classify-inquiry.js';
import { fetchUnitMatch, type UnitRecord } from '../tools/fetch-unit-match.js';
import { draftResponse } from '../tools/draft-response.js';
import { scheduleViewingDraft } from '../tools/schedule-viewing-draft.js';

const UNITS: ReadonlyArray<UnitRecord> = [
  { id: 'u1', propertyId: 'p1', block: 'A', unitLabel: '4B', bedrooms: 2, neighborhood: 'Kilimani', rentMinor: 7500000, currency: 'KES', available: true, availableFromMs: 0 },
  { id: 'u2', propertyId: 'p1', block: 'A', unitLabel: '5C', bedrooms: 1, neighborhood: 'Kilimani', rentMinor: 4500000, currency: 'KES', available: true, availableFromMs: 0 },
  { id: 'u3', propertyId: 'p2', block: 'B', unitLabel: '1A', bedrooms: 3, neighborhood: 'Westlands', rentMinor: 12000000, currency: 'KES', available: false, availableFromMs: 0 },
  { id: 'u4', propertyId: 'p1', block: 'A', unitLabel: '6A', bedrooms: 2, neighborhood: 'Kilimani', rentMinor: 9000000, currency: 'KES', available: true, availableFromMs: 0 },
];

describe('fetchUnitMatch', () => {
  it('finds available matching units by bedrooms', () => {
    const r = fetchUnitMatch({ units: UNITS, bedrooms: 2 });
    expect(r.matches.length).toBe(2);
    expect(r.matches.every(m => m.unit.available)).toBe(true);
  });

  it('filters out unavailable units', () => {
    const r = fetchUnitMatch({ units: UNITS, bedrooms: 3 });
    expect(r.matches.find(m => m.unit.id === 'u3')).toBeUndefined();
  });

  it('drops over-budget units beyond 10% tolerance', () => {
    const r = fetchUnitMatch({ units: UNITS, bedrooms: 2, maxBudgetMinor: 5000000 });
    expect(r.matches.length).toBe(0);
  });

  it('returns a price band when matches exist', () => {
    const r = fetchUnitMatch({ units: UNITS, bedrooms: 2 });
    expect(r.priceBand).toBeDefined();
    expect(r.priceBand?.currency).toBe('KES');
  });
});

describe('draftResponse', () => {
  it('returns a draft (never auto-sends)', () => {
    const inquiry = classifyInquiry('Looking for a 2BR in Kilimani, budget 80000');
    const matches = fetchUnitMatch({ units: UNITS, bedrooms: 2 });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.draftStatus).toBe('queued-for-owner-review');
    expect(d.body.length).toBeGreaterThan(0);
  });

  it('uses apologetic tone when no match', () => {
    const inquiry = classifyInquiry('Looking for a 5BR penthouse');
    const matches = fetchUnitMatch({ units: UNITS, bedrooms: 5 });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.toneTag).toBe('apologetic-no-match');
    expect(d.suggestedNextStep).toBe('no-match');
  });

  it('cites a price band, not a point price', () => {
    const inquiry = classifyInquiry('How much for a 2BR?');
    const matches = fetchUnitMatch({ units: UNITS, bedrooms: 2 });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.body).toMatch(/KES \d+.+KES \d+/);
  });

  it('responds in Swahili when prospect writes in Swahili', () => {
    const inquiry = classifyInquiry('Naomba kuja kuangalia nyumba kesho tafadhali');
    const matches = fetchUnitMatch({ units: UNITS, bedrooms: 2 });
    const d = draftResponse({ inquiry, matches, ownerSignature: 'Asha' });
    expect(d.language === 'sw' || d.language === 'mixed').toBe(true);
  });
});

describe('scheduleViewingDraft', () => {
  it('proposes up to 3 free slots within window', () => {
    const now = 0;
    const slots = [
      { startMs: now + 36 * 3600 * 1000, endMs: now + 37 * 3600 * 1000, free: true },
      { startMs: now + 60 * 3600 * 1000, endMs: now + 61 * 3600 * 1000, free: true },
      { startMs: now + 84 * 3600 * 1000, endMs: now + 85 * 3600 * 1000, free: true },
      { startMs: now + 108 * 3600 * 1000, endMs: now + 109 * 3600 * 1000, free: true },
    ];
    const r = scheduleViewingDraft({
      slots,
      nowMs: now,
      unitId: 'u1',
      prospectName: 'Pamela',
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
    const r = scheduleViewingDraft({ slots, nowMs: now, unitId: 'u1', prospectName: 'P', language: 'en' });
    expect(r.proposals.length).toBe(0);
  });

  it('renders Swahili message when prospect speaks Swahili', () => {
    const now = 0;
    const slots = [
      { startMs: now + 36 * 3600 * 1000, endMs: now + 37 * 3600 * 1000, free: true },
    ];
    const r = scheduleViewingDraft({ slots, nowMs: now, unitId: 'u1', prospectName: 'Asha', language: 'sw' });
    expect(r.prospectMessage).toContain('Habari');
  });
});
