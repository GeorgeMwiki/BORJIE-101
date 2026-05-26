import { describe, expect, it } from 'vitest';
import { computeRecipeMetrics } from '../aggregator/metric-computer.js';
import type { TelemetryEvent } from '../types.js';

const ISO_START = '2026-05-01T00:00:00.000Z';
const ISO_END = '2026-05-15T00:00:00.000Z';

function event(over: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    id: 'e-' + (over.id ?? Math.random().toString(36).slice(2, 8)),
    tenantId: over.tenantId ?? 't1',
    tabRecipeId: over.tabRecipeId ?? 'buyer_kyb_start',
    tabRecipeVersion: over.tabRecipeVersion ?? 1,
    sessionId: over.sessionId ?? null,
    fieldId: over.fieldId ?? null,
    eventKind: over.eventKind ?? 'focus',
    recordedAt: over.recordedAt ?? '2026-05-10T12:00:00.000Z',
  };
}

describe('computeRecipeMetrics', () => {
  it('returns zero metrics for empty event list', () => {
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events: [],
    });
    expect(m.renderCount).toBe(0);
    expect(m.submitCount).toBe(0);
    expect(m.completionRate).toBe(0);
    expect(m.errorRate).toBe(0);
    expect(m.maxFieldAbandonmentRate).toBe(0);
    expect(m.fields).toEqual([]);
  });

  it('counts render + submit events to compute completion rate', () => {
    const events = [
      event({ eventKind: 'render' }),
      event({ eventKind: 'render' }),
      event({ eventKind: 'render' }),
      event({ eventKind: 'render' }),
      event({ eventKind: 'submit', sessionId: 's1' }),
      event({ eventKind: 'submit', sessionId: 's2' }),
      event({ eventKind: 'submit', sessionId: 's3' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    expect(m.renderCount).toBe(4);
    expect(m.submitCount).toBe(3);
    expect(m.completionRate).toBeCloseTo(0.75, 3);
  });

  it('computes per-field error rate', () => {
    const events = [
      event({ fieldId: 'tin_number', eventKind: 'focus' }),
      event({ fieldId: 'tin_number', eventKind: 'focus' }),
      event({ fieldId: 'tin_number', eventKind: 'focus' }),
      event({ fieldId: 'tin_number', eventKind: 'focus' }),
      event({ fieldId: 'tin_number', eventKind: 'error' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    const tin = m.fields.find((f) => f.fieldId === 'tin_number');
    expect(tin).toBeDefined();
    expect(tin?.errorRate).toBeCloseTo(0.25, 3);
  });

  it('counts blur-without-submit as abandonment per session', () => {
    const events = [
      // session s1: blurs the field but never submits
      event({ sessionId: 's1', fieldId: 'tin_number', eventKind: 'focus' }),
      event({ sessionId: 's1', fieldId: 'tin_number', eventKind: 'blur' }),
      // session s2: blurs the field then submits
      event({ sessionId: 's2', fieldId: 'tin_number', eventKind: 'focus' }),
      event({ sessionId: 's2', fieldId: 'tin_number', eventKind: 'blur' }),
      event({ sessionId: 's2', eventKind: 'submit' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    const tin = m.fields.find((f) => f.fieldId === 'tin_number');
    expect(tin?.blurWithoutSubmitCount).toBe(1);
    expect(tin?.abandonmentRate).toBeCloseTo(0.5, 3);
  });

  it('computes tooltip-hit rate per field', () => {
    const events = [
      event({ fieldId: 'gold_grade', eventKind: 'focus' }),
      event({ fieldId: 'gold_grade', eventKind: 'focus' }),
      event({ fieldId: 'gold_grade', eventKind: 'tooltip_hit' }),
      event({ fieldId: 'gold_grade', eventKind: 'tooltip_hit' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    const f = m.fields.find((x) => x.fieldId === 'gold_grade');
    expect(f?.tooltipHitRate).toBeCloseTo(1.0, 3);
  });

  it('ignores events from other recipes / versions', () => {
    const events = [
      event({ tabRecipeId: 'buyer_kyb_start', tabRecipeVersion: 1, eventKind: 'render' }),
      event({ tabRecipeId: 'OTHER', tabRecipeVersion: 1, eventKind: 'render' }),
      event({ tabRecipeId: 'buyer_kyb_start', tabRecipeVersion: 2, eventKind: 'render' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    expect(m.renderCount).toBe(1);
  });

  it('produces stable sorted field order', () => {
    const events = [
      event({ fieldId: 'z_field', eventKind: 'focus' }),
      event({ fieldId: 'a_field', eventKind: 'focus' }),
      event({ fieldId: 'm_field', eventKind: 'focus' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    expect(m.fields.map((f) => f.fieldId)).toEqual([
      'a_field',
      'm_field',
      'z_field',
    ]);
  });

  it('uses max abandonment across fields', () => {
    const events = [
      event({ sessionId: 's1', fieldId: 'a', eventKind: 'focus' }),
      event({ sessionId: 's1', fieldId: 'a', eventKind: 'blur' }),
      event({ sessionId: 's1', fieldId: 'b', eventKind: 'focus' }),
      event({ sessionId: 's1', fieldId: 'b', eventKind: 'blur' }),
      event({ sessionId: 's2', fieldId: 'b', eventKind: 'focus' }),
      event({ sessionId: 's2', fieldId: 'b', eventKind: 'blur' }),
      event({ sessionId: 's2', eventKind: 'submit' }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    // field a: 1 focus, 1 blur, never submitted from s1 → 1.0
    // field b: 2 focuses, 2 blurs but s2 submitted → only 1/2 = 0.5
    expect(m.maxFieldAbandonmentRate).toBeCloseTo(1.0, 3);
  });

  it('treats missing-sessionId blurs as abandonment (worst-case)', () => {
    const events = [
      event({ fieldId: 'x', eventKind: 'focus', sessionId: null }),
      event({ fieldId: 'x', eventKind: 'blur', sessionId: null }),
    ];
    const m = computeRecipeMetrics({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      windowStartIso: ISO_START,
      windowEndIso: ISO_END,
      events,
    });
    const f = m.fields.find((x) => x.fieldId === 'x');
    expect(f?.blurWithoutSubmitCount).toBe(1);
  });
});
