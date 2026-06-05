/**
 * Awareness scopes — full helper coverage.
 *
 * The kernel-units suite covers `contains`, `cohortMinK`, and the basic
 * `isTierCompatibleWithScope` paths. This file fills the remaining
 * gaps: tierRank, commonAncestor, locusPhrase, and the full
 * cohort-min-k table per tier.
 */

import { describe, it, expect } from 'vitest';
import {
  tierRank,
  contains,
  commonAncestor,
  cohortMinK,
  isTierCompatibleWithScope,
  locusPhrase,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't',
  actorUserId: 'u',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};
const PLATFORM_SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u',
  roles: ['platform-admin'],
  personaId: 'platform-sovereign',
};

describe('tierRank', () => {
  it('assigns tenant the lowest rank', () => {
    expect(tierRank('tenant')).toBe(0);
  });

  it('assigns industry the highest rank', () => {
    expect(tierRank('industry')).toBe(7);
  });

  it('produces a strictly monotone ladder tenant → industry', () => {
    const order = ['tenant', 'offtake', 'pit', 'zone', 'site', 'portfolio', 'org', 'industry'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(tierRank(order[i]!)).toBeGreaterThan(tierRank(order[i - 1]!));
    }
  });
});

describe('commonAncestor', () => {
  it('returns the larger of two tiers', () => {
    expect(commonAncestor('offtake', 'site')).toBe('site');
    expect(commonAncestor('industry', 'tenant')).toBe('industry');
  });

  it('is reflexive — same tier returns same tier', () => {
    expect(commonAncestor('zone', 'zone')).toBe('zone');
  });

  it('is order-independent', () => {
    expect(commonAncestor('pit', 'org')).toBe(commonAncestor('org', 'pit'));
  });
});

describe('isTierCompatibleWithScope', () => {
  it('passes tenant scope at every non-industry tier', () => {
    for (const tier of ['tenant', 'offtake', 'pit', 'zone', 'site', 'portfolio', 'org'] as const) {
      expect(isTierCompatibleWithScope(tier, TENANT_SCOPE).ok).toBe(true);
    }
  });

  it('rejects platform scope at any tier other than industry', () => {
    for (const tier of ['tenant', 'offtake', 'pit', 'zone', 'site', 'portfolio', 'org'] as const) {
      const v = isTierCompatibleWithScope(tier, PLATFORM_SCOPE);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.reason).toMatch(/platform scope/);
      }
    }
  });

  it('passes platform scope at tier=industry', () => {
    expect(isTierCompatibleWithScope('industry', PLATFORM_SCOPE).ok).toBe(true);
  });

  it('rejects tenant scope at tier=industry', () => {
    const v = isTierCompatibleWithScope('industry', TENANT_SCOPE);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/cannot reach industry/);
    }
  });
});

describe('locusPhrase', () => {
  it('returns the platform-observation phrase for any platform-scope tier', () => {
    expect(locusPhrase('industry', PLATFORM_SCOPE)).toMatch(/observing itself/);
    // Even non-industry tier returns the platform phrase when scope is platform.
    expect(locusPhrase('tenant', PLATFORM_SCOPE)).toMatch(/observing itself/);
  });

  it('returns tenant-tier phrase for tenant scope at tenant tier', () => {
    expect(locusPhrase('tenant', TENANT_SCOPE)).toMatch(/concierge/);
  });

  it('returns offtake tier phrase', () => {
    expect(locusPhrase('offtake', TENANT_SCOPE)).toMatch(/offtake/);
  });

  it('returns pit tier phrase', () => {
    expect(locusPhrase('pit', TENANT_SCOPE)).toMatch(/pit/);
  });

  it('returns zone tier phrase', () => {
    expect(locusPhrase('zone', TENANT_SCOPE)).toMatch(/zone/);
  });

  it('returns site tier phrase', () => {
    expect(locusPhrase('site', TENANT_SCOPE)).toMatch(/site/);
  });

  it('returns portfolio tier phrase', () => {
    expect(locusPhrase('portfolio', TENANT_SCOPE)).toMatch(/portfolio/);
  });

  it('returns org tier phrase', () => {
    expect(locusPhrase('org', TENANT_SCOPE)).toMatch(/organisation/);
  });
});

describe('cohortMinK — full table', () => {
  it('offtake/tenant tier requires k>=5', () => {
    expect(cohortMinK('tenant')).toBe(5);
    expect(cohortMinK('offtake')).toBe(5);
  });

  it('pit/zone tier requires k>=7', () => {
    expect(cohortMinK('pit')).toBe(7);
    expect(cohortMinK('zone')).toBe(7);
  });

  it('site tier requires k>=10', () => {
    expect(cohortMinK('site')).toBe(10);
  });

  it('portfolio tier requires k>=15', () => {
    expect(cohortMinK('portfolio')).toBe(15);
  });

  it('org tier requires k>=20', () => {
    expect(cohortMinK('org')).toBe(20);
  });

  it('industry tier requires k>=25 — strongest', () => {
    expect(cohortMinK('industry')).toBe(25);
  });

  it('contains is reflexive at every tier', () => {
    for (const tier of ['tenant', 'offtake', 'pit', 'zone', 'site', 'portfolio', 'org', 'industry'] as const) {
      expect(contains(tier, tier)).toBe(true);
    }
  });
});
