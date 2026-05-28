/**
 * Daily Brief Dispatches — Wave OWNER-OS DAILY-BRIEF rebuild.
 *
 * Companion to:
 *   - packages/database/src/migrations/0092_tenant_daily_brief_prefs.sql
 *   - services/api-gateway/src/workers/daily-brief-cron.ts
 *   - services/api-gateway/src/routes/owner/brief.hono.ts
 *   - apps/owner-web/src/components/dashboard/DailyBriefCard.tsx
 *
 * One Drizzle table:
 *
 *   dailyBriefDispatches — append-only idempotency ledger. The cron
 *                          worker writes one row per (tenant, day,
 *                          channel, recipient). The UNIQUE constraint
 *                          (also enforced at the DB level) means a
 *                          duplicate tick is a no-op.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled on the table (CLAUDE.md hard rule).
 *
 * Hash-chain link: `hashChainId` references the `ai_audit_chain` entry
 * that recorded the dispatch for forensic replay. NULL when the chain
 * append failed (the dispatch row is still persisted; the audit gap
 * is observable via the NULL column).
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// daily_brief_dispatches — append-only ledger
// ============================================================================

export const dailyBriefDispatches = pgTable(
  'daily_brief_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant scope. Bound by RLS via `app.tenant_id` GUC. */
    tenantId: uuid('tenant_id').notNull(),
    /** Calendar date the brief refers to (EAT). */
    snapshotDate: date('snapshot_date').notNull(),
    /** One of: 'email' | 'sms' | 'slack'. */
    channel: text('channel').notNull(),
    /** Resolved recipient handle: email address, E.164 phone, or slack handle. */
    recipient: text('recipient').notNull(),
    /** Wall-clock at which the dispatch attempt completed. */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Upstream provider message id (e.g. SendGrid message id). NULL when
     *  the provider did not return one (slack webhooks, stub provider). */
    providerMessageId: text('provider_message_id'),
    /** One of: 'sent' | 'failed' | 'skipped'. */
    status: text('status').notNull().default('sent'),
    /** Provider error code when status = 'failed'. */
    errorCode: text('error_code'),
    /** Truncated provider error body when status = 'failed'. */
    errorMessage: text('error_message'),
    /** FK-soft link to `ai_audit_chain.id`. NULL when the audit append
     *  failed (we still persist the dispatch; the audit gap is logged). */
    hashChainId: uuid('hash_chain_id'),
  },
  (t) => ({
    /** Idempotency: one row per (tenant, day, channel, recipient). */
    uniqTenantDateChannelRecipient: uniqueIndex(
      'dbd_uniq_tenant_date_channel_recipient',
    ).on(t.tenantId, t.snapshotDate, t.channel, t.recipient),
    /** Hot path: load today's dispatches for a tenant. */
    tenantDateDescIdx: index('idx_dbd_tenant_date_desc').on(
      t.tenantId,
      t.snapshotDate,
    ),
    /** Operator query: 'show me everything that failed today'. */
    statusIdx: index('idx_dbd_status').on(t.status),
    /** Forensic verify of a single dispatch. */
    hashChainIdx: index('idx_dbd_hash_chain').on(t.hashChainId),
  }),
);

export type DailyBriefDispatchRow = typeof dailyBriefDispatches.$inferSelect;
export type DailyBriefDispatchInsert =
  typeof dailyBriefDispatches.$inferInsert;

/** Valid values for the `channel` column. */
export const DAILY_BRIEF_DISPATCH_CHANNELS = [
  'email',
  'sms',
  'slack',
] as const;
export type DailyBriefDispatchChannel =
  (typeof DAILY_BRIEF_DISPATCH_CHANNELS)[number];

/** Valid values for the `status` column. */
export const DAILY_BRIEF_DISPATCH_STATUSES = [
  'sent',
  'failed',
  'skipped',
] as const;
export type DailyBriefDispatchStatus =
  (typeof DAILY_BRIEF_DISPATCH_STATUSES)[number];
