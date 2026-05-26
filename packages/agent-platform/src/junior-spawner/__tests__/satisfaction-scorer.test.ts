/**
 * satisfaction-scorer.test.ts — Wave 18V-DYNAMIC.
 *
 * Asserts:
 *   - explicit score in row overrides feedback-kind table
 *   - per-kind fallback returns canonical 0..1
 *   - rolling average over empty input returns null
 *   - rollingSatisfactionLastN windows out old rows
 *   - clamp keeps scores in [0, 1]
 */

import { describe, expect, it } from 'vitest';
import {
  rollingSatisfaction,
  rollingSatisfactionLastN,
  scoreFeedbackRow,
} from '../satisfaction/satisfaction-scorer.js';
import type { JuniorTurnFeedbackRecord } from '../types.js';

function makeRow(
  overrides: Partial<JuniorTurnFeedbackRecord>,
): JuniorTurnFeedbackRecord {
  return {
    id: 'fb-1',
    junior_id: 'j-1',
    tenant_id: 't-1',
    turn_id: 'turn-1',
    satisfaction_score: null,
    feedback_kind: 'explicit_positive',
    recorded_at: new Date('2026-05-01'),
    ...overrides,
  };
}

describe('scoreFeedbackRow', () => {
  it('uses explicit score when present', () => {
    expect(scoreFeedbackRow(makeRow({ satisfaction_score: 0.42 }))).toBe(0.42);
  });

  it('falls back to kind map: explicit_positive → 1.0', () => {
    expect(scoreFeedbackRow(makeRow({ feedback_kind: 'explicit_positive' }))).toBe(1.0);
  });

  it('falls back to kind map: explicit_negative → 0.0', () => {
    expect(scoreFeedbackRow(makeRow({ feedback_kind: 'explicit_negative' }))).toBe(0.0);
  });

  it('falls back to kind map: implicit_completed → 0.7', () => {
    expect(scoreFeedbackRow(makeRow({ feedback_kind: 'implicit_completed' }))).toBe(0.7);
  });

  it('falls back to kind map: implicit_abandoned → 0.2', () => {
    expect(scoreFeedbackRow(makeRow({ feedback_kind: 'implicit_abandoned' }))).toBe(0.2);
  });

  it('clamps explicit scores below 0 to 0', () => {
    expect(scoreFeedbackRow(makeRow({ satisfaction_score: -1 }))).toBe(0);
  });

  it('clamps explicit scores above 1 to 1', () => {
    expect(scoreFeedbackRow(makeRow({ satisfaction_score: 2 }))).toBe(1);
  });
});

describe('rollingSatisfaction', () => {
  it('returns null on empty input', () => {
    expect(rollingSatisfaction([])).toBeNull();
  });

  it('averages multiple rows', () => {
    const rows = [
      makeRow({ feedback_kind: 'explicit_positive' }), // 1.0
      makeRow({ feedback_kind: 'explicit_negative' }), // 0.0
    ];
    expect(rollingSatisfaction(rows)).toBeCloseTo(0.5, 5);
  });
});

describe('rollingSatisfactionLastN', () => {
  it('windows out rows older than N days', () => {
    const now = new Date('2026-05-15');
    const inside = makeRow({
      feedback_kind: 'explicit_positive',
      recorded_at: new Date('2026-05-10'),
    });
    const outside = makeRow({
      feedback_kind: 'explicit_negative',
      recorded_at: new Date('2026-04-01'),
    });
    expect(rollingSatisfactionLastN([inside, outside], 14, now)).toBe(1.0);
  });

  it('returns null when no rows in window', () => {
    const now = new Date('2026-05-15');
    const ancient = makeRow({ recorded_at: new Date('2020-01-01') });
    expect(rollingSatisfactionLastN([ancient], 14, now)).toBeNull();
  });
});
