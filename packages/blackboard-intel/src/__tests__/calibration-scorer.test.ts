import { describe, it, expect } from 'vitest';
import { measureCalibration } from '../measure/calibration-scorer.js';
import type { BlackboardPostRef } from '../types.js';

function makePost(
  content: string,
  overrides: Partial<BlackboardPostRef> = {},
): BlackboardPostRef {
  return Object.freeze({
    id: 'p-1',
    tenantId: 't1',
    content,
    authorKind: 'junior' as const,
    citations: [] as ReadonlyArray<string>,
    postedAt: '2026-05-27T10:00:00.000Z',
    parentThreadId: null,
    hedgeMarkers: [] as ReadonlyArray<string>,
    contentEmbedding: null,
    ...overrides,
  });
}

describe('measureCalibration', () => {
  it('returns the neutral 0.5 when there are no follow-up posts', () => {
    const post = makePost('the crusher vibration is bearing fatigue');
    const result = measureCalibration({ post, followUps: [] });
    expect(result.score).toBe(0.5);
    expect(result.contradicted).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  it('detects "I think X" + contradicting follow-up — score 0.5', () => {
    const post = makePost(
      'I think the loader-7 fuel spike is bearing fatigue',
    );
    const followUp = makePost(
      'actually not — the harmonic analysis came back clean',
      { id: 'p-2' },
    );
    const result = measureCalibration({
      post,
      followUps: [followUp],
    });
    expect(result.score).toBe(0.5);
    expect(result.hedged).toBe(true);
    expect(result.contradicted).toBe(true);
  });

  it('penalises a confident contradicted claim more heavily (score 0)', () => {
    const post = makePost('the loader-7 fuel spike is bearing fatigue');
    const followUp = makePost(
      'this is not the case — the harmonic analysis came back clean',
      { id: 'p-2' },
    );
    const result = measureCalibration({
      post,
      followUps: [followUp],
    });
    expect(result.score).toBe(0);
    expect(result.hedged).toBe(false);
    expect(result.contradicted).toBe(true);
  });

  it('confident + confirmed → score 1', () => {
    const post = makePost('the loader-7 fuel spike is bearing fatigue');
    const followUp = makePost(
      'inspection confirmed it — bearing replaced',
      { id: 'p-2' },
    );
    const result = measureCalibration({
      post,
      followUps: [followUp],
    });
    expect(result.score).toBe(1);
    expect(result.contradicted).toBe(false);
  });

  it('hedged + confirmed → score 0.75 (slight under-commitment penalty)', () => {
    const post = makePost(
      'I think the loader-7 fuel spike is bearing fatigue',
    );
    const followUp = makePost('inspection confirmed it', { id: 'p-2' });
    const result = measureCalibration({
      post,
      followUps: [followUp],
    });
    expect(result.score).toBe(0.75);
    expect(result.hedged).toBe(true);
  });
});
