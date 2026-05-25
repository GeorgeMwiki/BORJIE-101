/**
 * Reflexion buffer — Reflexion (Shinn et al., NeurIPS 2023) pattern.
 *
 * At session end the kernel writes a short verbal reflection
 * ("Last time I assumed Unit 4B but the user said 4F — ask before
 * fuzzy-matching") so the NEXT session for the same (tenant, user)
 * can read it and avoid the same failure mode.
 *
 * Pure prompt-layer memory — never touches model weights. Stored as
 * plain text; the kernel just injects the last N reflections into the
 * system prompt at session start.
 *
 * Migration 0184 extended the table with:
 *   - `importance`   REAL 0..1 — written by the recorder, consumed by
 *                    pass-4 (prune-stale) so high-importance lessons
 *                    survive their normal age-out window.
 *   - `task_id`      TEXT NULL — optional caller-provided task handle
 *                    so consolidation passes can join back to the
 *                    originating agent action without depending on
 *                    `session_id`.
 *   - `pruned_at`    TIMESTAMPTZ NULL — set by pass-4. The loader
 *                    filters `pruned_at IS NULL` so pruned rows stop
 *                    surfacing without losing audit history.
 *   - `cluster_id`   TEXT NULL — pass-1 (dedupe-cluster) writes the
 *                    representative reflection's id here on each
 *                    duplicate so the loader can collapse a noisy
 *                    cluster into a single bullet.
 */

import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const reflexionBuffer = pgTable(
  'reflexion_buffer',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    /**
     * Optional caller-provided task handle. Sleep passes use it to join
     * the reflexion row back to the originating agent action without
     * depending on `session_id` (which may be missing for cron/agent
     * pipelines that don't run inside a user session).
     */
    taskId: text('task_id'),
    /** The verbal reflection — capped at 4 000 chars by the writer. */
    reflection: text('reflection').notNull(),
    /** 'success' | 'failure' | 'mixed' */
    outcome: text('outcome').notNull(),
    /**
     * 0..1 caller-supplied importance. Pass-4 (prune-stale) uses it as
     * a multiplier on the age-out window: a reflexion at importance=1.0
     * never gets pruned by age alone; a reflexion at importance=0.0
     * gets pruned the instant it crosses `MAX_AGE_DAYS`.
     */
    importance: real('importance').notNull().default(0.5),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Set by pass-4 when the row is soft-pruned. Loader filters
     * `pruned_at IS NULL`; the row stays in the table for audit.
     */
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
    /**
     * Set by pass-1 (dedupe-cluster) to the representative reflexion's
     * id. NULL means "this row is the representative (or has not yet
     * been clustered)".
     */
    clusterId: text('cluster_id'),
    /** Telemetry — bumped every time the retriever surfaces this row. */
    retrievedCount: integer('retrieved_count').notNull().default(0),
  },
  (t) => ({
    perUserTimeIdx: index('idx_reflexion_per_user').on(
      t.tenantId,
      t.userId,
      t.recordedAt,
    ),
    activePerUserIdx: index('idx_reflexion_active_per_user').on(
      t.tenantId,
      t.userId,
      t.prunedAt,
      t.recordedAt,
    ),
  }),
);

/**
 * Consolidated guidelines doc — pass-3 (update-guidelines) writes here.
 *
 * Each row is one (tenant, user-or-tenant-wide, slug) guideline phrased
 * as "when X happens, do Y". Pass-3 deduplicates against existing rows
 * via the `slug`; high-confidence amendments overwrite the body, low
 * confidence ones append.
 *
 * Loader reads the most-recent N guidelines for the (tenant, user) and
 * prepends them ABOVE the recent reflexions in the system prompt, on
 * the theory that crystallised guidelines outrank raw reflexions.
 */
export const reflexionGuidelines = pgTable(
  'reflexion_guidelines',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * NULL = tenant-wide. Pass-3 emits both per-user and tenant-wide
     * guidelines depending on whether the underlying reflexion cluster
     * is dominated by a single user.
     */
    userId: text('user_id'),
    /** Stable identifier for dedupe: lowercased "when-X-then-Y" key. */
    slug: text('slug').notNull(),
    /** The phrased guideline text, max ~600 chars by the pass writer. */
    body: text('body').notNull(),
    /** 0..1 confidence the auditor assigned at write time. */
    confidence: real('confidence').notNull().default(0.5),
    /** Source reflexion ids that produced this guideline (JSON array). */
    sourceReflexionIds: text('source_reflexion_ids').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    perTenantSlugIdx: index('idx_reflexion_guidelines_tenant_slug').on(
      t.tenantId,
      t.slug,
    ),
    perUserUpdatedIdx: index('idx_reflexion_guidelines_per_user_updated').on(
      t.tenantId,
      t.userId,
      t.updatedAt,
    ),
  }),
);
