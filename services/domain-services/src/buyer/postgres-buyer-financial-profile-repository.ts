/**
 * Postgres-backed Buyer Financial Profile Repository (Borjie mining domain).
 *
 * Backs the buyer-financial-profile aggregate persisted on the `buyers`
 * table (extension columns added by migration 0005):
 *   - credit_limit_tzs
 *   - aml_status
 *   - banking_jsonb
 *   - payment_history_jsonb
 *
 * Every query is tenant-scoped via `WHERE tenant_id = :ctx` so a leaked
 * id from one tenant can never read or mutate another tenant's profile.
 * Mutations are immutable at the call site — we always shape the next
 * record fully and hand the row to Drizzle's UPDATE, never patching the
 * in-memory aggregate in place.
 */

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buyers,
  BUYER_AML_STATUSES,
  type BuyerAmlStatus,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

/** Loose drizzle chain — see iot-service / migration repo. */
interface BuyerDrizzleChain extends PromiseLike<Record<string, unknown>[]> {
  values: (..._args: unknown[]) => BuyerDrizzleChain;
  returning: (..._args: unknown[]) => BuyerDrizzleChain;
  from: (..._args: unknown[]) => BuyerDrizzleChain;
  where: (..._args: unknown[]) => BuyerDrizzleChain;
  set: (..._args: unknown[]) => BuyerDrizzleChain;
  limit: (..._args: unknown[]) => BuyerDrizzleChain;
  orderBy: (..._args: unknown[]) => BuyerDrizzleChain;
}

interface DrizzleLike {
  select: (..._args: unknown[]) => BuyerDrizzleChain;
  update: (..._args: unknown[]) => BuyerDrizzleChain;
}

// ---------------------------------------------------------------------------
// Domain shapes + Zod validators
// ---------------------------------------------------------------------------

export interface BuyerPaymentEntry {
  readonly saleId: string;
  readonly amountTzs: number;
  readonly paidAt: string;
  readonly method: string;
  readonly status: 'succeeded' | 'failed' | 'pending' | 'refunded';
}

export interface BuyerBanking {
  readonly bankName: string | null;
  readonly accountLast4: string | null;
  readonly swiftBic: string | null;
  readonly verifiedAt: string | null;
}

export interface BuyerFinancialProfile {
  readonly buyerId: string;
  readonly tenantId: TenantId;
  readonly creditLimitTzs: number | null;
  readonly amlStatus: BuyerAmlStatus;
  readonly banking: BuyerBanking;
  readonly paymentHistory: readonly BuyerPaymentEntry[];
}

export const paymentEntrySchema = z.object({
  saleId: z.string().min(1),
  amountTzs: z.number().nonnegative(),
  paidAt: z.string().min(1),
  method: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'pending', 'refunded']),
});

export const creditLimitInputSchema = z.object({
  buyerId: z.string().min(1),
  newLimitTzs: z.number().int().nonnegative(),
});

