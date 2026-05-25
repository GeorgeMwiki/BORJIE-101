/**
 * Tests for signal-aggregator.ts — half-life decay, grouping, ordering.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateSignals,
  filterAboveThreshold,
} from '../signal-aggregator.js';
import type { SignalRow } from '../types.js';

function mkSignal(
  overrides: Partial<SignalRow> = {},
): SignalRow {
  return {
    id: 'sig-1',
    tenantId: 'tnt-1',
    userId: 'usr-1',
    signalKind: 'conversation_intent',
    signalPayload: {},
    suggestedModuleTemplateId: 'COMPLIANCE',
    weight: 1.0,
    createdAt: new Date('2026-05-15T00:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-05-22T00:00:00Z');

describe('aggregateSignals', () => {
  it('returns empty for no signals', () => {
    const out = aggregateSignals([], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toEqual([]);
  });

  it('skips signals with null suggested module', () => {
    const sig = mkSignal({ suggestedModuleTemplateId: null });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toEqual([]);
  });

  it('aggregates a single signal', () => {
    const sig = mkSignal({ createdAt: NOW });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.userId).toBe('usr-1');
    expect(out[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    // Today's signal contributes full weight.
    expect(out[0]?.score).toBe(1);
  });

  it('applies half-life decay correctly', () => {
    // Signal 7 days old with half-life 7 days should contribute exactly half.
    const sig = mkSignal({
      weight: 2.0,
      createdAt: new Date('2026-05-15T00:00:00Z'),
    });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toHaveLength(1);
    // 2 * 2^(-7/7) = 2 * 0.5 = 1.0
    expect(out[0]?.score).toBe(1);
  });

  it('groups signals by (user, module)', () => {
    const sigs = [
      mkSignal({ id: 's1', userId: 'usr-a', suggestedModuleTemplateId: 'COMPLIANCE', createdAt: NOW }),
      mkSignal({ id: 's2', userId: 'usr-a', suggestedModuleTemplateId: 'COMPLIANCE', createdAt: NOW }),
      mkSignal({ id: 's3', userId: 'usr-a', suggestedModuleTemplateId: 'LEGAL', createdAt: NOW }),
      mkSignal({ id: 's4', userId: 'usr-b', suggestedModuleTemplateId: 'COMPLIANCE', createdAt: NOW }),
    ];
    const out = aggregateSignals(sigs, {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toHaveLength(3);

    const aCompliance = out.find(
      (e) => e.userId === 'usr-a' && e.suggestedModuleTemplateId === 'COMPLIANCE',
    );
    expect(aCompliance?.score).toBe(2);
    expect(aCompliance?.contributingSignalIds).toEqual(['s1', 's2']);
  });

  it('drops signals older than lookbackDays', () => {
    const sig = mkSignal({
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    // 2026-05-01 is 21 days before 2026-05-22; outside lookback.
    expect(out).toEqual([]);
  });

  it('clamps future-dated signals to zero age (no boost)', () => {
    const futureSig = mkSignal({
      createdAt: new Date('2026-06-01T00:00:00Z'),
      weight: 2.0,
    });
    const out = aggregateSignals([futureSig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(2);
  });

  it('drops signals with NaN created_at', () => {
    const bad = mkSignal({ createdAt: new Date(NaN) });
    const out = aggregateSignals([bad], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out).toEqual([]);
  });

  it('sorts by score desc, then userId asc, then module asc', () => {
    const sigs = [
      mkSignal({ id: 's1', userId: 'usr-b', suggestedModuleTemplateId: 'LEGAL', weight: 5, createdAt: NOW }),
      mkSignal({ id: 's2', userId: 'usr-a', suggestedModuleTemplateId: 'COMPLIANCE', weight: 1, createdAt: NOW }),
      mkSignal({ id: 's3', userId: 'usr-a', suggestedModuleTemplateId: 'LEGAL', weight: 1, createdAt: NOW }),
    ];
    const out = aggregateSignals(sigs, {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(out[0]?.userId).toBe('usr-b'); // score 5 wins
    expect(out[1]?.userId).toBe('usr-a'); // tied at 1
    expect(out[1]?.suggestedModuleTemplateId).toBe('COMPLIANCE'); // 'C' < 'L'
    expect(out[2]?.suggestedModuleTemplateId).toBe('LEGAL');
  });

  it('caps contributingSignalIds at maxContributingIds', () => {
    const sigs = Array.from({ length: 30 }, (_, i) =>
      mkSignal({
        id: `s${String(i).padStart(2, '0')}`,
        createdAt: NOW,
        weight: 0.5,
      }),
    );
    const out = aggregateSignals(sigs, {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
      maxContributingIds: 5,
    });
    expect(out[0]?.contributingSignalIds.length).toBe(5);
  });

  it('filters scores below minScore', () => {
    const sig = mkSignal({
      weight: 0.001,
      createdAt: NOW,
    });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
      minScore: 0.1,
    });
    expect(out).toEqual([]);
  });

  it('returns frozen output', () => {
    const sig = mkSignal({ createdAt: NOW });
    const out = aggregateSignals([sig], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });
});

describe('filterAboveThreshold', () => {
  it('returns only entries >= threshold', () => {
    const sig1 = mkSignal({ id: 's1', weight: 3, createdAt: NOW });
    const sig2 = mkSignal({
      id: 's2',
      userId: 'usr-b',
      weight: 0.5,
      createdAt: NOW,
    });
    const agg = aggregateSignals([sig1, sig2], {
      now: NOW,
      halfLifeDays: 7,
      lookbackDays: 14,
    });
    const filtered = filterAboveThreshold(agg, 1.0);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.score).toBeGreaterThanOrEqual(1.0);
  });
});
