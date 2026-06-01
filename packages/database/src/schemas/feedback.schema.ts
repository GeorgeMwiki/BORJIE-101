/**
 * feedback_submissions + complaint_records — Wave 18 feedback/complaint
 * persistence, RE-MATERIALISED.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `services/api-gateway/src/routes/feedback.ts` imports `feedbackSubmissions`
 * and `complaintRecords` from `@borjie/database`, but both tables had been
 * archived (originally migration 0092). With the schemas gone the barrel type
 * resolution broke and every feedback/complaint route failed at runtime. This
 * file restores the two Drizzle tables; companion migration 0166 restores the
 * physical tables (FORCE RLS, tenant-isolation, idempotent/forward-only).
 *
 * SOURCE OF TRUTH = THE ROUTE CODE
 * --------------------------------
 * Every column name + type + nullability below is dictated by what
 * `feedback.ts` reads and writes (`.values()` / `.set()` / select / `where`).
 * Notable consequences of matching the code rather than the old 0092 file:
 *   - `feedback_submissions.type` admits `'turn-thumbs'` (the Jarvis 👍/👎 path
 *     writes it on line 141) ON TOP of the legacy survey enum, so the CHECK in
 *     0166 is widened accordingly — the original 0092 CHECK would have rejected
 *     it at runtime.
 *   - `user_id` is NOT NULL on both tables: the route always writes
 *     `auth.userId`, and the sibling `support_cases` (0164) carries user_id as
 *     NOT NULL too. (0092 had it nullable; the code never relies on that.)
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0166 on
 * `current_setting('app.current_tenant_id', true)` (mirrors 0162/0163/0164).
 *
 * NO MONEY COLUMNS. These are feedback/complaint records only; nothing
 * money-shaped lives here for any code path to write by mistake.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// feedback_submissions — long-form survey feedback + Jarvis turn-thumbs signal
// ============================================================================

export const feedbackSubmissions = pgTable(
  'feedback_submissions',
  {
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** The user who submitted the feedback (route always writes auth.userId). */
    userId: text('user_id').notNull(),
    /**
     * 'general' | 'bug' | 'feature' | 'improvement' (legacy survey form) OR
     * 'turn-thumbs' (Jarvis 👍/👎 path). CHECK in 0166. Indexed for the
     * `?type=` list filter.
     */
    type: text('type').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    /** 1-5 satisfaction rating; NULL when the survey omits it. */
    rating: integer('rating'),
    /**
     * Free-form context bag. The turn-thumbs path stashes
     * { turnId, threadId, signal, correctionText, ... } here so the
     * rejudge/eval workflow can replay the click.
     */
    context: jsonb('context').default({}),
    /** submitted | reviewing | resolved | closed (CHECK in 0166). */
    status: text('status').notNull().default('submitted'),
    /** Reviewer bookkeeping (written by the staff review surface, not chat). */
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Tenant-scoped list, newest first (GET / ordering hot path).
    tenantCreatedIdx: index('idx_feedback_submissions_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
    // Tenant + status listing.
    tenantStatusIdx: index('idx_feedback_submissions_status').on(
      t.tenantId,
      t.status,
    ),
    // Backs the `?type=` filter on GET /.
    tenantTypeIdx: index('idx_feedback_submissions_type').on(
      t.tenantId,
      t.type,
    ),
  }),
);

export type FeedbackSubmission = typeof feedbackSubmissions.$inferSelect;
export type NewFeedbackSubmission = typeof feedbackSubmissions.$inferInsert;

// ============================================================================
// complaint_records — owner/tenant complaints with a resolve state machine
// ============================================================================

export const complaintRecords = pgTable(
  'complaint_records',
  {
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** The user who raised the complaint (route always writes auth.userId). */
    userId: text('user_id').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    /**
     * maintenance | neighbor | payment | lease | other (CHECK in 0166). The
     * route defaults to 'other' so this is effectively always populated.
     */
    category: text('category').notNull().default('other'),
    /** Optional polymorphic link to the entity the complaint is about. */
    relatedEntityType: text('related_entity_type'),
    relatedEntityId: text('related_entity_id'),
    /** low | medium | high | urgent (CHECK in 0166). */
    priority: text('priority').notNull().default('medium'),
    /** open | in_progress | resolved | closed (CHECK in 0166). */
    status: text('status').notNull().default('open'),
    /** Human-facing resolution text, set on PUT /complaints/:id/resolve. */
    resolution: text('resolution'),
    /** Optional internal resolution notes. */
    resolutionNotes: text('resolution_notes'),
    /** Who resolved it (auth.userId at resolve time). */
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Tenant-scoped list, newest first.
    tenantCreatedIdx: index('idx_complaint_records_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
    // Tenant + status triage listing.
    tenantStatusIdx: index('idx_complaint_records_status').on(
      t.tenantId,
      t.status,
    ),
    // Tenant + priority + status (queue prioritisation).
    tenantPriorityIdx: index('idx_complaint_records_priority').on(
      t.tenantId,
      t.priority,
      t.status,
    ),
  }),
);

export type ComplaintRecord = typeof complaintRecords.$inferSelect;
export type NewComplaintRecord = typeof complaintRecords.$inferInsert;

// ----------------------------------------------------------------------------
// Closed sets — mirror the CHECK constraints in migration 0166 so callers can
// validate before insert without a round-trip.
// ----------------------------------------------------------------------------

/** feedback_submissions.type closed set (mirrors the 0166 CHECK). */
export const FEEDBACK_TYPES = [
  'general',
  'bug',
  'feature',
  'improvement',
  'turn-thumbs',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** feedback_submissions.status closed set (mirrors the 0166 CHECK). */
export const FEEDBACK_STATUSES = [
  'submitted',
  'reviewing',
  'resolved',
  'closed',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** complaint_records.category closed set (mirrors the 0166 CHECK). */
export const COMPLAINT_CATEGORIES = [
  'maintenance',
  'neighbor',
  'payment',
  'lease',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** complaint_records.priority closed set (mirrors the 0166 CHECK). */
export const COMPLAINT_PRIORITIES = [
  'low',
  'medium',
  'high',
  'urgent',
] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

/** complaint_records.status closed set (mirrors the 0166 CHECK). */
export const COMPLAINT_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