export const flagAmlInputSchema = z.object({
  buyerId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Repository interface — mirrors the old composition-root contract so
// service-registry.ts just rebinds without ceremony.
// ---------------------------------------------------------------------------

export interface BuyerFinancialProfileRepository {
  getFinancialProfile(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerFinancialProfile | null>;
  updateCreditLimit(
    buyerId: string,
    tenantId: TenantId,
    newLimitTzs: number,
  ): Promise<BuyerFinancialProfile>;
  recordPayment(
    buyerId: string,
    tenantId: TenantId,
    payment: BuyerPaymentEntry,
  ): Promise<BuyerFinancialProfile>;
  flagAmlConcern(
    buyerId: string,
    tenantId: TenantId,
    reason: string,
  ): Promise<BuyerFinancialProfile>;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToProfile(row: Record<string, unknown>): BuyerFinancialProfile {
  const banking = (row.bankingJsonb ?? {}) as Record<string, unknown>;
  const history = Array.isArray(row.paymentHistoryJsonb)
    ? (row.paymentHistoryJsonb as readonly unknown[])
    : [];
  const safeHistory: BuyerPaymentEntry[] = history.flatMap((entry) => {
    const parsed = paymentEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const amlStatusRaw = String(row.amlStatus ?? 'clear');
  const amlStatus: BuyerAmlStatus = (BUYER_AML_STATUSES as readonly string[]).includes(
    amlStatusRaw,
  )
    ? (amlStatusRaw as BuyerAmlStatus)
    : 'clear';
  return {
    buyerId: String(row.id),
    tenantId: row.tenantId as TenantId,
    creditLimitTzs:
      row.creditLimitTzs == null ? null : Number(row.creditLimitTzs),
    amlStatus,
    banking: {
      bankName: (banking.bankName as string | null) ?? null,
      accountLast4: (banking.accountLast4 as string | null) ?? null,
      swiftBic: (banking.swiftBic as string | null) ?? null,
      verifiedAt: (banking.verifiedAt as string | null) ?? null,
    },
    paymentHistory: safeHistory,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresBuyerFinancialProfileRepository
  implements BuyerFinancialProfileRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async getFinancialProfile(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerFinancialProfile | null> {
    const rows = await this.db
      .select()
      .from(buyers)
      .where(
        and(
          eq(buyers.id, buyerId),
          eq(buyers.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1);
    return rows[0] ? rowToProfile(rows[0] as Record<string, unknown>) : null;
  }

  async updateCreditLimit(
    buyerId: string,
    tenantId: TenantId,
    newLimitTzs: number,
  ): Promise<BuyerFinancialProfile> {
    const validated = creditLimitInputSchema.parse({ buyerId, newLimitTzs });
    await this.db
      .update(buyers)
      .set({ creditLimitTzs: String(validated.newLimitTzs) })
      .where(
        and(
          eq(buyers.id, validated.buyerId),
          eq(buyers.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.getFinancialProfile(buyerId, tenantId);
    if (!after) {
      throw new Error(`buyer ${buyerId} not found after updateCreditLimit`);
    }
    return after;
  }

  async recordPayment(
    buyerId: string,
    tenantId: TenantId,
    payment: BuyerPaymentEntry,
  ): Promise<BuyerFinancialProfile> {
    const validated = paymentEntrySchema.parse(payment);
    // Use jsonb append so we don't have to read-modify-write the history
    // (avoids lost-update races between concurrent payments).
    await this.db
      .update(buyers)
      .set({
        paymentHistoryJsonb: sql`COALESCE(${buyers.paymentHistoryJsonb}, '[]'::jsonb) || ${JSON.stringify(
          [validated],
        )}::jsonb`,
      })
      .where(
        and(
          eq(buyers.id, buyerId),
          eq(buyers.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.getFinancialProfile(buyerId, tenantId);
    if (!after) {
      throw new Error(`buyer ${buyerId} not found after recordPayment`);
    }
    return after;
  }

  async flagAmlConcern(
    buyerId: string,
    tenantId: TenantId,
    reason: string,
  ): Promise<BuyerFinancialProfile> {
    const validated = flagAmlInputSchema.parse({ buyerId, reason });
    // Move to `flagged` and record the reason as a structured AML note
    // inside the banking blob so an auditor can see why the flag fired.
    await this.db
      .update(buyers)
      .set({
        amlStatus: 'flagged',
        bankingJsonb: sql`COALESCE(${buyers.bankingJsonb}, '{}'::jsonb) || ${JSON.stringify(
          {
            amlNote: {
              reason: validated.reason,
              flaggedAt: new Date().toISOString(),
            },
          },
        )}::jsonb`,
      })
      .where(
        and(
          eq(buyers.id, validated.buyerId),
          eq(buyers.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.getFinancialProfile(buyerId, tenantId);
    if (!after) {
      throw new Error(`buyer ${buyerId} not found after flagAmlConcern`);
    }
    return after;
  }
}
