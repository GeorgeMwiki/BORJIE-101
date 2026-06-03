/**
 * Belief-store pure helper tests + in-memory adapter behaviour.
 */

import { describe, it, expect } from 'vitest';

import {
  makeSubjectKey,
  computeConfidence,
  clamp01,
  createInMemoryBeliefStore,
} from '../belief-store.js';
import type { Belief, BeliefSource } from '../types.js';

describe('makeSubjectKey', () => {
  it('canonicalises parts into a lowercase-dashed key', () => {
    expect(makeSubjectKey(['Mwanza', 'Gold', 'Ore', 'Grade'])).toBe(
      'mwanza-gold-ore-grade',
    );
  });

  it('strips diacritics + punctuation', () => {
    expect(makeSubjectKey(['Café', "d'Or!"])).toBe('cafe-d-or');
  });

  it('drops empty parts', () => {
    expect(makeSubjectKey(['', 'gold', '   '])).toBe('gold');
  });
});

describe('computeConfidence', () => {
  it('returns 0.1 for an empty source list', () => {
    expect(computeConfidence([])).toBe(0.1);
  });

  it('lets a high-authority regulator doc pull a mixed average above a lone user claim', () => {
    // A single source normalises the kind-weight out (weighted avg of one
    // term = its authority), so the kind-weight only bites when sources are
    // MIXED. Verify the mixing behaviour: adding a strong regulator doc to a
    // user claim raises the aggregate above the user claim alone.
    const reg: BeliefSource = {
      kind: 'regulator-doc',
      authority: 0.95,
      capturedAt: 'x',
    };
    const user: BeliefSource = {
      kind: 'user-claim',
      authority: 0.4,
      capturedAt: 'x',
    };
    expect(computeConfidence([reg, user])).toBeGreaterThan(
      computeConfidence([user]),
    );
  });

  it('caps confidence at 0.99', () => {
    const sources: BeliefSource[] = Array.from({ length: 5 }, () => ({
      kind: 'regulator-doc' as const,
      authority: 1,
      capturedAt: 'x',
    }));
    expect(computeConfidence(sources)).toBeLessThanOrEqual(0.99);
  });
});

describe('clamp01', () => {
  it('clamps to [0,1] and handles non-finite', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(NaN)).toBe(0);
  });
});

describe('in-memory belief store', () => {
  const belief: Belief = {
    id: '',
    domain: 'regulatory',
    subject: 's',
    description: 'd',
    value: { kind: 'scalar', scalar: 1 },
    confidence: 0.5,
    sources: [],
    revisedAt: '2026-06-01T00:00:00.000Z',
    revisionCount: 0,
    tags: [],
    subjectUserId: null,
    subjectOrgId: null,
  };

  it('mints an id on upsert when none is supplied', async () => {
    const store = createInMemoryBeliefStore();
    const out = await store.upsert(belief);
    expect(out.id).toBeTruthy();
  });

  it('round-trips by subject + scope', async () => {
    const store = createInMemoryBeliefStore();
    await store.upsert({ ...belief, subjectUserId: 'u1' });
    const found = await store.findBySubject('s', { subjectUserId: 'u1' });
    expect(found?.subjectUserId).toBe('u1');
    // A different scope misses.
    expect(await store.findBySubject('s', { subjectUserId: 'u2' })).toBeNull();
  });

  it('lists by domain filtered by scope, newest first', async () => {
    const store = createInMemoryBeliefStore();
    await store.upsert({
      ...belief,
      subject: 'a',
      revisedAt: '2026-06-01T00:00:00.000Z',
    });
    await store.upsert({
      ...belief,
      subject: 'b',
      revisedAt: '2026-06-02T00:00:00.000Z',
    });
    const list = await store.listByDomain('regulatory');
    expect(list[0].subject).toBe('b'); // newest first
    expect(list.length).toBe(2);
  });
});
