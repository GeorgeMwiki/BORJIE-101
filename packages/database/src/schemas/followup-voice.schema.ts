/**
 * Daily Follow-up + Persona Voice persistence (Wave M2).
 *
 * Companion to Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md.
 * Drizzle types for the three tables created by migration
 * 0034_followup_voice.sql:
 *
 *   - followupCandidates  → owner-facing proactive nudge queue.
 *                           One row per scheduled / sent / dismissed
 *                           follow-up. Tenant-scoped, RLS.
 *   - followupPreferences → per-user channel + quiet-hours + daily
 *                           cap. PK is (tenant_id, user_id).
 *                           Tenant-scoped, RLS.
 *   - personaVoiceMode    → per-user voice mode (guide / learn /
 *                           balanced) + verbosity dial. PK is
 *                           (tenant_id, user_id). Tenant-scoped, RLS.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). All three are written exclusively through
 * the audit-hash chain (`@borjie/audit-hash-chain`) — see
 * Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md §10.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  real,
  time,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// followup_candidates — owner-facing proactive nudge queue
// ============================================================================

export const followupCandidates = pgTable(
  'followup_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** Origin of this candidate — see spec §3 (six sources). */
    source: text('source').notNull(),
    /** Structured payload — { text, citations, action? }. */
    payload: jsonb('payload').notNull().default({}),
    /** Computed priority in [0, 1] from impact × urgency × attention. */
    priority: real('priority').notNull().default(0),
    /** Preferred channel — inapp | email | whatsapp. */
    channel: text('channel').notNull().default('inapp'),
    /** Already adjusted for the user's quiet hours + timezone. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    /** Lifecycle — pending | sent | dismissed | expired. */
    status: text('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userPendingIdx: index('idx_followup_user_pending').on(
      t.tenantId,
      t.userId,
      t.scheduledFor,
    ),
    tenantDueIdx: index('idx_followup_tenant_due').on(
      t.tenantId,
      t.scheduledFor,
      t.status,
    ),
    userHistoryIdx: index('idx_followup_user_history').on(
      t.tenantId,
      t.userId,
      t.createdAt,
    ),
  }),
);

export type FollowupCandidateRow = typeof followupCandidates.$inferSelect;
export type FollowupCandidateInsert = typeof followupCandidates.$inferInsert;

// ============================================================================
// followup_preferences — per-user channel + quiet-hours + daily cap
// ============================================================================

export const followupPreferences = pgTable(
  'followup_preferences',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** Channels the user has consented to. Empty array = fully muted. */
    allowedChannels: text('allowed_channels')
      .array()
      .notNull()
      .default(['inapp']),
    /** Local-time start of quiet-hours window (default '22:00'). */
    quietHoursStart: time('quiet_hours_start').notNull().default('22:00:00'),
    /** Local-time end of quiet-hours window (default '07:00'). */
    quietHoursEnd: time('quiet_hours_end').notNull().default('07:00:00'),
    /** Daily cap on non-critical follow-ups. Default 5; range [0, 50]. */
    maxPerDay: integer('max_per_day').notNull().default(5),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  }),
);

export type FollowupPreferencesRow = typeof followupPreferences.$inferSelect;
export type FollowupPreferencesInsert =
  typeof followupPreferences.$inferInsert;

// ============================================================================
// persona_voice_mode — per-user voice mode + verbosity dial
// ============================================================================

export const personaVoiceMode = pgTable(
  'persona_voice_mode',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** Voice mode — guide | learn | balanced (default). */
    mode: text('mode').notNull().default('balanced'),
    /** Verbosity dial from 1 (terse) to 5 (most verbose). Default 2. */
    verbosityLevel: integer('verbosity_level').notNull().default(2),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  }),
);

export type PersonaVoiceModeRow = typeof personaVoiceMode.$inferSelect;
export type PersonaVoiceModeInsert = typeof personaVoiceMode.$inferInsert;
