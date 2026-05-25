/**
 * Postgres-backed gamification repository (Drizzle).
 *
 * Backs `GamificationRepository` using three tables:
 *   - reward_policies          (versioned; only ONE active per tenant)
 *   - tenant_gamification_profile (APPEND-ONLY snapshots keyed by asOf)
 *   - reward_events            (APPEND-ONLY ledger with dedup_key uniqueness)
 *
 * Invariants enforced here:
 *   - `getActivePolicy` returns the single row where active = true.
 *   - `upsertPolicy` deactivates any prior active policy in the same tx,
 *     then inserts the new version.
 *   - `getCurrentProfile` returns the most recent snapshot by `asOf`.
 *   - Every read filters by tenant_id to preserve isolation.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  rewardPolicies,
  tenantGamificationProfile,
  rewardEvents,
} from '@borjie/database';
import type { GamificationRepository } from './gamification-service.js';
import type { RewardPolicy, RewardTier } from './reward-policy.js';
import type { TenantGamificationProfile } from './tenant-gamification-profile.js';
import type { RewardEvent, RewardEventType } from './reward-event.js';

export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export class PostgresGamificationRepository implements GamificationRepository {
  constructor(private readonly db: DrizzleLike) {}

  async getActivePolicy(tenantId: string): Promise<RewardPolicy | null> {
    const rows = await this.db
      .select()
      .from(rewardPolicies)
      .where(
        and(
          eq(rewardPolicies.tenantId, tenantId),
          eq(rewardPolicies.active, true)
        )
      )
      .orderBy(desc(rewardPolicies.version))
      .limit(1);
    const row = rows[0];
    return row ? rowToPolicy(row) : null;
  }

  async upsertPolicy(policy: RewardPolicy): Promise<RewardPolicy> {
    // Versioning: deactivate prior active policies and insert the new one
    // atomically. Consumers treat policies as immutable — a new version is
    // always a new row.
    return this.db.transaction(async (tx: DrizzleLike) => {
      await tx
        .update(rewardPolicies)
        .set({ active: false, effectiveUntil: new Date() })
        .where(
          and(
            eq(rewardPolicies.tenantId, policy.tenantId),
            eq(rewardPolicies.active, true)
          )
        );
      await tx.insert(rewardPolicies).values(policyToRow(policy));
      return policy;
    });
  }

  async getCurrentProfile(
    tenantId: string,
    customerId: string
  ): Promise<TenantGamificationProfile | null> {
    const rows = await this.db
      .select()
      .from(tenantGamificationProfile)
      .where(
        and(
          eq(tenantGamificationProfile.tenantId, tenantId),
          eq(tenantGamificationProfile.customerId, customerId)
        )
      )
      .orderBy(desc(tenantGamificationProfile.asOf))
      .limit(1);
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }

  async appendProfile(profile: TenantGamificationProfile): Promise<void> {
    await this.db
      .insert(tenantGamificationProfile)
      .values(profileToRow(profile));
  }

  async appendEvent(event: RewardEvent): Promise<void> {
    // dedup_key has a unique index; rely on ON CONFLICT DO NOTHING so a
    // retry of the same logical event is a no-op rather than a hard error.
    await this.db
      .insert(rewardEvents)
      .values(eventToRow(event))
      .onConflictDoNothing();
  }

  async findEventByDedupKey(
    tenantId: string,
    dedupKey: string
  ): Promise<RewardEvent | null> {
    const rows = await this.db
      .select()
      .from(rewardEvents)
      .where(
        and(
          eq(rewardEvents.tenantId, tenantId),
          eq(rewardEvents.dedupKey, dedupKey)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToEvent(row) : null;
  }
}

// ============================================================================
// Row <-> Entity mapping
// ============================================================================

function policyToRow(p: RewardPolicy): Record<string, unknown> {
  return {
    id: p.id,
    tenantId: p.tenantId,
    version: p.version,
    active: p.active,
    onTimePoints: p.onTimePoints,
    earlyPaymentBonusPoints: p.earlyPaymentBonusPoints,
    latePenaltyPoints: p.latePenaltyPoints,
    streakBonusPoints: p.streakBonusPoints,
    bronzeThreshold: p.bronzeThreshold,
    silverThreshold: p.silverThreshold,
    goldThreshold: p.goldThreshold,
    platinumThreshold: p.platinumThreshold,
    earlyPayDiscountBps: p.earlyPayDiscountBps,
    earlyPayMinDaysBefore: p.earlyPayMinDaysBefore,
    earlyPayMaxCreditMinor: p.earlyPayMaxCreditMinor,
    lateFeeBps: p.lateFeeBps,
    lateFeeGraceDays: p.lateFeeGraceDays,
    lateFeeMaxMinor: p.lateFeeMaxMinor,
    cashbackEnabled: p.cashbackEnabled,
    cashbackBps: p.cashbackBps,
    cashbackMonthlyCapMinor: p.cashbackMonthlyCapMinor,
    cashbackProvider: p.cashbackProvider ?? null,
    extra: p.extra,
    createdAt: new Date(p.createdAt),
    createdBy: p.createdBy ?? null,
    effectiveFrom: new Date(p.effectiveFrom),
    effectiveUntil: p.effectiveUntil ? new Date(p.effectiveUntil) : null,
  };
}

function rowToPolicy(row: Record<string, unknown>): RewardPolicy {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    version: (row.version as number) ?? 1,
    active: Boolean(row.active),
    onTimePoints: row.onTimePoints as number,
    earlyPaymentBonusPoints: row.earlyPaymentBonusPoints as number,
    latePenaltyPoints: row.latePenaltyPoints as number,
    streakBonusPoints: row.streakBonusPoints as number,
    bronzeThreshold: row.bronzeThreshold as number,
    silverThreshold: row.silverThreshold as number,
    goldThreshold: row.goldThreshold as number,
    platinumThreshold: row.platinumThreshold as number,
    earlyPayDiscountBps: row.earlyPayDiscountBps as number,
    earlyPayMinDaysBefore: row.earlyPayMinDaysBefore as number,
    earlyPayMaxCreditMinor: row.earlyPayMaxCreditMinor as number,
    lateFeeBps: row.lateFeeBps as number,
    lateFeeGraceDays: row.lateFeeGraceDays as number,
    lateFeeMaxMinor: row.lateFeeMaxMinor as number,
    cashbackEnabled: Boolean(row.cashbackEnabled),
    cashbackBps: row.cashbackBps as number,
    cashbackMonthlyCapMinor: row.cashbackMonthlyCapMinor as number,
    cashbackProvider:
      (row.cashbackProvider as RewardPolicy['cashbackProvider']) ?? undefined,
    extra: (row.extra as Record<string, unknown>) ?? {},
    createdAt: toIso(row.createdAt as Date | string),
    createdBy: (row.createdBy as string | undefined) ?? undefined,
    effectiveFrom: toIso(row.effectiveFrom as Date | string),
    effectiveUntil: row.effectiveUntil
      ? toIso(row.effectiveUntil as Date)
      : undefined,
  };
}

function profileToRow(p: TenantGamificationProfile): Record<string, unknown> {
  return {
    id: p.id,
    tenantId: p.tenantId,
    customerId: p.customerId,
    score: p.score,
    tier: p.tier,
    streakMonths: p.streakMonths,
    longestStreakMonths: p.longestStreakMonths,
    totalOnTimePayments: p.totalOnTimePayments,
    totalLatePayments: p.totalLatePayments,
    earlyPayCreditBalanceMinor: p.earlyPayCreditBalanceMinor,
    earlyPayCreditCurrency: p.earlyPayCreditCurrency,
    cashbackMonthToDateMinor: p.cashbackMonthToDateMinor,
    cashbackLifetimeMinor: p.cashbackLifetimeMinor,
    asOf: new Date(p.asOf),
    sourceEventId: p.sourceEventId,
    createdAt: new Date(p.createdAt),
  };
}

function rowToProfile(row: Record<string, unknown>): TenantGamificationProfile {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    customerId: row.customerId as string,
    score: row.score as number,
    tier: row.tier as RewardTier,
    streakMonths: row.streakMonths as number,
    longestStreakMonths: row.longestStreakMonths as number,
    totalOnTimePayments: row.totalOnTimePayments as number,
    totalLatePayments: row.totalLatePayments as number,
    earlyPayCreditBalanceMinor: row.earlyPayCreditBalanceMinor as number,
    earlyPayCreditCurrency: (row.earlyPayCreditCurrency as string | null) ?? null,
    cashbackMonthToDateMinor: row.cashbackMonthToDateMinor as number,
    cashbackLifetimeMinor: row.cashbackLifetimeMinor as number,
    asOf: toIso(row.asOf as Date | string),
    sourceEventId: (row.sourceEventId as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string),
  };
}

function eventToRow(e: RewardEvent): Record<string, unknown> {
  return {
    id: e.id,
    tenantId: e.tenantId,
    customerId: e.customerId,
    eventType: e.eventType,
    policyId: e.policyId,
    scoreDelta: e.scoreDelta,
    creditDeltaMinor: e.creditDeltaMinor,
    cashbackDeltaMinor: e.cashbackDeltaMinor,
    currency: e.currency,
    paymentId: e.paymentId,
    invoiceId: e.invoiceId,
    fromTier: e.fromTier,
    toTier: e.toTier,
    payload: e.payload,
    dedupKey: e.dedupKey,
    occurredAt: new Date(e.occurredAt),
    createdAt: new Date(e.createdAt),
  };
}

function rowToEvent(row: Record<string, unknown>): RewardEvent {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    customerId: row.customerId as string,
    eventType: row.eventType as RewardEventType,
    policyId: (row.policyId as string | null) ?? null,
    scoreDelta: (row.scoreDelta as number) ?? 0,
    creditDeltaMinor: (row.creditDeltaMinor as number) ?? 0,
    cashbackDeltaMinor: (row.cashbackDeltaMinor as number) ?? 0,
    currency: (row.currency as string | null) ?? null,
    paymentId: (row.paymentId as string | null) ?? null,
    invoiceId: (row.invoiceId as string | null) ?? null,
    fromTier: (row.fromTier as RewardTier | null) ?? null,
    toTier: (row.toTier as RewardTier | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    dedupKey: (row.dedupKey as string | null) ?? null,
    occurredAt: toIso(row.occurredAt as Date | string),
    createdAt: toIso(row.createdAt as Date | string),
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
