/**
 * Platform billing service — the platform's own SaaS revenue path.
 *
 * Backs `GET /api/v1/billing/subscription` (read) and a `subscribe()` write
 * that charges the per-tenant platform fee. This is BORJIE's SaaS revenue,
 * NOT a tenant's operational invoices.
 *
 * MONEY PATH (CLAUDE.md hard rules)
 * ---------------------------------
 *   1. The provider PORT is the ONLY money-out-to-the-world seam. `subscribe()`
 *      drives the platform fee through the injected `IPaymentProvider`
 *      (`services/payments-ledger/src/providers` — the same Stripe/M-Pesa
 *      contract every other charge uses). We pass a stable `idempotencyKey`
 *      so a retried subscribe never double-charges at the provider.
 *   2. The resulting receivable posts through the REAL `LedgerService.post()`
 *      (a BALANCED 2-leg journal: DR platform_billing_receivable / CR
 *      platform_subscription_revenue). We NEVER write ledger_entries directly
 *      and NEVER define a parallel ledger.
 *   3. `tenant_subscriptions` is a STATE read-model only — it records the
 *      subscription status/MRR/renewal and the provider handle (`external_id`)
 *      so an at-least-once provider webhook can reconcile back here
 *      idempotently. It stores no posted money.
 *
 * Currency is resolved from the tenant's `primary_currency` (never hardcoded —
 * CLAUDE.md multi-currency rule). The provider must support that currency or
 * the charge is refused loud.
 *
 * Idempotency: `subscribe()` is idempotent on `(tenantId, plan, billingPeriod)`.
 * The same period re-subscribe returns the existing active subscription
 * without a second provider charge or ledger post.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  Money,
  type CurrencyCode,
  type TenantId,
  type CreateJournalEntryRequest,
  type AccountId,
} from '@borjie/domain-models';
import type { IPaymentProvider } from '@borjie/payments-ledger-service';
import type { LedgerService } from '@borjie/payments-ledger-service';
import { tenantSubscriptions } from '@borjie/database';
import { createDatabaseClient } from '@borjie/database';
import { ensureLedgerAccounts } from '../ledger/accounts-provisioner';
import { assertBalanced } from '../ledger';
import { createLogger } from '../../utils/logger';

type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const logger = createLogger('platform-billing');

/** The subscription state the BillingPage renders. */
export interface SubscriptionView {
  readonly plan: string | null;
  readonly status: string;
  readonly renewalAt: string | null;
  readonly currency: string | null;
  readonly mrrMinor: number;
  readonly seats: number;
  readonly externalId: string | null;
  readonly provider: string | null;
}

export interface SubscribeInput {
  readonly tenantId: string;
  readonly plan: string;
  /** Monthly recurring revenue to charge, in MINOR units (integer). */
  readonly mrrMinor: number;
  readonly seats: number;
  /**
   * Billing period anchor (yyyy-mm) — part of the idempotency key so the
   * SAME month re-subscribe is a no-op while a NEW month charges again.
   */
  readonly billingPeriod: string;
  /** Provider customer handle (e.g. Stripe `cus_…`). */
  readonly providerCustomerId: string;
  /** Actor that initiated the subscribe (audit). */
  readonly actorId: string;
}

export interface SubscribeResult {
  readonly subscription: SubscriptionView;
  readonly journalId: string;
  readonly providerPaymentId: string;
  /** True when an existing active subscription/charge was replayed (no re-charge). */
  readonly idempotentReplay: boolean;
}

export interface PlatformBillingDeps {
  readonly db: DatabaseClient;
  readonly provider: IPaymentProvider;
  readonly ledger: LedgerService;
  /** Resolve a tenant's primary currency. Injected so tests don't need a tenants row. */
  readonly resolveCurrency: (tenantId: string) => Promise<CurrencyCode>;
}

/**
 * Default currency resolver: reads `tenants.primary_currency`. Tolerates a
 * UUID-or-text `id` column (the cast is omitted so text tenant ids in tests
 * work; production tenant ids are UUID-shaped text and compare equal).
 */
