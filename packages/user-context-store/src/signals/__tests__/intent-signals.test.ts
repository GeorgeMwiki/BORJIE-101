import { describe, expect, it } from 'vitest';
import { intentSignals } from '../intent-signals.js';
import type { TenantProfile, RecentActivity, LifecycleStage } from '../../types.js';

function activity(featuresTouched: string[] = [], lastDays = 1): RecentActivity {
  return {
    windowDays: 14,
    loginCount: 1,
    pagesViewed: 1,
    featuresTouched,
    searchQueries: [],
    lastInteractionAt: new Date(Date.now() - lastDays * 86400 * 1000).toISOString(),
  };
}

function profile(): TenantProfile {
  return {
    identity: { userId: 'u', tenantId: 't' },
  };
}

describe('intentSignals', () => {
  it('produces lease.review intent when page.lease touched', () => {
    const intents = intentSignals({
      activity: activity(['page.lease']),
      lifecycle: 'active' as LifecycleStage,
      profile: profile(),
    });
    expect(intents.some((i) => i.kind === 'lease.review')).toBe(true);
  });

  it('produces churn.risk intent when lifecycle is at_risk', () => {
    const intents = intentSignals({
      activity: activity(),
      lifecycle: 'at_risk',
      profile: profile(),
    });
    expect(intents.some((i) => i.kind === 'churn.risk')).toBe(true);
  });

  it('produces onboarding.guide when lifecycle is onboarding', () => {
    const intents = intentSignals({
      activity: activity(),
      lifecycle: 'onboarding',
      profile: profile(),
    });
    expect(intents.some((i) => i.kind === 'onboarding.guide')).toBe(true);
  });

  it('produces lease.decision_window when lease ends in <90d', () => {
    const intents = intentSignals({
      activity: activity(),
      lifecycle: 'active',
      profile: {
        ...profile(),
        currentLease: {
          leaseId: 'l1',
          leaseNumber: 'LSE-1',
          status: 'active',
          endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 45).toISOString(),
        },
      },
    });
    expect(intents.some((i) => i.kind === 'lease.decision_window')).toBe(true);
  });

  it('does not produce search.active when few searches', () => {
    const intents = intentSignals({
      activity: activity(),
      lifecycle: 'active',
      profile: profile(),
    });
    expect(intents.some((i) => i.kind === 'search.active')).toBe(false);
  });

  it('produces search.active when 3+ searches', () => {
    const intents = intentSignals({
      activity: {
        windowDays: 14,
        loginCount: 1,
        pagesViewed: 1,
        featuresTouched: [],
        searchQueries: [
          { query: 'a', timestamp: '2026-05-01' },
          { query: 'b', timestamp: '2026-05-02' },
          { query: 'c', timestamp: '2026-05-03' },
        ],
      },
      lifecycle: 'active',
      profile: profile(),
    });
    expect(intents.some((i) => i.kind === 'search.active')).toBe(true);
  });
});
