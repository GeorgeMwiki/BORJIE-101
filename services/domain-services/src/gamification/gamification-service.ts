/**
 * Gamification service (NEW 9 — MISSING_FEATURES_DESIGN §9)
 *
 * Evaluates PaymentPostedEvent and produces:
 *   Layer 1 — score/tier delta (reward_events + new profile snapshot)
 *   Layer 2 — early-pay credit bucket (off-ledger; redeemed later via
 *             arrears-service proposal — never direct ledger mutation)
 *   Layer 3 — optional MNO cashback hook (enqueues B2C payout task;
 *             no credit to ledger)
 *
 * Cross-tenant isolation: every method requires tenantId and will
 * throw `GamificationError` with code 'TENANT_MISMATCH' if a record
 * from a different tenant is encountered.
 *
 * Pure/functional design — all outputs are NEW objects.
 */
import { randomUUID } from 'crypto';
import {
  DEFAULT_REWARD_POLICY,
  tierForScore,
  type RewardPolicy,
  type RewardTier,
} from './reward-policy.js';
import {
  initialProfile,
  type TenantGamificationProfile,
} from './tenant-gamification-profile.js';
import type { RewardEvent, RewardEventType } from './reward-event.js';

// ----------------------------------------------------------------------------
// External ports
// ----------------------------------------------------------------------------

export interface PaymentPostedEvent {
  readonly tenantId: string;
  readonly customerId: string;
  readonly paymentId: string;
  readonly invoiceId?: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly paidAt: Date;
  readonly dueDate?: Date;
}

export interface GamificationRepository {
  getActivePolicy(tenantId: string): Promise<RewardPolicy | null>;
  upsertPolicy(policy: RewardPolicy): Promise<RewardPolicy>;
  getCurrentProfile(
    tenantId: string,
    customerId: string
  ): Promise<TenantGamificationProfile | null>;
  appendProfile(profile: TenantGamificationProfile): Promise<void>;
  appendEvent(event: RewardEvent): Promise<void>;
  findEventByDedupKey(
    tenantId: string,
    dedupKey: string
  ): Promise<RewardEvent | null>;
}

export interface CashbackQueuePort {
  enqueue(req: {
    tenantId: string;
    customerId: string;
    amountMinorUnits: number;
    currency: string;
    provider: string;
    payoutReference: string;
  }): Promise<void>;
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

export class GamificationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TENANT_MISMATCH'
      | 'POLICY_NOT_FOUND'
      | 'VALIDATION'
      | 'DUPLICATE_EVENT'
  ) {
    super(message);
    this.name = 'GamificationError';
  }
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export interface EvaluationResult {
  readonly events: readonly RewardEvent[];
  readonly profile: TenantGamificationProfile;
  readonly cashbackQueued: boolean;
  readonly earlyPayCreditGranted: number;
}

