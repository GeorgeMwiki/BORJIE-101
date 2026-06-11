import { describe, expect, it } from 'vitest';
import {
  billingState,
  type BillingCaps,
  type BillingUsage,
} from '../billing-state.js';

const RESET = new Date('2026-07-01T00:00:00.000Z');
const NOW = new Date('2026-06-09T12:00:00.000Z');

function caps(overrides: Partial<BillingCaps> = {}): BillingCaps {
  return {
    allowedTiers: ['haiku', 'sonnet', 'opus'],
    capCents: 2_000, // $20 Pro pool
    capTokens: 1_320_000, // ~Pro monthly
    downgradeAtFraction: 0.85,
    overageAllowed: true,
    ...overrides,
  };
}

function usage(usedTokens: number, usedCents: number): BillingUsage {
  return { usedTokens, usedCents };
}

describe('billingState — honest three states (TEST=PAYING)', () => {
  it('STATE 1 included: under budget → full powers, resetAt present', () => {
    const s = billingState(usage(100, 50), caps(), RESET, NOW);
    expect(s.state).toBe('included');
    expect(s.remainingCents).toBe(1_950);
    expect(s.resetAt).toEqual(RESET); // always shown (doc §1.4)
    expect(s.economyMode).toBe(false);
    expect(s.approaching).toBe(false);
  });

  it('STATE 2 paid-overage: budget spent + overage allowed → metered, never stopped', () => {
    const s = billingState(usage(2_000_000, 2_000), caps(), RESET, NOW);
    expect(s.state).toBe('paid-overage');
    expect(s.remainingCents).toBe(0);
    expect(s.resetAt).toEqual(RESET);
    // The transparent rate note is ALWAYS populated in paid-overage (doc §1.5).
    expect(s.overageRateNote).toBeDefined();
    expect(s.overageRateNote).toMatch(/metered usage/i);
    // Not a silent degrade — economy mode is off, this is honest paid usage.
    expect(s.economyMode).toBe(false);
  });

  it('STATE 3 stopped: budget spent + overage NOT allowed → hard honest stop', () => {
    const s = billingState(
      usage(2_000_000, 2_000),
      caps({ overageAllowed: false }),
      RESET,
      NOW,
    );
    expect(s.state).toBe('stopped');
    expect(s.remainingTokens).toBe(0);
    expect(s.remainingCents).toBe(0);
    expect(s.resetAt).toEqual(RESET); // even stopped shows the reset time
    expect(s.overageRateNote).toBeUndefined();
  });

  it('the overage-allowed branch and the stopped branch diverge on the SAME usage', () => {
    const over = usage(2_000_000, 5_000);
    expect(billingState(over, caps({ overageAllowed: true }), RESET, NOW).state).toBe(
      'paid-overage',
    );
    expect(billingState(over, caps({ overageAllowed: false }), RESET, NOW).state).toBe(
      'stopped',
    );
  });

  it('paid-overage STOPS at the owner-controlled overage cap', () => {
    // capCents 2000 included; owner overage cap 1000 cents. Spent 3500 →
    // overage portion 1500 ≥ 1000 → stopped.
    const s = billingState(
      usage(2_000_000, 3_500),
      caps({ overageCapCents: 1_000 }),
      RESET,
      NOW,
    );
    expect(s.state).toBe('stopped');
    expect(s.overageRemainingCents).toBe(0);
  });

  it('paid-overage reports remaining overage headroom under the cap', () => {
    // Included 2000; overage cap 1000; spent 2600 → overage 600, remaining 400.
    const s = billingState(
      usage(2_000_000, 2_600),
      caps({ overageCapCents: 1_000 }),
      RESET,
      NOW,
    );
    expect(s.state).toBe('paid-overage');
    expect(s.overageRemainingCents).toBe(400);
  });

  it('token exhaustion alone (cents still under) triggers overage/stop', () => {
    const s = billingState(
      usage(1_320_000, 10), // tokens at cap, cents tiny
      caps({ overageAllowed: false }),
      RESET,
      NOW,
    );
    expect(s.state).toBe('stopped');
  });
});

describe('billingState — economy mode is SURFACED, never silent', () => {
  it('engages economyMode at the downgrade fraction with a disclosable note', () => {
    // 90% of token budget, still inside budget → included + economyMode on.
    const s = billingState(
      usage(Math.floor(1_320_000 * 0.9), 100),
      caps(),
      RESET,
      NOW,
    );
    expect(s.state).toBe('included');
    expect(s.economyMode).toBe(true);
    expect(s.approaching).toBe(true);
    // The owner is TOLD — note is present and names the economy model.
    expect(s.economyNote).toBeDefined();
    expect(s.economyNote).toMatch(/economy model/i);
  });

  it('does NOT engage economy mode below the threshold', () => {
    const s = billingState(
      usage(Math.floor(1_320_000 * 0.5), 100),
      caps(),
      RESET,
      NOW,
    );
    expect(s.economyMode).toBe(false);
    expect(s.economyNote).toBeUndefined();
  });

  it('economy mode is OFF once the budget is exhausted (it is included-only)', () => {
    const s = billingState(usage(2_000_000, 2_000), caps(), RESET, NOW);
    expect(s.economyMode).toBe(false);
  });

  it('names the cheapest allowed tier as the economy model', () => {
    const s = billingState(
      usage(Math.floor(1_320_000 * 0.9), 100),
      caps({ allowedTiers: ['sonnet', 'opus'] }), // no haiku → sonnet is economy
      RESET,
      NOW,
    );
    expect(s.economyNote).toMatch(/sonnet/);
  });
});

describe('billingState — invariants', () => {
  it('NEVER returns a fourth silently-degraded state', () => {
    const states = new Set<string>();
    for (const tokens of [0, 500_000, 1_320_000, 5_000_000]) {
      for (const cents of [0, 1_000, 2_000, 9_999]) {
        for (const overageAllowed of [true, false]) {
          states.add(
            billingState(
              usage(tokens, cents),
              caps({ overageAllowed }),
              RESET,
              NOW,
            ).state,
          );
        }
      }
    }
    expect([...states].sort()).toEqual(['included', 'paid-overage', 'stopped']);
  });

  it('ALWAYS returns a resetAt (doc §1.4)', () => {
    for (const tokens of [0, 1_320_000, 5_000_000]) {
      const s = billingState(usage(tokens, tokens / 1000), caps(), RESET, NOW);
      expect(s.resetAt).toEqual(RESET);
    }
  });
});
