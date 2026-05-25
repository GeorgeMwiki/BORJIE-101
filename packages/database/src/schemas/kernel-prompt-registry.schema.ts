/**
 * kernel_prompt_registry — per-capability prompt version store.
 *
 * Central Command Phase D (D5 — Rollout safety). Backs the kernel's
 * rollout controller + SLO tracker. One row per `(capability, version)`
 * pair; status transitions march each row through the rollout state
 * machine `shadow -> canary -> canary-25 -> active`, with `degraded`
 * and `archived` as terminal-ish sinks (degraded held for review,
 * archived kept for audit replay).
 *
 * Migration 0148. Companion service is
 * `packages/database/src/services/kernel-prompt-registry.service.ts`.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';

export type KernelPromptStatus =
  | 'shadow'
  | 'canary'
  | 'canary-25'
  | 'active'
  | 'degraded'
  | 'archived';

export const kernelPromptRegistry = pgTable(
  'kernel_prompt_registry',
  {
    id: text('id').primaryKey(),
    /**
     * Free-form capability handle (e.g. `kernel.identity`, `support-bot`,
     * `tenant.eviction.compose`). The rollout controller addresses
     * prompts by this string and the kernel composes one per turn.
     */
    capability: text('capability').notNull(),
    /**
     * Operator-assigned semantic version (e.g. `v42`, `2026-05-17a`).
     * Unique within a capability — `(capability, version)` is the
     * stable address; the surrogate `id` is for foreign-key joins only.
     */
    version: text('version').notNull(),
    /**
     * The full instruction body shipped to the sensor. We store TEXT
     * rather than JSONB because the kernel concatenates this into a
     * system-prompt buffer verbatim — JSONB would force a round-trip
     * through `JSON.stringify` and lose the operator's whitespace.
     */
    promptText: text('prompt_text').notNull(),
    /**
     * Eval bundle id that signed off on this prompt. The promote API
     * cross-checks that an offline golden-set run referencing this
     * bundle scored above the per-capability threshold BEFORE flipping
     * the row to `canary`.
     */
    goldenSetVersion: text('golden_set_version').notNull(),
    /**
     * Rollout state machine. Check-constrained at the SQL layer so a
     * buggy admin tool can never stash a free-form value here.
     */
    status: text('status').notNull().default('shadow'),
    /**
     * Last status-change timestamp. Useful for the operator UI's
     * "last promoted X minutes ago" indicator and for the SLO tracker's
     * window arithmetic.
     */
    promotedAt: timestamp('promoted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Admin subject from the JWT that issued the API call. Mandatory.
     */
    promotedBy: text('promoted_by').notNull(),
    /**
     * Stamped when status transitions to `archived`. Stays NULL while
     * the row is live in any rollout state.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedReason: text('archived_reason'),
    /**
     * Free-form bag for per-capability hints (e.g. SLO threshold
     * overrides, rollout schedule, golden-set tag). The rollout
     * controller reads `metadata.sloOverrides` to decide its
     * thresholds; missing keys collapse to per-capability defaults.
     */
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    capabilityVersionUq: unique('uq_kernel_prompt_registry_capability_version').on(
      t.capability,
      t.version,
    ),
    capabilityStatusIdx: index(
      'idx_kernel_prompt_registry_capability_status',
    ).on(t.capability, t.status),
    promotedAtIdx: index('idx_kernel_prompt_registry_promoted_at').on(
      t.promotedAt,
    ),
  }),
);
