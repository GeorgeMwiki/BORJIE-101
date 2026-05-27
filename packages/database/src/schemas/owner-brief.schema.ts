/**
 * Owner Brief Snapshots — Wave OWNER-HOME.
 *
 * Companion to:
 *   - packages/database/src/migrations/0079_owner_brief_snapshots.sql
 *   - services/api-gateway/src/routes/owner/brief.hono.ts
 *   - services/consolidation-worker/src/tasks/owner-brief-cron.ts
 *   - Docs/research/owner-status-sota.md (one-round-trip composition)
 *
 * One Drizzle table:
 *
 *   ownerBriefSnapshots — cached daily owner home brief, one row per
 *                         (tenantId, snapshotDate). The 06:00 EAT cron
 *                         pre-computes the brief so the owner home
 *                         opens in a single read. The BFF endpoint
 *                         falls back to on-demand composition when no
 *                         cron snapshot exists yet (e.g. first visit
 *                         after midnight, new tenant). The composed
 *                         brief is persisted under `source='on-demand'`
 *                         so the next request hits the cache.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy. FORCE
 * RLS is enabled on the table (CLAUDE.md hard rule). The optional
 * hashChainId points back to the ai_audit_chain entry that recorded the
 * snapshot composition for forensic replay.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// owner_brief_snapshots — one row per (tenant, day)
// ============================================================================

export const ownerBriefSnapshots = pgTable(
  'owner_brief_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tenant scope. Bound by RLS via `app.tenant_id` GUC. */
    tenantId: uuid('tenant_id').notNull(),
    /** Calendar date (EAT) the snapshot represents. Unique with tenantId. */
    snapshotDate: date('snapshot_date').notNull(),
    /** Wall-clock at which the snapshot was composed. */
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Full composed brief — keys: dailyBrief, decisions, cashRunway,
     * productionVsTarget, cliffStatus, openHighIncidents, licenceHealth.
     * Shape pinned by the OwnerBrief zod schema in
     * `services/api-gateway/src/routes/owner/brief.hono.ts`.
     */
    brief: jsonb('brief').notNull().default({}),
    /** Provenance — either the 06:00 EAT cron or the on-demand BFF fallback. */
    source: text('source').notNull().default('cron'),
    /**
     * FK-soft link to `ai_audit_chain.id`. NULL when the audit append
     * failed (we still persist the snapshot; the audit gap is logged +
     * observable via the snapshot row's NULL hash_chain_id).
     */
    hashChainId: uuid('hash_chain_id'),
  },
  (t) => ({
    /** Hot path: load latest snapshot for a tenant. */
    tenantDateDescIdx: index('idx_obs_tenant_date_desc').on(
      t.tenantId,
      t.snapshotDate,
    ),
    /** UNIQUE(tenant_id, snapshot_date) → one snapshot per tenant per day. */
    tenantDateUniq: uniqueIndex('obs_tenant_date_uniq').on(
      t.tenantId,
      t.snapshotDate,
    ),
    /** Forensic verify of a single snapshot. */
    hashChainIdx: index('idx_obs_hash_chain').on(t.hashChainId),
  }),
);

export type OwnerBriefSnapshotRow = typeof ownerBriefSnapshots.$inferSelect;
export type OwnerBriefSnapshotInsert =
  typeof ownerBriefSnapshots.$inferInsert;

/** Valid values for the `source` column. */
export const OWNER_BRIEF_SNAPSHOT_SOURCES = ['cron', 'on-demand'] as const;
export type OwnerBriefSnapshotSource =
  (typeof OWNER_BRIEF_SNAPSHOT_SOURCES)[number];
