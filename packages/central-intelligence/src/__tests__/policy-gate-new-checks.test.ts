/**
 * Policy gate — K5-parity context checks.
 *
 * Covers the four new pre-output checks bolted in front of the existing
 * PII / numerical / regulatory passes:
 *
 *   (a) Tenant-isolation gate
 *   (b) Scope-match gate
 *   (c) Cost-ceiling gate (per tier)
 *   (d) Off-hours sensitive-action gate
 *
 * Each check is exercised with at least one positive (block) case and one
 * negative (pass-through) case, with property-management framing where
 * the off-hours rule applies to sovereign actions like eviction proposals
 * and KRA MRI filings.
 */

import { describe, it, expect } from 'vitest';
import { runPolicyGate, isWithinBusinessHoursEAT } from '../kernel/index.js';

// 2026-05-12 is a Tuesday. 10:00 EAT = 07:00 UTC.
const BUSINESS_HOURS_TUESDAY = new Date(Date.UTC(2026, 4, 12, 7, 0, 0));
// 2026-05-11 is a Monday but 23:00 EAT = 20:00 UTC.
const AFTER_HOURS_MONDAY = new Date(Date.UTC(2026, 4, 11, 20, 0, 0));
// 2026-05-17 is a Sunday.
const SUNDAY_MIDDAY = new Date(Date.UTC(2026, 4, 17, 9, 0, 0));

describe('runPolicyGate — (a) tenant-isolation gate', () => {
  it('blocks when request.tenantId differs from decision.tenantId', () => {
    const out = runPolicyGate({
      text: 'occupancy is 92%',
      hasCitations: true,
      request: { tenantId: 'tnt_A' },
      decision: { tenantId: 'tnt_B' },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:tenant-isolation');
    if (out.verdict.status === 'block') {
      expect(out.verdict.reason).toMatch(/tenant-isolation/);
    }
  });

  it('passes when request.tenantId matches decision.tenantId', () => {
    const out = runPolicyGate({
      text: 'occupancy is on track',
      hasCitations: true,
      request: { tenantId: 'tnt_A' },
      decision: { tenantId: 'tnt_A' },
    });
    expect(out.verdict.status).toBe('pass');
  });

  it('passes when no tenant context is supplied (legacy callers)', () => {
    const out = runPolicyGate({ text: 'occupancy is on track', hasCitations: true });
    expect(out.verdict.status).toBe('pass');
  });
});

describe('runPolicyGate — (b) scope-match gate', () => {
  it('blocks when a required scope is missing from grantedScopes', () => {
    const out = runPolicyGate({
      text: 'work-order list',
      hasCitations: true,
      request: { grantedScopes: ['action.read'] },
      decision: { requiredScopes: ['action.read', 'payouts.write'] },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:scope-mismatch');
    if (out.verdict.status === 'block') {
      expect(out.verdict.reason).toMatch(/payouts\.write/);
    }
  });

  it('passes when granted scopes cover every required scope', () => {
    const out = runPolicyGate({
      text: 'work-order list',
      hasCitations: true,
      request: { grantedScopes: ['action.read', 'payouts.write', 'admin'] },
      decision: { requiredScopes: ['action.read', 'payouts.write'] },
    });
    expect(out.verdict.status).toBe('pass');
  });
});

describe('runPolicyGate — (c) cost-ceiling gate', () => {
  it('blocks a free-tier caller whose call cost exceeds $0.05', () => {
    const out = runPolicyGate({
      text: 'long report',
      hasCitations: true,
      request: { tier: 'free', estimatedCostUsd: 0.12 },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:cost-ceiling');
  });

  it('passes a pro-tier caller at $0.10 (below ceiling)', () => {
    const out = runPolicyGate({
      text: 'report',
      hasCitations: true,
      request: { tier: 'pro', estimatedCostUsd: 0.1 },
    });
    expect(out.verdict.status).toBe('pass');
  });

  it('exempts sovereign-tier callers from the cost ceiling', () => {
    const out = runPolicyGate({
      text: 'platform-wide cohort analysis',
      hasCitations: true,
      request: { tier: 'sovereign', estimatedCostUsd: 50 },
    });
    expect(out.verdict.status).toBe('pass');
  });

  it('honours an operator-supplied override of the default ceilings', () => {
    const out = runPolicyGate({
      text: 'report',
      hasCitations: true,
      request: { tier: 'pro', estimatedCostUsd: 0.5 },
      costCeilings: { pro: 1.0 },
    });
    expect(out.verdict.status).toBe('pass');
  });
});

describe('runPolicyGate — (d) off-hours sovereign-action gate', () => {
  it('blocks a critical-stakes eviction proposal at 23:00 EAT on a Monday', () => {
    const out = runPolicyGate({
      text: 'propose eviction for unit 4B',
      hasCitations: true,
      request: { stakes: 'critical', now: AFTER_HOURS_MONDAY },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:off-hours-sovereign');
  });

  it('blocks a critical-stakes KRA MRI filing on a Sunday', () => {
    const out = runPolicyGate({
      text: 'file KRA MRI return for April',
      hasCitations: true,
      request: { stakes: 'critical', now: SUNDAY_MIDDAY },
    });
    expect(out.verdict.status).toBe('block');
    expect(out.mutations).toContain('blocked:off-hours-sovereign');
  });

  it('passes a critical-stakes action during EAT business hours', () => {
    const out = runPolicyGate({
      text: 'sovereign KRA filing approved for review',
      hasCitations: true,
      request: { stakes: 'critical', now: BUSINESS_HOURS_TUESDAY },
    });
    expect(out.verdict.status).toBe('pass');
  });

  it('allows an after-hours sovereign action when afterHoursOverride=true', () => {
    const out = runPolicyGate({
      text: 'urgent fire-safety door unlock override for unit 4B',
      hasCitations: true,
      request: {
        stakes: 'critical',
        now: AFTER_HOURS_MONDAY,
        afterHoursOverride: true,
      },
    });
    expect(out.verdict.status).toBe('pass');
  });

  it('does NOT apply the off-hours gate to medium-stakes turns', () => {
    const out = runPolicyGate({
      text: 'send rent reminder',
      hasCitations: true,
      request: { stakes: 'medium', now: AFTER_HOURS_MONDAY },
    });
    expect(out.verdict.status).toBe('pass');
  });
});

describe('isWithinBusinessHoursEAT (helper)', () => {
  it('returns true at 10:00 EAT Tuesday', () => {
    expect(isWithinBusinessHoursEAT(BUSINESS_HOURS_TUESDAY)).toBe(true);
  });
  it('returns false at 23:00 EAT Monday', () => {
    expect(isWithinBusinessHoursEAT(AFTER_HOURS_MONDAY)).toBe(false);
  });
  it('returns false on Sundays', () => {
    expect(isWithinBusinessHoursEAT(SUNDAY_MIDDAY)).toBe(false);
  });
});
