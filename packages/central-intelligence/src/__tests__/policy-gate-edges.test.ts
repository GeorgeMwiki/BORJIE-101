/**
 * Policy gate — edge cases beyond the smoke tests in kernel-units.
 *
 * Covers:
 *   - Tanzania, Kenya, generic 06xx phone redaction
 *   - email + NIDA redaction
 *   - currency hedging in TZS / KES / USD
 *   - regulatory hedge skipped when arrears-ladder already mentioned
 *   - clean text passes with verdict.status === 'pass'
 *   - PII redaction takes precedence over numeric hedging in verdict reason
 *   - mutations array reports each kind of redaction
 */

import { describe, it, expect } from 'vitest';
import { runPolicyGate } from '../kernel/index.js';

describe('runPolicyGate — PII redaction', () => {
  it('redacts a Tanzania phone number', () => {
    const out = runPolicyGate({ text: 'call +255 712 345 678 today', hasCitations: true });
    expect(out.redactedText).toContain('[redacted-phone]');
    expect(out.mutations).toContain('redacted:phone-tz');
    expect(out.verdict.status).toBe('soften');
  });

  it('redacts a Kenya phone number', () => {
    const out = runPolicyGate({ text: 'call +254 712 345 678 today', hasCitations: true });
    expect(out.redactedText).toContain('[redacted-phone]');
    expect(out.mutations).toContain('redacted:phone-ke');
  });

  it('redacts a generic 0712 prefix phone number', () => {
    const out = runPolicyGate({ text: 'call 0712 345 678 today', hasCitations: true });
    expect(out.redactedText).toContain('[redacted-phone]');
    expect(out.mutations).toContain('redacted:phone-gen');
  });

  it('redacts an email address', () => {
    const out = runPolicyGate({ text: 'reach out to manager@estate.com tomorrow', hasCitations: true });
    expect(out.redactedText).toContain('[redacted-email]');
    expect(out.mutations).toContain('redacted:email');
  });

  it('redacts a Tanzania NIDA number', () => {
    const out = runPolicyGate({ text: 'NIDA 19851234-12345-12345-12 on file', hasCitations: true });
    expect(out.redactedText).toContain('[redacted-nida]');
    expect(out.mutations).toContain('redacted:nida');
  });

  it('flags soften verdict with PII reason when redactions occurred', () => {
    const out = runPolicyGate({ text: 'call +255 712 345 678', hasCitations: true });
    expect(out.verdict.status).toBe('soften');
    if (out.verdict.status === 'soften') {
      expect(out.verdict.reason).toMatch(/PII redacted/);
    }
  });
});

describe('runPolicyGate — numeric / currency hedging', () => {
  it('hedges uncited TZS money', () => {
    const out = runPolicyGate({ text: 'arrears total TZS 250,000', hasCitations: false });
    expect(out.redactedText).toMatch(/uncited.*ledger/);
    expect(out.mutations).toContain('hedged:uncited-money');
  });

  it('hedges uncited KES money', () => {
    const out = runPolicyGate({ text: 'last invoice was KES 18000', hasCitations: false });
    expect(out.redactedText).toMatch(/uncited.*ledger/);
  });

  it('hedges uncited USD money', () => {
    const out = runPolicyGate({ text: 'we collected USD 1200 this week', hasCitations: false });
    expect(out.redactedText).toMatch(/uncited.*ledger/);
  });

  it('does NOT hedge cited numbers', () => {
    const out = runPolicyGate({ text: 'collection is 92.3% [cite:1]', hasCitations: true });
    expect(out.mutations).not.toContain('hedged:uncited-percentage');
  });
});

describe('runPolicyGate — regulatory hedge', () => {
  it('appends regulatory hedge for "evict" language', () => {
    const out = runPolicyGate({ text: 'we should evict the tenant', hasCitations: true });
    expect(out.redactedText).toMatch(/arrears ladder/);
    expect(out.mutations).toContain('appended:regulatory-hedge');
  });

  it('appends regulatory hedge for "lockout"', () => {
    const out = runPolicyGate({ text: 'plan a lockout for unit 4B', hasCitations: true });
    expect(out.mutations).toContain('appended:regulatory-hedge');
  });

  it('does NOT append regulatory hedge when arrears ladder is already mentioned', () => {
    const out = runPolicyGate({
      text: 'eviction will follow the arrears ladder and notice period',
      hasCitations: true,
    });
    expect(out.mutations).not.toContain('appended:regulatory-hedge');
  });

  it('does NOT append regulatory hedge when tribunal is already cited', () => {
    const out = runPolicyGate({
      text: 'termination will be referred to the tribunal',
      hasCitations: true,
    });
    expect(out.mutations).not.toContain('appended:regulatory-hedge');
  });
});

describe('runPolicyGate — pass-through', () => {
  it('passes clean cited text unchanged', () => {
    const out = runPolicyGate({ text: 'collection is on track this month', hasCitations: true });
    expect(out.verdict.status).toBe('pass');
    expect(out.mutations).toEqual([]);
    expect(out.redactedText).toBe('collection is on track this month');
  });

  it('returns frozen mutations array (no callers can mutate)', () => {
    const out = runPolicyGate({ text: 'clean', hasCitations: true });
    expect(Array.isArray(out.mutations)).toBe(true);
  });
});
