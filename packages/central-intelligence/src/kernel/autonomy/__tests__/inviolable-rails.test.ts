/**
 * Mr. Mwikila autonomy — inviolable safety-rail unit tests.
 *
 * Five hard refusals — every branch covered:
 *   - kill-switch wins above everything else
 *   - family-member target blocks regardless of amount / category
 *   - non-TZS currency on a money-moving action blocks
 *   - capex above envelope blocks even at T3
 *   - generic money-out above envelope blocks
 *   - zero-amount informational actions always pass
 *   - the platform default envelope is used when pref envelope is null
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MONTHLY_ENVELOPE_TZS,
  checkAutonomyInviolable,
  type AutonomyActionDescriptor,
} from '../inviolable-rails.js';

function descriptor(
  override: Partial<AutonomyActionDescriptor> = {},
): AutonomyActionDescriptor {
  return {
    category: 'shifts',
    amountTzs: 0,
    currency: 'TZS',
    targetRelation: 'staff',
    envelopeThresholdTzs: null,
    killSwitchOpen: false,
    ...override,
  };
}

describe('checkAutonomyInviolable — passes', () => {
  it('passes an informational shift schedule (no money)', () => {
    const v = checkAutonomyInviolable(descriptor());
    expect(v.status).toBe('pass');
  });

  it('passes a small inventory order under the envelope', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'inventory-orders',
        amountTzs: 250_000,
        envelopeThresholdTzs: 1_000_000,
      }),
    );
    expect(v.status).toBe('pass');
  });

  it('passes when amount equals envelope exactly', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        amountTzs: 1_000_000,
        envelopeThresholdTzs: 1_000_000,
      }),
    );
    expect(v.status).toBe('pass');
  });
});

describe('checkAutonomyInviolable — blocks', () => {
  it('kill-switch wins above family / currency / amount', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        killSwitchOpen: true,
        targetRelation: 'family',
        amountTzs: 999_999_999,
        currency: 'USD',
        category: 'capex',
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('kill_switch_open');
  });

  it('family-member target blocks', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'worker-discipline',
        targetRelation: 'family',
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('family_member_target');
  });

  it('non-TZS currency on a paying action blocks', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'inventory-orders',
        amountTzs: 100_000,
        currency: 'USD',
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('non_tzs_currency');
  });

  it('capex above per-tenant envelope blocks', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'capex',
        amountTzs: 6_000_000,
        envelopeThresholdTzs: 5_000_000,
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('capex_over_envelope');
  });

  it('capex above platform default envelope blocks when no per-tenant cap', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'capex',
        amountTzs: DEFAULT_MONTHLY_ENVELOPE_TZS + 1,
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('capex_over_envelope');
  });

  it('generic money-out above envelope blocks (non-capex)', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        category: 'inventory-orders',
        amountTzs: DEFAULT_MONTHLY_ENVELOPE_TZS + 1,
      }),
    );
    expect(v.status).toBe('block');
    expect(v.reason).toBe('envelope_exceeded');
  });

  it('non-TZS check skipped when amount is zero (informational)', () => {
    const v = checkAutonomyInviolable(
      descriptor({
        amountTzs: 0,
        currency: 'USD',
      }),
    );
    expect(v.status).toBe('pass');
  });
});
