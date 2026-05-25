/**
 * platform_announcements — HQ-tier announcement store.
 *
 * Central Command Phase B (B1 — HQ Tool Drizzle Adapters). Backs the
 * `platform.send_announcement` HQ tool (external-comm, four-eye-approved).
 *
 * Lifecycle: `queued` → `sending` → `sent` | `retracted`. The HQ-tool
 * rollback path flips `status='retracted'` and (asynchronously) sends a
 * retraction follow-up via the existing notification-dispatch.
 *
 * Migration 0139. Companion adapter is
 * `packages/database/src/services/platform/announcement.service.ts`.
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';

export const platformAnnouncements = pgTable(
  'platform_announcements',
  {
    id: text('id').primaryKey(),
    /** `global` or `tenant:<tenantId>`. Stored verbatim. */
    scope: text('scope').notNull(),
    /** `banner` | `email` | `both`. Validated upstream by the HQ tool. */
    channel: text('channel').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /**
     * Pre-computed recipient cardinality at send-time. The HQ tool's
     * cost-ceiling gate rejects after-the-fact when this exceeds
     * `maxRecipientCount`, so the field stays for audit even after
     * a retraction.
     */
    recipientCount: integer('recipient_count').notNull().default(0),
    /** When the announcement is/was scheduled to fan out. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** `queued` | `sending` | `sent` | `retracted`. */
    status: text('status').notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    retractedAt: timestamp('retracted_at', { withTimezone: true }),
    retractedReason: text('retracted_reason'),
  },
  (t) => ({
    scopeIdx: index('idx_platform_announcements_scope').on(t.scope),
    statusIdx: index('idx_platform_announcements_status').on(t.status),
    scheduledForIdx: index('idx_platform_announcements_scheduled_for').on(
      t.scheduledFor,
    ),
  }),
);
