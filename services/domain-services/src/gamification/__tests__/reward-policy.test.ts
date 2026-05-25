/**
 * RewardPolicy schema + tier resolver — pure validation logic.
 */

import { describe, it, expect } from 'vitest';
import {
  RewardPolicySchema,
  tierForScore,
  DEFAULT_REWARD_POLICY,
  RewardTierSchema,
  CashbackProviderSchema,
  type RewardPolicy,
} from '../reward-policy.js';

function buildValidPolicy(
  overrides: Partial<RewardPolicy> = {},
): Record<string, unknown> {
  return {
    id: 'pol_1',
    tenantId: 'tnt_1',
    createdAt: '2026-05-08T00:00:00Z',
    effectiveFrom: '2026-05-08T00:00:00Z',
    ...DEFAULT_REWARD_POLICY,
    ...overrides,
  };
}

describe('RewardTierSchema', () => {
  it('accepts the four tier names', () => {
    expect(RewardTierSchema.parse('bronze')).toBe('bronze');
    expect(RewardTierSchema.parse('silver')).toBe('silver');
    expect(RewardTierSchema.parse('gold')).toBe('gold');
    expect(RewardTierSchema.parse('platinum')).toBe('platinum');
  });

  it('rejects unknown tier', () => {
    expect(() => RewardTierSchema.parse('diamond')).toThrow();
  });
});

describe('CashbackProviderSchema', () => {
  it('accepts the three MNO providers', () => {
    expect(CashbackProviderSchema.parse('mpesa_b2c')).toBe('mpesa_b2c');
    expect(CashbackProviderSchema.parse('airtel_b2c')).toBe('airtel_b2c');
    expect(CashbackProviderSchema.parse('tigopesa_b2c')).toBe('tigopesa_b2c');
  });

  it('rejects unknown provider', () => {
    expect(() => CashbackProviderSchema.parse('paypal')).toThrow();
  });
});

describe('RewardPolicySchema', () => {
  it('parses a valid policy', () => {
    const parsed = RewardPolicySchema.parse(buildValidPolicy());
    expect(parsed.id).toBe('pol_1');
    expect(parsed.tenantId).toBe('tnt_1');
    expect(parsed.active).toBe(true);
  });

  it('applies defaults for omitted fields', () => {
    const minimal = RewardPolicySchema.parse({
      id: 'pol_1',
      tenantId: 'tnt_1',
      createdAt: '2026-05-08T00:00:00Z',
      effectiveFrom: '2026-05-08T00:00:00Z',
    });
    expect(minimal.onTimePoints).toBe(10);
    expect(minimal.bronzeThreshold).toBe(0);
    expect(minimal.silverThreshold).toBe(100);
    expect(minimal.cashbackEnabled).toBe(false);
  });

  it('rejects ascending thresholds out of order', () => {
    const bad = buildValidPolicy({
      bronzeThreshold: 0,
      silverThreshold: 500,
      goldThreshold: 200,
      platinumThreshold: 600,
    });
    expect(() => RewardPolicySchema.parse(bad)).toThrow(/ascending/);
  });

  it('requires cashbackProvider when cashbackEnabled is true', () => {
    const bad = buildValidPolicy({
      cashbackEnabled: true,
      cashbackProvider: undefined,
    });
    expect(() => RewardPolicySchema.parse(bad)).toThrow(/cashbackProvider/);
  });

  it('accepts cashbackEnabled with a provider set', () => {
    const ok = buildValidPolicy({
      cashbackEnabled: true,
      cashbackProvider: 'mpesa_b2c',
    });
    expect(() => RewardPolicySchema.parse(ok)).not.toThrow();
  });

  it('rejects negative bps for early-pay discount', () => {
    const bad = buildValidPolicy({ earlyPayDiscountBps: -5 });
    expect(() => RewardPolicySchema.parse(bad)).toThrow();
  });

  it('rejects bps above 10000', () => {
    const bad = buildValidPolicy({ lateFeeBps: 10_001 });
    expect(() => RewardPolicySchema.parse(bad)).toThrow();
  });
});

describe('tierForScore', () => {
  const policy = RewardPolicySchema.parse(buildValidPolicy());

  it('returns bronze for score below silver threshold', () => {
    expect(tierForScore(policy, 0)).toBe('bronze');
    expect(tierForScore(policy, 99)).toBe('bronze');
  });

  it('returns silver at silver threshold', () => {
    expect(tierForScore(policy, 100)).toBe('silver');
    expect(tierForScore(policy, 299)).toBe('silver');
  });

  it('returns gold at gold threshold', () => {
    expect(tierForScore(policy, 300)).toBe('gold');
    expect(tierForScore(policy, 599)).toBe('gold');
  });

  it('returns platinum at platinum threshold', () => {
    expect(tierForScore(policy, 600)).toBe('platinum');
    expect(tierForScore(policy, 999_999)).toBe('platinum');
  });

  it('handles negative score as bronze', () => {
    expect(tierForScore(policy, -50)).toBe('bronze');
  });
});
