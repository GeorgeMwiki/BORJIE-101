/**
 * tenant_subscriptions — the platform's own SaaS revenue read-model.
 *
 * Companion to migration 0178. Backs `GET /api/v1/billing/subscription`
 * (owner-portal BillingPage), which previously returned
 * `X-Backend-Status: degraded`. This is the PLATFORM-FEE surface: the
 * mining owner pays Borjie a per-tenant subscription. Per-tenant
 * operational invoices (rent/royalty) stay on the existing invoices path.
 *
 * Money path (CLAUDE.md hard rule)
 * --------------------------------
 * This table is a READ-MODEL of subscription STATE — it stores no posted
 * ledger lines. The actual money movement (charging the platform fee)
 * flows through the established provider PORT (`IPaymentProvider` in
 * services/payments-ledger/src/providers) via the `PlatformBillingService`
 * adapter, and the resulting receivable posts through `LedgerService.post()`
 * exactly like every other money path. `external_id` is the provider's
 * subscription/customer handle so a webhook can reconcile state back here
 * idempotently. `mrr_minor_units` is BIGINT minor units (integer minor
 * units) and carries `currency` (ISO-4217) — NEVER a hardcoded TZS/USD.
 *
 * RLS (CLAUDE.md hard rule)
 * -------------------------
 * Tenant-scoped via FORCE row-level security on `app.current_tenant_id`
 * (policy created in 0178, mirroring 0160/0171). At most one ACTIVE
 * subscription per tenant (partial unique on `cancelled_at IS NULL`,
 * declared in the migration).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
} from 'drizzle-orm/pg-core';

export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: text('id').primaryKey(),
  /** RLS-scoping column. */
  tenantId: text('tenant_id').notNull(),
  /**
   * Provider's subscription/customer handle (Stripe `sub_…` / Paystack
   * subscription code). NULL while a subscription is being provisioned.
   * Reconciliation key for at-least-once provider webhooks.
   */
  externalId: text('external_id'),
  /** Provider that owns `external_id` (e.g. 'stripe' | 'paystack'). */
  provider: text('provider'),
  /** Plan code (mirrors the tenants.plan ladder, e.g. 'mkulima'). */
  plan: text('plan').notNull(),
  /**
   * Subscription status: active|past_due|trialing|cancelled|unpaid|unknown.
   * TEXT + app-level validation (zod) — no pg_enum so the migration stays
   * forward-only + re-runnable.
   */
  status: text('status').notNull().default('unknown'),
  /** Monthly recurring revenue — BIGINT minor units (integer minor units). */
  mrrMinorUnits: bigint('mrr_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
  /** ISO-4217 code for `mrr_minor_units`. Threaded into formatCurrency. */
  currency: text('currency').notNull(),
  /** Number of paid seats on the subscription. */
  seats: integer('seats').notNull().default(0),
  /** Next renewal instant (from the provider). */
  renewalAt: timestamp('renewal_at', { withTimezone: true }),
  /** Soft-cancel marker — frees the active-unique slot. */
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  /** Provider-echoed extras (price id, latest invoice, etc.). */
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type NewTenantSubscription = typeof tenantSubscriptions.$inferInsert;
