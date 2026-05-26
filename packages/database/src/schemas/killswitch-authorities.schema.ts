/**
 * killswitch_authorities + killswitch_pending_confirmations — RBAC matrix
 * for the platform / per-tenant kill switch.
 *
 * Replaces the tenant-prefixed scope hack on
 * `X-Confirmation-Operator-Id` (services/api-gateway/src/routes/mining/
 * internal/killswitch.hono.ts) with a proper two-table model:
 *
 *   1. `killswitch_authorities` — append-only grant ledger. A row says
 *      "user X may exercise scope S until revoked_at". Scope strings are
 *      glob-shaped (`killswitch:junior:*`, `killswitch:tenant:<id>:*`,
 *      `killswitch:platform:*`) so the route can resolve a target via
 *      prefix-match without joining at write time.
 *
 *   2. `killswitch_pending_confirmations` — ephemeral two-operator state.
 *      Initiator inserts; confirmer updates `confirmed_*` columns. After
 *      `expires_at` (initiator + 30 s) the row is no longer eligible
 *      to fire the kill switch.
 *
 * Both tables back migration 0009_killswitch_rbac.sql; RLS is keyed on
 * `current_setting('app.user_id')` (initiator/confirmer columns) so a
 * stolen DB session cannot escalate.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './tenant.schema.js';

// ============================================================================
// killswitch_authorities — grant ledger
// ============================================================================

export const killswitchAuthorities = pgTable(
  'killswitch_authorities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Glob-shaped scope. Examples:
     *   - `killswitch:platform:*`            — platform-wide killswitch
     *   - `killswitch:tenant:<tenantId>:*`   — per-tenant killswitch
     *   - `killswitch:junior:<juniorId>:*`   — per-junior killswitch
     *
     * Resolved at write time via prefix match against the canonical
     * scope string used by the kill-switch route.
     */
    scope: text('scope').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('killswitch_authorities_user_idx').on(t.userId),
    scopeIdx: index('killswitch_authorities_scope_idx').on(t.scope),
    activeIdx: index('killswitch_authorities_active_idx').on(
      t.userId,
      t.scope,
      t.revokedAt,
    ),
  }),
);

// ============================================================================
// killswitch_pending_confirmations — ephemeral two-operator state
// ============================================================================

export const killswitchPendingConfirmations = pgTable(
  'killswitch_pending_confirmations',
  {
    id: text('id').primaryKey(),
    /**
     * Canonical target descriptor. Shape:
     *   { scope: 'platform' | 'tenant:<id>', level: 'live' | 'degraded'
     *     | 'halt', reasonCode: string, note?: string }
     *
     * Stored as JSONB so the route can apply the kill at confirm-time
     * without re-validating the body.
     */
    killswitchTarget: jsonb('killswitch_target').notNull(),
    initiatorUserId: text('initiator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    initiatedAt: timestamp('initiated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: text('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * `initiated_at + 30 s`. Beyond this the row is dead. The confirm
     * route refuses any insert/update where `now() > expires_at`.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    initiatorIdx: index('killswitch_pending_initiator_idx').on(t.initiatorUserId),
    expiresIdx: index('killswitch_pending_expires_idx').on(t.expiresAt),
    confirmedIdx: index('killswitch_pending_confirmed_idx').on(t.confirmedAt),
  }),
);
