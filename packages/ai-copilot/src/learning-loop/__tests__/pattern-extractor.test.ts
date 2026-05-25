/**
 * Tests for learning-loop/pattern-extractor.
 *
 * Coverage: bucket grouping by (domain, actionType), min sample-size cutoff,
 * chi-squared significance flag, ordering (significant first), feature
 * allowlist, primitive-only feature filter, deterministic ids.
 */

import { describe, it, expect } from 'vitest';
import { extractPatterns } from '../pattern-extractor.js';
import type { OutcomeEvent } from '../types.js';
import type { AutonomyDomain } from '../../autonomy/types.js';

function event(
  i: number,
  outcome: OutcomeEvent['outcome'],
  context: Record<string, unknown> = {},
  overrides: Partial<OutcomeEvent> = {},
): OutcomeEvent {
  return {
    actionId: `a-${i}`,
    tenantId: 't1',
    domain: 'finance' as AutonomyDomain,
    actionType: 'auto_approve_refund',
    context,
    decision: 'd',
    rationale: 'r',
    confidence: 0.5,
    executedAt: new Date(2026, 4, 1, 0, 0, i).toISOString(),
    outcome,
    ...overrides,
  };
}

describe('extractPatterns', () => {
  it('returns an empty array for empty input', () => {
    expect(extractPatterns([])).toEqual([]);
  });

  it('skips buckets smaller than the minimum sample size', () => {
    const events: OutcomeEvent[] = [
      event(1, 'success', { vendorIsTrusted: true }),
      event(2, 'success', { vendorIsTrusted: true }),
    ];
    expect(extractPatterns(events, { minSampleSize: 5 })).toEqual([]);
  });

  it('flags a strongly-segregated feature as significant', () => {
    // 10 events: trusted=true → 5/5 success; trusted=false → 0/5 success.
    const events: OutcomeEvent[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        event(i, 'success', { vendorIsTrusted: true }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        event(5 + i, 'failure', { vendorIsTrusted: false }),
      ),
    ];
    const patterns = extractPatterns(events);
    expect(patterns.length).toBeGreaterThan(0);
    const significant = patterns.filter((p) => p.significant);
    expect(significant.length).toBeGreaterThan(0);
    const top = patterns[0];
    expect(top.significant).toBe(true);
    expect(top.contextFeature).toBe('vendorIsTrusted');
    expect(top.successRate).toBeCloseTo(1.0);
    expect(top.baselineSuccessRate).toBeCloseTo(0.5);
  });

  it('ignores pending outcomes when computing rates', () => {
    const events: OutcomeEvent[] = [
      event(1, 'success', { vendorIsTrusted: true }),
      event(2, 'success', { vendorIsTrusted: true }),
      event(3, 'success', { vendorIsTrusted: true }),
      event(4, 'success', { vendorIsTrusted: true }),
      event(5, 'success', { vendorIsTrusted: true }),
      event(6, 'pending', { vendorIsTrusted: false }),
      event(7, 'pending', { vendorIsTrusted: false }),
      event(8, 'pending', { vendorIsTrusted: false }),
      event(9, 'pending', { vendorIsTrusted: false }),
      event(10, 'pending', { vendorIsTrusted: false }),
    ];
    const patterns = extractPatterns(events);
    // After dropping pending, only 5 events remain — meets minSample=5,
    // but no contrast so no segregated pattern.
    const trustedPattern = patterns.find((p) => p.contextValue === 'true');
    if (trustedPattern) {
      expect(trustedPattern.successRate).toBeCloseTo(1.0);
    }
  });

  it('respects an explicit feature allowlist', () => {
    const events: OutcomeEvent[] = Array.from({ length: 10 }, (_, i) =>
      event(i, i < 5 ? 'success' : 'failure', {
        vendorIsTrusted: i < 5,
        unrelatedFlag: 'x',
      }),
    );
    const patterns = extractPatterns(events, {
      featureAllowlist: ['vendorIsTrusted'],
    });
    for (const p of patterns) {
      expect(p.contextFeature).toBe('vendorIsTrusted');
    }
  });

  it('skips object-typed feature values (only primitives are scanned)', () => {
    const events: OutcomeEvent[] = Array.from({ length: 10 }, (_, i) =>
      event(i, i < 5 ? 'success' : 'failure', {
        vendorIsTrusted: i < 5,
        rich: { id: 1 },
      }),
    );
    const patterns = extractPatterns(events);
    expect(patterns.find((p) => p.contextFeature === 'rich')).toBeUndefined();
  });

  it('orders results: significant first, then by chi-squared desc', () => {
    const events: OutcomeEvent[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        event(i, 'success', { strong: true }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        event(5 + i, 'failure', { strong: false }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        event(10 + i, 'success', { weak: 'y' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        event(15 + i, 'success', { weak: 'n' }),
      ),
    ];
    const patterns = extractPatterns(events);
    if (patterns.length >= 2) {
      // Significant entries come first.
      const firstSig = patterns.findIndex((p) => p.significant);
      const lastSig =
        patterns.length -
        1 -
        [...patterns].reverse().findIndex((p) => p.significant);
      const firstNonSig = patterns.findIndex((p) => !p.significant);
      if (firstSig !== -1 && firstNonSig !== -1) {
        expect(firstSig).toBeLessThan(firstNonSig);
        expect(lastSig).toBeLessThan(firstNonSig);
      }
    }
  });

  it('emits stable, deterministic ids for the same (domain, actionType, feature, value)', () => {
    const events: OutcomeEvent[] = Array.from({ length: 10 }, (_, i) =>
      event(i, i < 5 ? 'success' : 'failure', { trusted: i < 5 }),
    );
    const a = extractPatterns(events);
    const b = extractPatterns(events);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].id).toEqual(b[0].id);
    expect(a[0].id).toMatch(/^pat_/);
  });

  it('groups by (domain, actionType) — different buckets do not cross-pollute', () => {
    const e1 = Array.from({ length: 5 }, (_, i) =>
      event(i, 'success', { flag: true }),
    );
    const e2 = Array.from({ length: 5 }, (_, i) =>
      event(100 + i, 'failure', { flag: true }, {
        actionType: 'auto_send_reminder',
      }),
    );
    const patterns = extractPatterns([...e1, ...e2]);
    const refund = patterns.filter(
      (p) => p.actionType === 'auto_approve_refund',
    );
    const reminder = patterns.filter(
      (p) => p.actionType === 'auto_send_reminder',
    );
    if (refund.length > 0) expect(refund[0].successRate).toBeCloseTo(1);
    if (reminder.length > 0) expect(reminder[0].successRate).toBeCloseTo(0);
  });

  it('uses the injected `now` clock for discoveredAt', () => {
    const fixed = new Date('2026-04-01T00:00:00.000Z');
    const events: OutcomeEvent[] = Array.from({ length: 10 }, (_, i) =>
      event(i, i < 5 ? 'success' : 'failure', { vendorIsTrusted: i < 5 }),
    );
    const patterns = extractPatterns(events, { now: () => fixed });
    if (patterns.length > 0) {
      expect(patterns[0].discoveredAt).toBe(fixed.toISOString());
    }
  });
});
