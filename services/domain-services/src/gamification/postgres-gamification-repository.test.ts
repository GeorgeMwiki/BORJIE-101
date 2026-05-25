/**
 * Unit tests for PostgresGamificationRepository using in-memory Drizzle-like fake.
 */
import { describe, it, expect } from 'vitest';
import {
  PostgresGamificationRepository,
  type DrizzleLike,
} from './postgres-gamification-repository.js';
import type { RewardPolicy } from './reward-policy.js';
import type { TenantGamificationProfile } from './tenant-gamification-profile.js';
import type { RewardEvent } from './reward-event.js';

interface Row {
  readonly [k: string]: unknown;
}

function makeFake(): DrizzleLike & { all: Map<unknown, Row[]> } {
  const all = new Map<unknown, Row[]>();
  function bucket(t: unknown): Row[] {
    let arr = all.get(t);
    if (!arr) {
      arr = [];
      all.set(t, arr);
    }
    return arr;
  }

  const db: DrizzleLike & { all: Map<unknown, Row[]> } = {
    all,
    async transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T> {
      return fn(db);
    },
    insert(t: unknown) {
      return {
        values(values: unknown) {
          const rows = Array.isArray(values) ? values : [values];
          bucket(t).push(...(rows as Row[]));
          return {
            async onConflictDoNothing() {},
            async returning() {
              return rows;
            },
          };
        },
      };
    },
    select(_cols?: Record<string, unknown>) {
      return {
        from(t: unknown) {
          let rows = bucket(t);
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows.slice(0, 1));
                },
                orderBy() {
                  const self = this as unknown as {
                    limit: (n: number) => Promise<Row[]>;
                  };
                  return {
                    ...self,
                    async limit(n: number) {
                      return rows.slice(0, n);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    update(t: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            async where() {
              const arr = bucket(t);
              for (let i = 0; i < arr.length; i++) {
                arr[i] = { ...arr[i], ...patch };
              }
            },
          };
        },
      };
    },
  };
  return db;
}

describe('PostgresGamificationRepository', () => {
  const tenantId = 'tenant-1';
  const customerId = 'customer-1';

  it('appendEvent then findEventByDedupKey returns the event', async () => {
    const db = makeFake();
    const repo = new PostgresGamificationRepository(db);
    const event: RewardEvent = {
      id: 'ev-1',
      tenantId,
      customerId,
      eventType: 'payment_posted',
      policyId: 'p-1',
      scoreDelta: 10,
      creditDeltaMinor: 0,
      cashbackDeltaMinor: 0,
      currency: 'KES',
      paymentId: 'pay-1',
      invoiceId: null,
      fromTier: null,
      toTier: null,
      payload: {},
      dedupKey: 'evalPaymentPosted:tenant-1:pay-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.appendEvent(event);
    const found = await repo.findEventByDedupKey(tenantId, event.dedupKey!);
    expect(found?.id).toBe('ev-1');
    expect(found?.scoreDelta).toBe(10);
  });

  it('appendProfile + getCurrentProfile returns the profile', async () => {
    const db = makeFake();
    const repo = new PostgresGamificationRepository(db);
    const profile: TenantGamificationProfile = {
      id: 'pr-1',
      tenantId,
      customerId,
      score: 100,
      tier: 'silver',
      streakMonths: 1,
      longestStreakMonths: 1,
      totalOnTimePayments: 1,
      totalLatePayments: 0,
      earlyPayCreditBalanceMinor: 0,
      earlyPayCreditCurrency: 'KES',
      cashbackMonthToDateMinor: 0,
      cashbackLifetimeMinor: 0,
      asOf: '2026-01-01T00:00:00.000Z',
      sourceEventId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.appendProfile(profile);
    const found = await repo.getCurrentProfile(tenantId, customerId);
    expect(found?.score).toBe(100);
    expect(found?.tier).toBe('silver');
  });

  it('upsertPolicy stores the policy and getActivePolicy returns it', async () => {
    const db = makeFake();
    const repo = new PostgresGamificationRepository(db);
    const policy: RewardPolicy = {
      id: 'pol-1',
      tenantId,
      version: 1,
      active: true,
      onTimePoints: 10,
      earlyPaymentBonusPoints: 5,
      latePenaltyPoints: -15,
      streakBonusPoints: 2,
      bronzeThreshold: 0,
      silverThreshold: 100,
      goldThreshold: 300,
      platinumThreshold: 600,
      earlyPayDiscountBps: 0,
      earlyPayMinDaysBefore: 3,
      earlyPayMaxCreditMinor: 0,
      lateFeeBps: 0,
      lateFeeGraceDays: 3,
      lateFeeMaxMinor: 0,
      cashbackEnabled: false,
      cashbackBps: 0,
      cashbackMonthlyCapMinor: 0,
      extra: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    };
    await repo.upsertPolicy(policy);
    const found = await repo.getActivePolicy(tenantId);
    expect(found?.id).toBe('pol-1');
    expect(found?.onTimePoints).toBe(10);
  });
});
