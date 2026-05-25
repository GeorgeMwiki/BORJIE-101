/**
 * Confidence-band routing — pure-function tests.
 *
 * Covers:
 *   - Each band (auto, audit, escalate) at the default growth gate.
 *   - Boundary cases (exactly 0.70, exactly 0.95) — inclusive lower bound.
 *   - Tier override path (free strict, enterprise permissive).
 *   - Explicit `TierThresholds` override path.
 *   - Defensive escalation on invalid input (NaN, out-of-range, infinities,
 *     misconfigured thresholds).
 *   - Reason-string format (joinable for audit trail).
 *   - Frozen defaults — no runtime mutation possible.
 */

import { describe, expect, it } from 'vitest';
import {
  SPEC_DEFAULT_THRESHOLDS,
  TIER_DEFAULTS,
  route,
} from '../confidence-band.js';

describe('route — default growth gate (0.95 / 0.70)', () => {
  it('returns auto for confidence above 0.95', () => {
    const v = route('approve-refund', 0.97);
    expect(v.mode).toBe('auto');
    expect(v.reason).toContain('auto');
    expect(v.reason).toContain('approve-refund');
  });

  it('returns audit for confidence in [0.70, 0.95)', () => {
    const v = route('draft-lease', 0.82);
    expect(v.mode).toBe('audit');
    expect(v.reason).toContain('audit');
  });

  it('returns escalate for confidence below 0.70', () => {
    const v = route('evict-tenant', 0.55);
    expect(v.mode).toBe('escalate');
    expect(v.reason).toContain('escalate');
  });

  it('returns auto at exactly 1.0 (perfect confidence)', () => {
    expect(route('payout', 1.0).mode).toBe('auto');
  });

  it('returns escalate at exactly 0 (zero confidence)', () => {
    expect(route('payout', 0).mode).toBe('escalate');
  });
});

describe('route — boundary cases (inclusive lower bound)', () => {
  it('confidence === 0.95 is auto (auto threshold is inclusive)', () => {
    expect(route('boundary-auto', 0.95).mode).toBe('auto');
  });

  it('confidence === 0.70 is audit (audit threshold is inclusive)', () => {
    expect(route('boundary-audit', 0.70).mode).toBe('audit');
  });

  it('confidence === 0.9499... is audit (just below auto)', () => {
    expect(route('just-below-auto', 0.9499).mode).toBe('audit');
  });

  it('confidence === 0.6999... is escalate (just below audit)', () => {
    expect(route('just-below-audit', 0.6999).mode).toBe('escalate');
  });
});

describe('route — tier override (free, growth, enterprise)', () => {
  it('free tier is strict: 0.97 is audit (below free.auto=0.99)', () => {
    const v = route('refund', 0.97, 'free');
    expect(v.mode).toBe('audit');
  });

  it('free tier is strict: 0.99 hits auto (at boundary)', () => {
    expect(route('refund', 0.99, 'free').mode).toBe('auto');
  });

  it('free tier: 0.79 escalates (just below audit=0.80)', () => {
    expect(route('refund', 0.79, 'free').mode).toBe('escalate');
  });

  it('growth tier matches the spec-default thresholds', () => {
    expect(route('any', 0.85, 'growth').mode).toBe('audit');
    expect(route('any', 0.96, 'growth').mode).toBe('auto');
    expect(route('any', 0.50, 'growth').mode).toBe('escalate');
  });

  it('enterprise tier is permissive: 0.91 is auto (above 0.90)', () => {
    expect(route('refund', 0.91, 'enterprise').mode).toBe('auto');
  });

  it('enterprise tier: 0.65 is audit (above audit=0.60)', () => {
    expect(route('refund', 0.65, 'enterprise').mode).toBe('audit');
  });

  it('enterprise tier: 0.59 escalates (just below audit=0.60)', () => {
    expect(route('refund', 0.59, 'enterprise').mode).toBe('escalate');
  });
});

describe('route — explicit TierThresholds override', () => {
  it('accepts caller-supplied thresholds object', () => {
    const v = route('custom', 0.5, { auto: 0.6, audit: 0.4 });
    expect(v.mode).toBe('audit');
  });

  it('caller-supplied thresholds override tier defaults', () => {
    // Stricter than free.
    const v = route('hyper-strict', 0.95, { auto: 0.999, audit: 0.90 });
    expect(v.mode).toBe('audit');
  });
});

describe('route — defensive escalation on bad input', () => {
  it('escalates on NaN confidence', () => {
    const v = route('x', Number.NaN);
    expect(v.mode).toBe('escalate');
    expect(v.reason).toContain('invalid confidence');
  });

  it('escalates on negative confidence', () => {
    expect(route('x', -0.1).mode).toBe('escalate');
  });

  it('escalates on confidence > 1', () => {
    expect(route('x', 1.5).mode).toBe('escalate');
  });

  it('escalates on +Infinity confidence', () => {
    expect(route('x', Number.POSITIVE_INFINITY).mode).toBe('escalate');
  });

  it('escalates when thresholds are misconfigured (auto < audit)', () => {
    const v = route('x', 0.9, { auto: 0.5, audit: 0.8 });
    expect(v.mode).toBe('escalate');
    expect(v.reason).toContain('invalid thresholds');
  });

  it('escalates when audit threshold is zero', () => {
    const v = route('x', 0.9, { auto: 0.95, audit: 0 });
    expect(v.mode).toBe('escalate');
  });

  it('escalates when auto threshold exceeds 1', () => {
    const v = route('x', 0.5, { auto: 1.1, audit: 0.5 });
    expect(v.mode).toBe('escalate');
  });
});

describe('route — audit-trail reason embeds the decision label', () => {
  it('embeds the decision label and confidence in the reason', () => {
    const v = route('approve-refund:tenant=42', 0.97);
    expect(v.reason).toContain('approve-refund:tenant=42');
    expect(v.reason).toContain('0.9700');
  });
});

describe('TIER_DEFAULTS — spec-conformance', () => {
  it('has the spec headline thresholds for growth (0.95 / 0.70)', () => {
    expect(TIER_DEFAULTS.growth).toEqual({ auto: 0.95, audit: 0.70 });
    expect(SPEC_DEFAULT_THRESHOLDS).toBe(TIER_DEFAULTS.growth);
  });

  it('has strict thresholds for free (0.99 / 0.80)', () => {
    expect(TIER_DEFAULTS.free).toEqual({ auto: 0.99, audit: 0.80 });
  });

  it('has permissive thresholds for enterprise (0.90 / 0.60)', () => {
    expect(TIER_DEFAULTS.enterprise).toEqual({ auto: 0.90, audit: 0.60 });
  });

  it('is frozen at the top level (no mutation)', () => {
    expect(Object.isFrozen(TIER_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(TIER_DEFAULTS.free)).toBe(true);
    expect(Object.isFrozen(TIER_DEFAULTS.growth)).toBe(true);
    expect(Object.isFrozen(TIER_DEFAULTS.enterprise)).toBe(true);
  });
});
