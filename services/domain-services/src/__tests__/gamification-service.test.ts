import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createGamificationService,
  GamificationError,
  type GamificationRepository,
  type CashbackQueuePort,
  type PaymentPostedEvent,
} from '../gamification';
import type { RewardPolicy, RewardTier } from '../gamification';
import type { TenantGamificationProfile, RewardEvent } from '../gamification';
import { DEFAULT_REWARD_POLICY } from '../gamification';

function makeRepo(): {
  repo: GamificationRepository;
  policies: RewardPolicy[];
  profiles: TenantGamificationProfile[];
  events: RewardEvent[];
} {
  const policies: RewardPolicy[] = [];
  const profiles: TenantGamificationProfile[] = [];
  const events: RewardEvent[] = [];

  const repo: GamificationRepository = {
    async getActivePolicy(tenantId) {
      return (
        policies.filter((p) => p.tenantId === tenantId && p.active).slice(-1)[0] ??
        null
      );
    },
    async upsertPolicy(policy) {
      policies.push({ ...policy });
      return policy;
    },
    async getCurrentProfile(tenantId, customerId) {
      return (
        profiles
          .filter(
            (p) => p.tenantId === tenantId && p.customerId === customerId
          )
          .slice(-1)[0] ?? null
      );
    },
    async appendProfile(profile) {
      profiles.push({ ...profile });
    },
    async appendEvent(event) {
      events.push({ ...event });
    },
    async findEventByDedupKey(tenantId, dedupKey) {
      return (
        events.find(
          (e) => e.tenantId === tenantId && e.dedupKey === dedupKey
        ) ?? null
      );
    },
  };

  return { repo, policies, profiles, events };
}

