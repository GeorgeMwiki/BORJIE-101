/**
 * platform_killswitch_state — DB-backed override for the kernel
 * killswitch.
 *
 * Central Command Phase B (B1 — HQ Tool Drizzle Adapters). Backs the
 * `platform.set_killswitch` HQ tool (destroy-tier, four-eye-approved).
 *
 * The kernel's existing `KillswitchPort` (in `kernel/killswitch.ts`)
 * reads the killswitch state from env vars. This DB-backed override
 * TAKES PRECEDENCE — when a row exists for the matching scope the
 * adapter publishes a cross-portal event so every brain instance picks
 * up the new state immediately (without restart).
 *
 * Migration 0138. Companion adapter is
 * `packages/database/src/services/platform/killswitch-write.service.ts`.
 */
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const platformKillswitchState = pgTable(
  'platform_killswitch_state',
  {
    id: text('id').primaryKey(),
    /**
     * Either `platform` for the platform-wide killswitch or
     * `tenant:<tenantId>` for the per-tenant variant. The HQ tool's
     * `KillswitchScopeSchema` enforces the shape; the DB stores it
     * verbatim so reads stay cheap.
     */
    scope: text('scope').notNull(),
    /** `live` | `degraded` | `halt` — see kernel `KillswitchLevel`. */
    level: text('level').notNull(),
    /** Stable canonical reason code — see kernel `KillswitchReasonCode`. */
    reasonCode: text('reason_code').notNull(),
    /** Optional free-form operator note (≤500 chars; validated upstream). */
    note: text('note'),
    /** Previous level snapshot — required by the HQ-tool rollback contract. */
    prevLevel: text('prev_level'),
    /** Previous reason snapshot — required by the HQ-tool rollback contract. */
    prevReasonCode: text('prev_reason_code'),
    /** Previous note snapshot — required by the HQ-tool rollback contract. */
    prevNote: text('prev_note'),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
    setBy: text('set_by').notNull(),
  },
  (t) => ({
    scopeUq: uniqueIndex('uq_platform_killswitch_state_scope').on(t.scope),
    setAtIdx: index('idx_platform_killswitch_state_set_at').on(t.setAt),
  }),
);