export interface GamificationServiceDeps {
  readonly repo: GamificationRepository;
  readonly cashbackQueue?: CashbackQueuePort;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface GamificationService {
  getOrCreatePolicy(
    tenantId: string,
    createdBy: string
  ): Promise<RewardPolicy>;
  updatePolicy(
    tenantId: string,
    patch: Partial<RewardPolicy>,
    updatedBy: string
  ): Promise<RewardPolicy>;
  getCustomerState(
    tenantId: string,
    customerId: string
  ): Promise<TenantGamificationProfile>;

  evaluateOnPaymentPosted(
    event: PaymentPostedEvent
  ): Promise<EvaluationResult>;

  awardStreak(args: {
    tenantId: string;
    customerId: string;
    months: number;
  }): Promise<TenantGamificationProfile>;

  applyEarlyPayDiscount(args: {
    tenantId: string;
    customerId: string;
    invoiceId: string;
    invoiceAmountMinor: number;
    dueDate: Date;
    paidAt: Date;
    currency: string;
  }): Promise<{ creditGrantedMinor: number; event?: RewardEvent }>;

  applyLateFee(args: {
    tenantId: string;
    customerId: string;
    invoiceId: string;
    invoiceAmountMinor: number;
    dueDate: Date;
    asOf: Date;
    currency: string;
  }): Promise<{ feeMinor: number; event?: RewardEvent }>;

  updateTier(
    tenantId: string,
    customerId: string
  ): Promise<TenantGamificationProfile>;
}

export function createGamificationService(
  deps: GamificationServiceDeps
): GamificationService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomUUID());

  async function loadPolicy(tenantId: string): Promise<RewardPolicy> {
    const existing = await deps.repo.getActivePolicy(tenantId);
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new GamificationError(
          'policy tenant mismatch',
          'TENANT_MISMATCH'
        );
      }
      return existing;
    }
    throw new GamificationError(
      `no active reward policy for tenant ${tenantId}`,
      'POLICY_NOT_FOUND'
    );
  }

  async function loadOrInitProfile(
    tenantId: string,
    customerId: string,
    currency?: string
  ): Promise<TenantGamificationProfile> {
    const existing = await deps.repo.getCurrentProfile(tenantId, customerId);
    if (existing) {
      if (
        existing.tenantId !== tenantId ||
        existing.customerId !== customerId
      ) {
        throw new GamificationError(
          'profile tenant/customer mismatch',
          'TENANT_MISMATCH'
        );
      }
      return existing;
    }
    return initialProfile({
      id: genId(),
      tenantId,
      customerId,
      currency,
      now: now(),
    });
  }

  function applyDelta(
    profile: TenantGamificationProfile,
    delta: {
      scoreDelta?: number;
      streakBump?: number; // 1, -1, or a reset to 0
      streakReset?: boolean;
      creditDeltaMinor?: number;
      cashbackDeltaMinor?: number;
      onTimeBump?: number;
      lateBump?: number;
      policy: RewardPolicy;
      currency?: string;
      sourceEventId?: string;
    }
  ): TenantGamificationProfile {
    const nowIso = now().toISOString();
    const newScore = profile.score + (delta.scoreDelta ?? 0);
    const newStreak = delta.streakReset
      ? 0
      : profile.streakMonths + (delta.streakBump ?? 0);
    const newLongest = Math.max(profile.longestStreakMonths, newStreak);
    const newTier = tierForScore(delta.policy, newScore);

    return {
      ...profile,
      id: genId(),
      score: newScore,
      tier: newTier,
      streakMonths: Math.max(0, newStreak),
      longestStreakMonths: newLongest,
      totalOnTimePayments:
        profile.totalOnTimePayments + (delta.onTimeBump ?? 0),
      totalLatePayments: profile.totalLatePayments + (delta.lateBump ?? 0),
      earlyPayCreditBalanceMinor:
        profile.earlyPayCreditBalanceMinor + (delta.creditDeltaMinor ?? 0),
      earlyPayCreditCurrency:
        profile.earlyPayCreditCurrency ?? delta.currency ?? null,
      cashbackMonthToDateMinor:
        profile.cashbackMonthToDateMinor + (delta.cashbackDeltaMinor ?? 0),
      cashbackLifetimeMinor:
        profile.cashbackLifetimeMinor + (delta.cashbackDeltaMinor ?? 0),
      asOf: nowIso,
      sourceEventId: delta.sourceEventId ?? profile.sourceEventId,
      createdAt: nowIso,
    };
  }

  function buildEvent(fields: {
    tenantId: string;
    customerId: string;
    eventType: RewardEventType;
    policyId: string;
    scoreDelta?: number;
    creditDeltaMinor?: number;
    cashbackDeltaMinor?: number;
    currency?: string;
    paymentId?: string;
    invoiceId?: string;
    fromTier?: RewardTier;
    toTier?: RewardTier;
    payload?: Record<string, unknown>;
    dedupKey?: string;
    occurredAt: Date;
  }): RewardEvent {
    const iso = fields.occurredAt.toISOString();
    return {
      id: genId(),
      tenantId: fields.tenantId,
      customerId: fields.customerId,
      eventType: fields.eventType,
      policyId: fields.policyId,
      scoreDelta: fields.scoreDelta ?? 0,
      creditDeltaMinor: fields.creditDeltaMinor ?? 0,
      cashbackDeltaMinor: fields.cashbackDeltaMinor ?? 0,
      currency: fields.currency ?? null,
      paymentId: fields.paymentId ?? null,
      invoiceId: fields.invoiceId ?? null,
      fromTier: fields.fromTier ?? null,
      toTier: fields.toTier ?? null,
      payload: fields.payload ?? {},
      dedupKey: fields.dedupKey ?? null,
      occurredAt: iso,
      createdAt: iso,
    };
  }

  function daysBetween(earlier: Date, later: Date): number {
    return Math.floor(
      (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000)
    );
  }

  return {
    async getOrCreatePolicy(tenantId, createdBy) {
      const existing = await deps.repo.getActivePolicy(tenantId);
      if (existing) return existing;

      const nowIso = now().toISOString();
      const policy: RewardPolicy = {
        ...DEFAULT_REWARD_POLICY,
        id: genId(),
        tenantId,
        createdAt: nowIso,
        createdBy,
        effectiveFrom: nowIso,
      };
      return deps.repo.upsertPolicy(policy);
    },

    async updatePolicy(tenantId, patch, updatedBy) {
      const current = await loadPolicy(tenantId);
      const nowIso = now().toISOString();
      const next: RewardPolicy = {
        ...current,
        ...patch,
        id: genId(),
        tenantId, // never change
        version: current.version + 1,
        createdAt: nowIso,
        createdBy: updatedBy,
        effectiveFrom: nowIso,
      };
      return deps.repo.upsertPolicy(next);
    },

    async getCustomerState(tenantId, customerId) {
      return loadOrInitProfile(tenantId, customerId);
    },

    async evaluateOnPaymentPosted(event) {
      if (!event.tenantId || !event.customerId || !event.paymentId) {
        throw new GamificationError(
          'event missing tenantId/customerId/paymentId',
          'VALIDATION'
        );
      }
      const dedupKey = `evalPaymentPosted:${event.tenantId}:${event.paymentId}`;
      const existing = await deps.repo.findEventByDedupKey(
        event.tenantId,
        dedupKey
      );
      if (existing) {
        // Already processed — return idempotently.
        const profile = await loadOrInitProfile(
          event.tenantId,
          event.customerId,
          event.currency
        );
        return {
          events: [existing],
          profile,
          cashbackQueued: false,
          earlyPayCreditGranted: 0,
        };
      }

      const policy = await loadPolicy(event.tenantId);
      const profile = await loadOrInitProfile(
        event.tenantId,
        event.customerId,
        event.currency
      );

      const events: RewardEvent[] = [];
      let scoreDelta = 0;
      let creditDelta = 0;
      let cashbackDelta = 0;
      let earlyPayCreditGranted = 0;
      let onTimeBump = 0;
      let lateBump = 0;
      let streakBump = 0;
      let streakReset = false;

      const paymentPostedEv = buildEvent({
        tenantId: event.tenantId,
        customerId: event.customerId,
        eventType: 'payment_posted',
        policyId: policy.id,
        paymentId: event.paymentId,
        invoiceId: event.invoiceId,
        currency: event.currency,
        dedupKey,
        occurredAt: event.paidAt,
        payload: { amountMinorUnits: event.amountMinorUnits },
      });
      events.push(paymentPostedEv);

      if (event.dueDate) {
        const diffDays = daysBetween(event.paidAt, event.dueDate); // positive = early
        if (diffDays >= policy.earlyPayMinDaysBefore) {
          scoreDelta += policy.onTimePoints + policy.earlyPaymentBonusPoints;
          onTimeBump += 1;
          streakBump += 1;
          events.push(
            buildEvent({
              tenantId: event.tenantId,
              customerId: event.customerId,
              eventType: 'early_payment',
              policyId: policy.id,
              scoreDelta:
                policy.onTimePoints + policy.earlyPaymentBonusPoints,
              paymentId: event.paymentId,
              invoiceId: event.invoiceId,
              currency: event.currency,
              occurredAt: event.paidAt,
              payload: { daysEarly: diffDays },
            })
          );

          if (policy.earlyPayDiscountBps > 0 && event.invoiceId) {
            const discount = Math.floor(
              (event.amountMinorUnits * policy.earlyPayDiscountBps) / 10000
            );
            const capped =
              policy.earlyPayMaxCreditMinor > 0
                ? Math.min(discount, policy.earlyPayMaxCreditMinor)
                : discount;
            if (capped > 0) {
              creditDelta += capped;
              earlyPayCreditGranted = capped;
              events.push(
                buildEvent({
                  tenantId: event.tenantId,
                  customerId: event.customerId,
                  eventType: 'early_pay_credit_granted',
                  policyId: policy.id,
                  creditDeltaMinor: capped,
                  currency: event.currency,
                  paymentId: event.paymentId,
                  invoiceId: event.invoiceId,
                  occurredAt: event.paidAt,
                  payload: { discountBps: policy.earlyPayDiscountBps },
                })
              );
            }
          }
        } else if (diffDays >= 0) {
          // on time (same day or within the grace window, just not
          // early enough for a bonus)
          scoreDelta += policy.onTimePoints;
          onTimeBump += 1;
          streakBump += 1;
          events.push(
            buildEvent({
              tenantId: event.tenantId,
              customerId: event.customerId,
              eventType: 'on_time_payment',
              policyId: policy.id,
              scoreDelta: policy.onTimePoints,
              paymentId: event.paymentId,
              invoiceId: event.invoiceId,
              currency: event.currency,
              occurredAt: event.paidAt,
            })
          );
        } else {
          // paid after due date
          scoreDelta += policy.latePenaltyPoints;
          lateBump += 1;
          streakReset = true;
          events.push(
            buildEvent({
              tenantId: event.tenantId,
              customerId: event.customerId,
              eventType: 'late_payment',
              policyId: policy.id,
              scoreDelta: policy.latePenaltyPoints,
              paymentId: event.paymentId,
              invoiceId: event.invoiceId,
              currency: event.currency,
              occurredAt: event.paidAt,
              payload: { daysLate: -diffDays },
            })
          );
          events.push(
            buildEvent({
              tenantId: event.tenantId,
              customerId: event.customerId,
              eventType: 'streak_broken',
              policyId: policy.id,
              paymentId: event.paymentId,
              occurredAt: event.paidAt,
            })
          );
        }
      }

      // Streak bonus
      if (streakBump > 0 && policy.streakBonusPoints > 0) {
        scoreDelta += policy.streakBonusPoints;
        events.push(
          buildEvent({
            tenantId: event.tenantId,
            customerId: event.customerId,
            eventType: 'streak_continued',
            policyId: policy.id,
            scoreDelta: policy.streakBonusPoints,
            paymentId: event.paymentId,
            occurredAt: event.paidAt,
          })
        );
      }

      // Layer 3: MNO cashback (optional)
      let cashbackQueued = false;
      if (policy.cashbackEnabled && policy.cashbackBps > 0) {
        const rawCashback = Math.floor(
          (event.amountMinorUnits * policy.cashbackBps) / 10000
        );
        const remainingCap = Math.max(
          0,
          policy.cashbackMonthlyCapMinor -
            profile.cashbackMonthToDateMinor
        );
        const cashbackAmount =
          policy.cashbackMonthlyCapMinor > 0
            ? Math.min(rawCashback, remainingCap)
            : rawCashback;

        if (cashbackAmount > 0 && policy.cashbackProvider) {
          cashbackDelta += cashbackAmount;
          if (deps.cashbackQueue) {
            await deps.cashbackQueue.enqueue({
              tenantId: event.tenantId,
              customerId: event.customerId,
              amountMinorUnits: cashbackAmount,
              currency: event.currency,
              provider: policy.cashbackProvider,
              payoutReference: `cashback:${event.paymentId}`,
            });
            cashbackQueued = true;
          }
          events.push(
            buildEvent({
              tenantId: event.tenantId,
              customerId: event.customerId,
              eventType: 'cashback_queued',
              policyId: policy.id,
              cashbackDeltaMinor: cashbackAmount,
              currency: event.currency,
              paymentId: event.paymentId,
              occurredAt: event.paidAt,
              payload: { provider: policy.cashbackProvider },
            })
          );
        }
      }

      const tierBefore = profile.tier;
      const nextProfile = applyDelta(profile, {
        scoreDelta,
        creditDeltaMinor: creditDelta,
        cashbackDeltaMinor: cashbackDelta,
        onTimeBump,
        lateBump,
        streakBump,
        streakReset,
        policy,
        currency: event.currency,
        sourceEventId: paymentPostedEv.id,
      });

      if (nextProfile.tier !== tierBefore) {
        events.push(
          buildEvent({
            tenantId: event.tenantId,
            customerId: event.customerId,
            eventType:
              tierRank(nextProfile.tier) > tierRank(tierBefore)
                ? 'tier_upgraded'
                : 'tier_downgraded',
            policyId: policy.id,
            fromTier: tierBefore,
            toTier: nextProfile.tier,
            paymentId: event.paymentId,
            occurredAt: event.paidAt,
          })
        );
      }

      // Persist — append-only
      for (const ev of events) {
        await deps.repo.appendEvent(ev);
      }
      await deps.repo.appendProfile(nextProfile);

      return {
        events,
        profile: nextProfile,
        cashbackQueued,
        earlyPayCreditGranted,
      };
    },

    async awardStreak({ tenantId, customerId, months }) {
      if (months <= 0) {
        throw new GamificationError('months must be > 0', 'VALIDATION');
      }
      const policy = await loadPolicy(tenantId);
      const profile = await loadOrInitProfile(tenantId, customerId);
      const scoreDelta = policy.streakBonusPoints * months;
      const next = applyDelta(profile, {
        scoreDelta,
        streakBump: months,
        policy,
      });
      const ev: RewardEvent = buildEvent({
        tenantId,
        customerId,
        eventType: 'streak_continued',
        policyId: policy.id,
        scoreDelta,
        occurredAt: now(),
        payload: { months },
      });
      await deps.repo.appendEvent(ev);
      await deps.repo.appendProfile(next);
      return next;
    },

    async applyEarlyPayDiscount(args) {
      const policy = await loadPolicy(args.tenantId);
      if (policy.earlyPayDiscountBps === 0) {
        return { creditGrantedMinor: 0 };
      }
      const daysEarly = daysBetween(args.paidAt, args.dueDate);
      if (daysEarly < policy.earlyPayMinDaysBefore) {
        return { creditGrantedMinor: 0 };
      }
      const discount = Math.floor(
        (args.invoiceAmountMinor * policy.earlyPayDiscountBps) / 10000
      );
      const creditGrantedMinor =
        policy.earlyPayMaxCreditMinor > 0
          ? Math.min(discount, policy.earlyPayMaxCreditMinor)
          : discount;

      const profile = await loadOrInitProfile(
        args.tenantId,
        args.customerId,
        args.currency
      );
      const next = applyDelta(profile, {
        creditDeltaMinor: creditGrantedMinor,
        policy,
        currency: args.currency,
      });
      const ev = buildEvent({
        tenantId: args.tenantId,
        customerId: args.customerId,
        eventType: 'early_pay_credit_granted',
        policyId: policy.id,
        creditDeltaMinor: creditGrantedMinor,
        currency: args.currency,
        invoiceId: args.invoiceId,
        occurredAt: args.paidAt,
        payload: { daysEarly, bps: policy.earlyPayDiscountBps },
      });
      await deps.repo.appendEvent(ev);
      await deps.repo.appendProfile(next);
      return { creditGrantedMinor, event: ev };
    },

    async applyLateFee(args) {
      const policy = await loadPolicy(args.tenantId);
      if (policy.lateFeeBps === 0) {
        return { feeMinor: 0 };
      }
      const daysLate = daysBetween(args.dueDate, args.asOf);
      if (daysLate <= policy.lateFeeGraceDays) {
        return { feeMinor: 0 };
      }
      const raw = Math.floor(
        (args.invoiceAmountMinor * policy.lateFeeBps) / 10000
      );
      const feeMinor =
        policy.lateFeeMaxMinor > 0
          ? Math.min(raw, policy.lateFeeMaxMinor)
          : raw;

      const profile = await loadOrInitProfile(
        args.tenantId,
        args.customerId,
        args.currency
      );
      const next = applyDelta(profile, {
        scoreDelta: policy.latePenaltyPoints,
        lateBump: 1,
        streakReset: true,
        policy,
        currency: args.currency,
      });
      const ev = buildEvent({
        tenantId: args.tenantId,
        customerId: args.customerId,
        eventType: 'late_fee_applied',
        policyId: policy.id,
        scoreDelta: policy.latePenaltyPoints,
        currency: args.currency,
        invoiceId: args.invoiceId,
        occurredAt: args.asOf,
        payload: { daysLate, feeMinor },
      });
      await deps.repo.appendEvent(ev);
      await deps.repo.appendProfile(next);
      return { feeMinor, event: ev };
    },

    async updateTier(tenantId, customerId) {
      const policy = await loadPolicy(tenantId);
      const profile = await loadOrInitProfile(tenantId, customerId);
      const newTier = tierForScore(policy, profile.score);
      if (newTier === profile.tier) return profile;
      const next = applyDelta(profile, { policy });
      const ev = buildEvent({
        tenantId,
        customerId,
        eventType:
          tierRank(newTier) > tierRank(profile.tier)
            ? 'tier_upgraded'
            : 'tier_downgraded',
        policyId: policy.id,
        fromTier: profile.tier,
        toTier: newTier,
        occurredAt: now(),
      });
      await deps.repo.appendEvent(ev);
      await deps.repo.appendProfile(next);
      return next;
    },
  };
}

function tierRank(tier: RewardTier): number {
  switch (tier) {
    case 'bronze':
      return 0;
    case 'silver':
      return 1;
    case 'gold':
      return 2;
    case 'platinum':
      return 3;
    default:
      return 0;
  }
}