function makePolicy(
  tenantId: string,
  overrides: Partial<RewardPolicy> = {}
): RewardPolicy {
  return {
    ...DEFAULT_REWARD_POLICY,
    id: `pol-${tenantId}`,
    tenantId,
    createdAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GamificationService', () => {
  let mocks: ReturnType<typeof makeRepo>;
  let service: ReturnType<typeof createGamificationService>;
  let counter = 0;

  beforeEach(() => {
    mocks = makeRepo();
    counter = 0;
    service = createGamificationService({
      repo: mocks.repo,
      now: () => new Date('2026-02-01T10:00:00Z'),
      idGenerator: () => `id-${++counter}`,
    });
  });

  describe('policy management', () => {
    it('creates default policy when none exists', async () => {
      const policy = await service.getOrCreatePolicy('t1', 'admin');
      expect(policy.tenantId).toBe('t1');
      expect(policy.version).toBe(1);
    });

    it('updatePolicy increments version (append-only)', async () => {
      await service.getOrCreatePolicy('t1', 'admin');
      const v2 = await service.updatePolicy(
        't1',
        { onTimePoints: 25 },
        'admin'
      );
      expect(v2.version).toBe(2);
      expect(v2.onTimePoints).toBe(25);
    });

    it('throws on cross-tenant policy access (via updatePolicy for other tenant)', async () => {
      await service.getOrCreatePolicy('t1', 'admin');
      // t2 has no policy — must throw POLICY_NOT_FOUND
      await expect(
        service.updatePolicy('t2', { onTimePoints: 1 }, 'u')
      ).rejects.toThrow(GamificationError);
    });
  });

  describe('evaluateOnPaymentPosted', () => {
    it('awards early-payment bonus and grants credit', async () => {
      await mocks.repo.upsertPolicy(
        makePolicy('t1', {
          earlyPayDiscountBps: 200, // 2%
          earlyPayMaxCreditMinor: 10_000,
        })
      );

      const event: PaymentPostedEvent = {
        tenantId: 't1',
        customerId: 'c1',
        paymentId: 'pay-1',
        invoiceId: 'inv-1',
        amountMinorUnits: 200_000,
        currency: 'TZS',
        paidAt: new Date('2026-01-01'),
        dueDate: new Date('2026-01-15'),
      };
      const result = await service.evaluateOnPaymentPosted(event);
      expect(result.earlyPayCreditGranted).toBe(4_000);
      expect(result.profile.earlyPayCreditBalanceMinor).toBe(4_000);
      const kinds = result.events.map((e) => e.eventType);
      expect(kinds).toContain('payment_posted');
      expect(kinds).toContain('early_payment');
      expect(kinds).toContain('early_pay_credit_granted');
    });

    it('penalizes late payment and resets streak', async () => {
      await mocks.repo.upsertPolicy(makePolicy('t1'));

      const event: PaymentPostedEvent = {
        tenantId: 't1',
        customerId: 'c1',
        paymentId: 'pay-late',
        amountMinorUnits: 100_000,
        currency: 'TZS',
        paidAt: new Date('2026-01-20'),
        dueDate: new Date('2026-01-10'),
      };
      const result = await service.evaluateOnPaymentPosted(event);
      const kinds = result.events.map((e) => e.eventType);
      expect(kinds).toContain('late_payment');
      expect(kinds).toContain('streak_broken');
      expect(result.profile.streakMonths).toBe(0);
      expect(result.profile.totalLatePayments).toBe(1);
    });

    it('is idempotent on replay (dedupKey)', async () => {
      await mocks.repo.upsertPolicy(makePolicy('t1'));
      const event: PaymentPostedEvent = {
        tenantId: 't1',
        customerId: 'c1',
        paymentId: 'pay-dup',
        amountMinorUnits: 100,
        currency: 'TZS',
        paidAt: new Date('2026-01-15'),
        dueDate: new Date('2026-01-15'),
      };
      const r1 = await service.evaluateOnPaymentPosted(event);
      const eventCountBefore = mocks.events.length;
      const r2 = await service.evaluateOnPaymentPosted(event);
      // Second call should not append new events
      expect(mocks.events.length).toBe(eventCountBefore);
      expect(r2.earlyPayCreditGranted).toBe(0);
    });

    it('queues cashback when enabled', async () => {
      await mocks.repo.upsertPolicy(
        makePolicy('t1', {
          cashbackEnabled: true,
          cashbackBps: 100, // 1%
          cashbackProvider: 'mpesa_b2c',
        })
      );
      const queue: CashbackQueuePort = { enqueue: vi.fn() };
      const svc = createGamificationService({
        repo: mocks.repo,
        cashbackQueue: queue,
        now: () => new Date('2026-02-01T10:00:00Z'),
        idGenerator: () => `id-${++counter}`,
      });
      const result = await svc.evaluateOnPaymentPosted({
        tenantId: 't1',
        customerId: 'c1',
        paymentId: 'pay-cb',
        amountMinorUnits: 500_000,
        currency: 'TZS',
        paidAt: new Date('2026-01-01'),
        dueDate: new Date('2026-01-10'),
      });
      expect(result.cashbackQueued).toBe(true);
      expect(queue.enqueue).toHaveBeenCalled();
    });

    it('rejects cross-tenant profile access', async () => {
      await mocks.repo.upsertPolicy(makePolicy('t1'));
      // Manually plant a profile with wrong tenantId
      mocks.profiles.push({
        id: 'leak',
        tenantId: 't1',
        customerId: 'c1',
        score: 0,
        tier: 'bronze',
        streakMonths: 0,
        longestStreakMonths: 0,
        totalOnTimePayments: 0,
        totalLatePayments: 0,
        earlyPayCreditBalanceMinor: 0,
        earlyPayCreditCurrency: null,
        cashbackMonthToDateMinor: 0,
        cashbackLifetimeMinor: 0,
        asOf: '2026-01-01T00:00:00Z',
        sourceEventId: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      // Override repo to return wrong tenant
      const brokenRepo: GamificationRepository = {
        ...mocks.repo,
        async getCurrentProfile() {
          return {
            ...mocks.profiles[0],
            tenantId: 'other-tenant',
          };
        },
      };
      const svc = createGamificationService({
        repo: brokenRepo,
        now: () => new Date('2026-02-01T10:00:00Z'),
      });
      await expect(
        svc.evaluateOnPaymentPosted({
          tenantId: 't1',
          customerId: 'c1',
          paymentId: 'pay-xs',
          amountMinorUnits: 1000,
          currency: 'TZS',
          paidAt: new Date('2026-01-15'),
          dueDate: new Date('2026-01-15'),
        })
      ).rejects.toThrow(GamificationError);
    });
  });

  describe('applyLateFee', () => {
    it('skips when within grace', async () => {
      await mocks.repo.upsertPolicy(
        makePolicy('t1', { lateFeeBps: 500, lateFeeGraceDays: 5 })
      );
      const r = await service.applyLateFee({
        tenantId: 't1',
        customerId: 'c1',
        invoiceId: 'inv-1',
        invoiceAmountMinor: 100_000,
        dueDate: new Date('2026-02-01'),
        asOf: new Date('2026-02-03'),
        currency: 'TZS',
      });
      expect(r.feeMinor).toBe(0);
    });

    it('computes capped fee past grace', async () => {
      await mocks.repo.upsertPolicy(
        makePolicy('t1', {
          lateFeeBps: 500, // 5%
          lateFeeGraceDays: 3,
          lateFeeMaxMinor: 2_000,
        })
      );
      const r = await service.applyLateFee({
        tenantId: 't1',
        customerId: 'c1',
        invoiceId: 'inv-1',
        invoiceAmountMinor: 100_000,
        dueDate: new Date('2026-01-15'),
        asOf: new Date('2026-01-30'),
        currency: 'TZS',
      });
      expect(r.feeMinor).toBe(2_000);
    });
  });

  describe('updateTier', () => {
    it('upgrades tier when score crosses threshold', async () => {
      await mocks.repo.upsertPolicy(makePolicy('t1'));
      mocks.profiles.push({
        id: 'seed',
        tenantId: 't1',
        customerId: 'c1',
        score: 350,
        tier: 'bronze',
        streakMonths: 3,
        longestStreakMonths: 3,
        totalOnTimePayments: 0,
        totalLatePayments: 0,
        earlyPayCreditBalanceMinor: 0,
        earlyPayCreditCurrency: null,
        cashbackMonthToDateMinor: 0,
        cashbackLifetimeMinor: 0,
        asOf: '2026-01-01T00:00:00Z',
        sourceEventId: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      const next = await service.updateTier('t1', 'c1');
      expect(next.tier).toBe('gold');
      const tierEv = mocks.events.find((e) => e.eventType === 'tier_upgraded');
      expect(tierEv).toBeDefined();
    });
  });
});
