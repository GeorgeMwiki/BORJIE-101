import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOWNGRADE_AT_FRACTION,
  PLATFORM_TIERS,
  PLATFORM_TIER_CATALOG,
  getTierSpec,
  isPlatformTier,
  tierToCaps,
  type PlatformTier,
} from '../tiers.js';

describe('platform tier catalog', () => {
  it('materializes all five tiers', () => {
    expect([...PLATFORM_TIERS]).toEqual([
      'free',
      'pro',
      'max5x',
      'max20x',
      'enterprise',
    ]);
    for (const t of PLATFORM_TIERS) {
      expect(PLATFORM_TIER_CATALOG[t].tier).toBe(t);
    }
  });

  it('encodes the doc §1.2 per-5h-window token budgets', () => {
    // Source: billing-claude-code-model.md §1.2 (post-May-2026 doubling).
    expect(PLATFORM_TIER_CATALOG.pro.sessionTokenBudget).toBe(44_000);
    expect(PLATFORM_TIER_CATALOG.max5x.sessionTokenBudget).toBe(88_000);
    expect(PLATFORM_TIER_CATALOG.max20x.sessionTokenBudget).toBe(220_000);
  });

  it('encodes the doc §1.5 included monthly cents (credit pool)', () => {
    expect(PLATFORM_TIER_CATALOG.free.includedCents).toBe(0); // $0
    expect(PLATFORM_TIER_CATALOG.pro.includedCents).toBe(2_000); // $20
    expect(PLATFORM_TIER_CATALOG.max5x.includedCents).toBe(10_000); // $100
    expect(PLATFORM_TIER_CATALOG.max20x.includedCents).toBe(20_000); // $200
  });

  it('every tier has a 5-hour session window', () => {
    for (const t of PLATFORM_TIERS) {
      expect(PLATFORM_TIER_CATALOG[t].sessionWindowHours).toBe(5);
    }
  });

  it('Free excludes Opus and forbids overage; paid tiers allow overage', () => {
    expect(PLATFORM_TIER_CATALOG.free.allowedModelTiers).not.toContain('opus');
    expect(PLATFORM_TIER_CATALOG.free.overageAllowed).toBe(false);
    expect(PLATFORM_TIER_CATALOG.pro.overageAllowed).toBe(true);
    expect(PLATFORM_TIER_CATALOG.max20x.allowedModelTiers).toContain('opus');
  });

  it('weekly cap exceeds the single-session budget (sits on top)', () => {
    for (const t of PLATFORM_TIERS) {
      const spec = PLATFORM_TIER_CATALOG[t];
      expect(spec.weeklyTokenCap).toBeGreaterThan(spec.sessionTokenBudget);
    }
  });

  it('budget scales monotonically Free < Pro < Max5x < Max20x', () => {
    const order: PlatformTier[] = ['free', 'pro', 'max5x', 'max20x'];
    for (let i = 1; i < order.length; i++) {
      expect(
        PLATFORM_TIER_CATALOG[order[i]!].sessionTokenBudget,
      ).toBeGreaterThan(PLATFORM_TIER_CATALOG[order[i - 1]!].sessionTokenBudget);
    }
  });

  it('catalog is frozen (immutability)', () => {
    expect(Object.isFrozen(PLATFORM_TIER_CATALOG)).toBe(true);
    expect(Object.isFrozen(PLATFORM_TIER_CATALOG.pro)).toBe(true);
  });
});

describe('isPlatformTier / getTierSpec', () => {
  it('recognizes valid tiers and rejects others', () => {
    expect(isPlatformTier('pro')).toBe(true);
    expect(isPlatformTier('nope')).toBe(false);
    expect(isPlatformTier(42)).toBe(false);
    expect(isPlatformTier(undefined)).toBe(false);
  });

  it('throws fail-closed on an unknown tier', () => {
    expect(() => getTierSpec('garbage' as PlatformTier)).toThrow(/Unknown/);
  });
});

describe('tierToCaps — catalog DRIVES tenant_llm_budget_caps', () => {
  it('projects the cap-row shape (allowed_tiers/cap_cents/cap_tokens/fraction)', () => {
    const caps = tierToCaps('pro');
    expect(caps.allowedTiers).toEqual(
      PLATFORM_TIER_CATALOG.pro.allowedModelTiers,
    );
    expect(caps.capCents).toBe(PLATFORM_TIER_CATALOG.pro.includedCents);
    expect(caps.capTokens).toBe(PLATFORM_TIER_CATALOG.pro.includedTokenBudget);
    expect(caps.downgradeAtFraction).toBe(DEFAULT_DOWNGRADE_AT_FRACTION);
  });

  it('floors cap_cents/cap_tokens at 1 to satisfy the substrate CHECK (> 0)', () => {
    // Free has includedCents = 0; the 0272 CHECK requires cap_cents > 0.
    const caps = tierToCaps('free');
    expect(caps.capCents).toBeGreaterThanOrEqual(1);
    expect(caps.capTokens).toBeGreaterThanOrEqual(1);
  });

  it('maps every tier without throwing', () => {
    for (const t of PLATFORM_TIERS) {
      const caps = tierToCaps(t);
      expect(caps.allowedTiers.length).toBeGreaterThanOrEqual(1);
      expect(caps.capCents).toBeGreaterThan(0);
      expect(caps.capTokens).toBeGreaterThan(0);
    }
  });
});
