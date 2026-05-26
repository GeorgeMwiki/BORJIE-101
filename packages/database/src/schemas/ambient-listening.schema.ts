/**
 * Ambient voice listening persistence (Wave 19J).
 *
 * Companion to Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md. Drizzle types
 * for the three tenant-scoped tables created by migration
 * 0051_ambient_listening.sql:
 *
 *   - ambientConsents             → composite (tenant, user, channel) PK.
 *                                   Drives the silent-disable gate on every
 *                                   capture turn. RLS.
 *   - ambientCaptures             → one row per pipeline capture. Holds the
 *                                   redacted text + extracted intent +
 *                                   entities + optional sentiment. Hash-
 *                                   chained via prev_hash/audit_hash. RLS.
 *   - ambientKillSwitchEvents     → append-only kill-switch audit. scope ∈
 *                                   {user, org}. Read on every capture turn.
 *                                   RLS.
 *
 * All tables use the canonical `app.tenant_id` GUC RLS policy (migration
 * 0003 pattern).
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md —
 * Decisions 3 + 4 (privacy tiers + 90-day re-consent + employee opt-out).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  boolean,
  real,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// ambient_consents — composite (tenant, user, channel) PK
// ============================================================================

export const ambientConsents = pgTable(
  'ambient_consents',
  {
    tenantId: text('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** chat | voice_call | sms */
    channel: text('channel').notNull(),
    /** granted | revoked | not-set */
    consentState: text('consent_state').notNull().default('not-set'),
    /** Sentiment-extraction consent is a separate axis (see spec §6). */
    sentimentConsent: boolean('sentiment_consent').notNull().default(false),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    grantedBy: uuid('granted_by'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'ambient_consents_pk',
      columns: [table.tenantId, table.userId, table.channel],
    }),
    tenantIdx: index('idx_ambient_consents_tenant').on(table.tenantId),
    tenantUserIdx: index('idx_ambient_consents_tenant_user').on(
      table.tenantId,
      table.userId,
    ),
    stateIdx: index('idx_ambient_consents_state').on(
      table.tenantId,
      table.consentState,
    ),
  }),
);

export type AmbientConsentRow = typeof ambientConsents.$inferSelect;
export type NewAmbientConsentRow = typeof ambientConsents.$inferInsert;

// ============================================================================
// ambient_captures — one row per pipeline capture
// ============================================================================

export const ambientCaptures = pgTable(
  'ambient_captures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    channel: text('channel').notNull(),
    sourceSessionId: text('source_session_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    redactedText: text('redacted_text').notNull(),
    intent: text('intent').notNull(),
    entities: jsonb('entities').notNull().default([]),
    /** Bounded scalar in [-1, 1]; NULL when sentiment_consent is false. */
    sentiment: real('sentiment'),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash'),
  },
  (table) => ({
    tenantCapturedIdx: index('idx_ambient_captures_tenant_captured').on(
      table.tenantId,
      table.capturedAt,
    ),
    tenantUserCapturedIdx: index('idx_ambient_captures_tenant_user_captured').on(
      table.tenantId,
      table.userId,
      table.capturedAt,
    ),
    tenantIntentIdx: index('idx_ambient_captures_tenant_intent').on(
      table.tenantId,
      table.intent,
      table.capturedAt,
    ),
    sourceSessionIdx: index('idx_ambient_captures_source_session').on(
      table.tenantId,
      table.sourceSessionId,
    ),
  }),
);

export type AmbientCaptureRow = typeof ambientCaptures.$inferSelect;
export type NewAmbientCaptureRow = typeof ambientCaptures.$inferInsert;

// ============================================================================
// ambient_kill_switch_events — append-only kill-switch audit
// ============================================================================

export const ambientKillSwitchEvents = pgTable(
  'ambient_kill_switch_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    triggeredBy: uuid('triggered_by').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text('reason').notNull(),
    /** user | org */
    scope: text('scope').notNull(),
    /** Set when scope='user'; NULL when scope='org'. */
    targetUserId: uuid('target_user_id'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantTriggeredIdx: index('idx_ambient_kse_tenant_triggered').on(
      table.tenantId,
      table.triggeredAt,
    ),
    tenantScopeTriggeredIdx: index('idx_ambient_kse_tenant_scope_triggered').on(
      table.tenantId,
      table.scope,
      table.triggeredAt,
    ),
    tenantTargetTriggeredIdx: index(
      'idx_ambient_kse_tenant_target_triggered',
    ).on(table.tenantId, table.targetUserId, table.triggeredAt),
  }),
);

export type AmbientKillSwitchEventRow =
  typeof ambientKillSwitchEvents.$inferSelect;
export type NewAmbientKillSwitchEventRow =
  typeof ambientKillSwitchEvents.$inferInsert;
