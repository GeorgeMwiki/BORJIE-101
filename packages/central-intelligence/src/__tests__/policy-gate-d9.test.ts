/**
 * Policy gate — D9 additions.
 *
 * Four new checks:
 *   (5) language-consistency  → soften (hedge)
 *   (6) grounding-cite        → block
 *   (7) fabrication           → block
 *   (8) 10x-numerical-sanity  → soften (hedge)
 *
 * Each is exercised with a positive (triggered) case and a negative
 * (pass-through) case, with property-management framing.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLanguageMismatch,
  detectTenXSanityViolations,
  runPolicyGate,
} from '../kernel/policy-gate.js';

describe('runPolicyGate — (5) language-consistency', () => {
  it('hedges when caller asked for Swahili but the output is dominantly English', () => {
    const englishHeavy =
      'The lease is on track and the rent will be due on the first of the month, and the tenant has been notified by email.';
    const out = runPolicyGate({
      text: englishHeavy,
      hasCitations: true,
      request: { language: 'sw' },
    });
    expect(out.mutations).toContain('hedged:language-consistency');
    expect(out.redactedText).toMatch(/response language requested as "sw"/);
  });

  it('passes when caller asked for English and the output is dominantly English', () => {
    const englishHeavy =
      'The rent is paid for this month and the tenant has been notified by email.';
    const out = runPolicyGate({
      text: englishHeavy,
      hasCitations: true,
      request: { language: 'en' },
    });
    expect(out.mutations).not.toContain('hedged:language-consistency');
  });

  it('detectLanguageMismatch returns false on short text (low signal)', () => {
    expect(detectLanguageMismatch('Hi.', 'en')).toBe(false);
  });
});

describe('runPolicyGate — (6) grounding-cite', () => {
  it('blocks when a factual claim is asserted without a citation', () => {
    const out = runPolicyGate({
      text: 'Occupancy is at 92%.',
      hasCitations: false,
      decision: { hasFactualClaim: true },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:grounding-cite');
  });

  it('passes when a factual claim is backed by a citation', () => {
    const out = runPolicyGate({
      text: 'Occupancy is at 92%.',
      hasCitations: true,
      decision: { hasFactualClaim: true },
    });
    expect(out.verdict.status).not.toBe('block');
  });

  it('does not trigger when hasFactualClaim is absent', () => {
    const out = runPolicyGate({
      text: 'occupancy on track',
      hasCitations: false,
    });
    expect(out.verdict.status).toBe('pass');
  });
});

describe('runPolicyGate — (7) fabrication / judge cross-check', () => {
  it('blocks when judgeContradicted is true', () => {
    const out = runPolicyGate({
      text: 'rent is 50000',
      hasCitations: true,
      decision: { judgeContradicted: true },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:fabrication');
  });

  it('passes when the judge confirms the primary', () => {
    const out = runPolicyGate({
      text: 'rent is 50000',
      hasCitations: true,
      decision: { judgeContradicted: false },
    });
    expect(out.verdict.status).not.toBe('block');
  });
});

describe('runPolicyGate — (8) 10x-numerical-sanity', () => {
  it('hedges when an observed metric is 10× the baseline', () => {
    const out = runPolicyGate({
      text: 'The arrears for this month came in at 500000 TZS.',
      hasCitations: true,
      request: { numericalBaselines: { arrears: 50000 } },
    });
    expect(out.mutations).toContain('hedged:10x-numerical-sanity');
    expect(out.redactedText).toMatch(/Numerical-sanity flag/);
  });

  it('passes when the observed metric is within range of the baseline', () => {
    const out = runPolicyGate({
      text: 'arrears: 52000 TZS this month',
      hasCitations: true,
      request: { numericalBaselines: { arrears: 50000 } },
    });
    expect(out.mutations).not.toContain('hedged:10x-numerical-sanity');
  });

  it('detectTenXSanityViolations skips zero baselines', () => {
    const flagged = detectTenXSanityViolations('arrears: 5000', {
      arrears: 0,
    });
    expect(flagged).toHaveLength(0);
  });
});
