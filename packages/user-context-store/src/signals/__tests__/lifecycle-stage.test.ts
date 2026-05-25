import { describe, expect, it } from 'vitest';
import { lifecycleStage } from '../lifecycle-stage.js';
import type { TenantProfile, RecentActivity } from '../../types.js';

function activity(partial: Partial<RecentActivity> = {}): RecentActivity {
  return {
    windowDays: 14,
    loginCount: 5,
    pagesViewed: 20,
    featuresTouched: ['page.dashboard'],
    searchQueries: [],
    lastInteractionAt: new Date().toISOString(),
    ...partial,
  };
}

function tenantProfile(partial: Partial<TenantProfile> = {}): TenantProfile {
  return {
    identity: { userId: 'u', tenantId: 't' },
    ...partial,
  };
}

describe('lifecycleStage', () => {
  it('returns onboarding when lease is <60 days old', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
      endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300).toISOString(),
    };
    const stage = lifecycleStage({
      profile: tenantProfile({ currentLease: lease }),
      activity: activity(),
    });
    expect(stage).toBe('onboarding');
  });

  it('returns active for steady-state long-term lease', () => {
    const lease = {
      leaseId: 'l1',
      leaseNumber: 'LSE-1',
      status: 'active',
      startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 200).toISOString(),
      endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300).toISOString(),
    };
    const stage = lifecycleStage({
      profile: tenantProfile({ currentLease: lease }),
      activity: activity(),
    });
    expect(stage).toBe('active');
  });

  it('returns at_risk when recent payments are late', () => {
    const profile = tenantProfile({
      paymentHistory24m: [
        { month: '2026-05', totalCharged: 50000, totalPaid: 0, balance: 50000, daysLate: 20, currency: 'KES' },
      ],
    });
    const stage = lifecycleStage({
      profile,
      activity: activity(),
    });
    expect(stage).toBe('at_risk');
  });

  it('returns churned when lease ended and silent 90+ days', () => {
    const profile = tenantProfile({
      currentLease: {
        leaseId: 'l1',
        leaseNumber: 'LSE-1',
        status: 'expired',
        endDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 200).toISOString(),
      },
    });
    const stage = lifecycleStage({
      profile,
      activity: activity({
        lastInteractionAt: new Date(
          Date.now() - 1000 * 60 * 60 * 24 * 120,
        ).toISOString(),
      }),
    });
    expect(stage).toBe('churned');
  });

  it('returns reactivating when sparse new activity after long silence', () => {
    const stage = lifecycleStage({
      profile: tenantProfile(),
      activity: {
        windowDays: 14,
        loginCount: 1,
        pagesViewed: 1,
        featuresTouched: [],
        searchQueries: [],
        lastInteractionAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      },
    });
    expect(stage).toBe('reactivating');
  });
});