export function makeTenantCurrencyResolver(
  db: DatabaseClient,
): (tenantId: string) => Promise<CurrencyCode> {
  const cache = new Map<string, CurrencyCode>();
  return async (tenantId: string): Promise<CurrencyCode> => {
    const cached = cache.get(tenantId);
    if (cached) return cached;
    const raw = await db.execute(sql`
      SELECT primary_currency FROM tenants WHERE id = ${tenantId} LIMIT 1
    `);
    const rows = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : (((raw as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>);
    const currency = rows[0]?.primary_currency as string | undefined;
    if (!currency) {
      throw new Error(
        `platform-billing: tenant ${tenantId} has no primary_currency — cannot bill without a currency`,
      );
    }
    const code = currency as CurrencyCode;
    cache.set(tenantId, code);
    return code;
  };
}

export class PlatformBillingService {
  private readonly db: DatabaseClient;
  private readonly provider: IPaymentProvider;
  private readonly ledger: LedgerService;
  private readonly resolveCurrency: (tenantId: string) => Promise<CurrencyCode>;

  constructor(deps: PlatformBillingDeps) {
    this.db = deps.db;
    this.provider = deps.provider;
    this.ledger = deps.ledger;
    this.resolveCurrency = deps.resolveCurrency;
  }

  /**
   * Read the tenant's current subscription state. Returns an `unknown`-status
   * view (NOT degraded) when the tenant has never subscribed — the page
   * renders a real "no subscription" state.
   */
  async getSubscription(tenantId: string): Promise<SubscriptionView> {
    const [row] = await this.db
      .select()
      .from(tenantSubscriptions)
      .where(
        and(
          eq(tenantSubscriptions.tenantId, tenantId),
          isNull(tenantSubscriptions.cancelledAt),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        plan: null,
        status: 'none',
        renewalAt: null,
        currency: null,
        mrrMinor: 0,
        seats: 0,
        externalId: null,
        provider: null,
      };
    }
    return this.toView(row);
  }

  /**
   * Charge the platform fee for `billingPeriod` and (idempotently) record the
   * active subscription. Money path: provider PORT charge → LedgerService.post
   * (balanced) → upsert the `tenant_subscriptions` state.
   */
  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    if (!Number.isInteger(input.mrrMinor) || input.mrrMinor <= 0) {
      throw new Error(
        `platform-billing: mrrMinor must be a positive integer (got ${input.mrrMinor})`,
      );
    }

    const currency = await this.resolveCurrency(input.tenantId);
    if (!this.provider.supportsCurrency(currency)) {
      throw new Error(
        `platform-billing: provider '${this.provider.name}' does not support ${currency}`,
      );
    }

    // Stable idempotency key — pure function of (tenant, plan, period). A
    // retried subscribe for the SAME period collides on this key both at the
    // provider AND the ledger, so neither double-charges nor double-posts.
    const idempotencyKey = `platform-billing:${input.tenantId}:${input.plan}:${input.billingPeriod}`;

    // If an active subscription already covers this period, replay it without
    // re-charging (idempotent fast-path).
    const existing = await this.findActiveForPeriod(input.tenantId, input.billingPeriod);
    if (existing) {
      logger.info(
        { tenantId: input.tenantId, billingPeriod: input.billingPeriod },
        'platform_billing_subscribe_idempotent_replay',
      );
      return {
        subscription: this.toView(existing),
        journalId: String((existing.metadata as Record<string, unknown>)?.journalId ?? ''),
        providerPaymentId: existing.externalId ?? '',
        idempotentReplay: true,
      };
    }

    const amount = Money.fromMinorUnits(input.mrrMinor, currency);

    // 1 — provider PORT charge (the ONLY money-out seam). Idempotent.
    const charge = await this.provider.createPaymentIntent({
      amount,
      customerId: input.providerCustomerId,
      description: `Borjie platform subscription (${input.plan}, ${input.billingPeriod})`,
      statementDescriptor: 'BORJIE SAAS',
      metadata: {
        tenantId: input.tenantId,
        plan: input.plan,
        billingPeriod: input.billingPeriod,
        kind: 'platform_subscription',
      },
      idempotencyKey,
    });

    // 2 — post the receivable through the REAL LedgerService (balanced 2-leg).
    const journalId = await this.postReceivable({
      tenantId: input.tenantId,
      currency,
      amountMinor: input.mrrMinor,
      idempotencyKey,
      providerPaymentId: charge.externalId,
      plan: input.plan,
      billingPeriod: input.billingPeriod,
      actorId: input.actorId,
    });

    // 3 — upsert the subscription STATE read-model.
    const renewalAt = nextRenewal(input.billingPeriod);
    const view = await this.upsertSubscription({
      tenantId: input.tenantId,
      externalId: charge.externalId,
      provider: this.provider.name,
      plan: input.plan,
      status: 'active',
      mrrMinor: input.mrrMinor,
      currency,
      seats: input.seats,
      renewalAt,
      metadata: {
        journalId,
        billingPeriod: input.billingPeriod,
        providerPaymentId: charge.externalId,
      },
    });

    logger.info(
      {
        tenantId: input.tenantId,
        plan: input.plan,
        billingPeriod: input.billingPeriod,
        journalId,
        providerPaymentId: charge.externalId,
        currency,
      },
      'platform_billing_subscribe_committed',
    );

    return {
      subscription: view,
      journalId,
      providerPaymentId: charge.externalId,
      idempotentReplay: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async findActiveForPeriod(
    tenantId: string,
    billingPeriod: string,
  ): Promise<typeof tenantSubscriptions.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(tenantSubscriptions)
      .where(
        and(
          eq(tenantSubscriptions.tenantId, tenantId),
          isNull(tenantSubscriptions.cancelledAt),
          sql`${tenantSubscriptions.metadata}->>'billingPeriod' = ${billingPeriod}`,
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Post the balanced platform-fee journal through LedgerService:
   *   DR platform_billing_receivable   mrr
   *   CR platform_subscription_revenue mrr
   * The `idempotencyKey` is deduped inside the atomic post — a retry returns
   * the original journal (no double-post).
   */
  private async postReceivable(args: {
    tenantId: string;
    currency: CurrencyCode;
    amountMinor: number;
    idempotencyKey: string;
    providerPaymentId: string;
    plan: string;
    billingPeriod: string;
    actorId: string;
  }): Promise<string> {
    const accounts = await ensureLedgerAccounts(this.db, {
      tenantId: args.tenantId,
      currency: args.currency,
      keys: ['platform_billing_receivable', 'platform_subscription_revenue'],
      createdBy: 'platform-billing',
    });

    const meta = {
      idempotencyKey: args.idempotencyKey,
      providerPaymentId: args.providerPaymentId,
      plan: args.plan,
      billingPeriod: args.billingPeriod,
      kind: 'platform_subscription',
    };

    const lines: CreateJournalEntryRequest['lines'] = [
      {
        accountId: accounts.platform_billing_receivable as AccountId,
        type: 'PLATFORM_FEE',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(args.amountMinor, args.currency),
        description: 'Platform subscription receivable',
        metadata: meta,
      },
      {
        accountId: accounts.platform_subscription_revenue as AccountId,
        type: 'PLATFORM_FEE',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(args.amountMinor, args.currency),
        description: 'Platform subscription revenue',
        metadata: meta,
      },
    ];
    assertBalanced(lines);

    const request: CreateJournalEntryRequest = {
      tenantId: args.tenantId as TenantId,
      effectiveDate: new Date(),
      lines,
      createdBy: 'platform-billing',
    };

    const result = await this.ledger.postJournalEntry(request, {
      idempotencyKey: args.idempotencyKey,
    });
    return result.journalId;
  }

  private async upsertSubscription(args: {
    tenantId: string;
    externalId: string;
    provider: string;
    plan: string;
    status: string;
    mrrMinor: number;
    currency: string;
    seats: number;
    renewalAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<SubscriptionView> {
    const now = new Date();
    const [row] = await this.db
      .insert(tenantSubscriptions)
      .values({
        id: `sub_${randomUUID()}`,
        tenantId: args.tenantId,
        externalId: args.externalId,
        provider: args.provider,
        plan: args.plan,
        status: args.status,
        mrrMinorUnits: args.mrrMinor,
        currency: args.currency,
        seats: args.seats,
        renewalAt: args.renewalAt,
        metadata: args.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        // The partial unique is on (tenant_id) WHERE cancelled_at IS NULL —
        // target that predicate so an existing active row updates in place.
        target: tenantSubscriptions.tenantId,
        targetWhere: isNull(tenantSubscriptions.cancelledAt),
        set: {
          externalId: args.externalId,
          provider: args.provider,
          plan: args.plan,
          status: args.status,
          mrrMinorUnits: args.mrrMinor,
          currency: args.currency,
          seats: args.seats,
          renewalAt: args.renewalAt,
          metadata: args.metadata,
          updatedAt: now,
        },
      })
      .returning();

    return this.toView(row);
  }

  private toView(row: typeof tenantSubscriptions.$inferSelect): SubscriptionView {
    return {
      plan: row.plan,
      status: row.status,
      renewalAt: row.renewalAt ? row.renewalAt.toISOString() : null,
      currency: row.currency,
      mrrMinor: Number(row.mrrMinorUnits),
      seats: Number(row.seats),
      externalId: row.externalId ?? null,
      provider: row.provider ?? null,
    };
  }
}

/**
 * Compute the next renewal instant from a `yyyy-mm` billing period: the first
 * day of the FOLLOWING month (UTC).
 */
function nextRenewal(billingPeriod: string): Date {
  const parts = billingPeriod.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(
      `platform-billing: billingPeriod must be 'yyyy-mm' (got '${billingPeriod}')`,
    );
  }
  // Month is 1-based; Date.UTC month is 0-based. First of next month = UTC(y, m).
  return new Date(Date.UTC(y, m, 1, 0, 0, 0));
}
