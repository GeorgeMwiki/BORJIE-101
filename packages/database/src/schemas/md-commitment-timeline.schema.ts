/**
 * MD commitment timeline persistence — the APPEND-ONLY, hash-chained lifecycle
 * trail of the MD's durable commitment ledger (the living-MD organ audit spine).
 *
 * Companion to migration 0339_md_commitment_timeline.sql and the
 * `createTimelineSink` port
 * (services/api-gateway/src/composition/living-md/timeline-event-sink.ts).
 *
 * One immutable row per lifecycle event of an `md_commitments` row. The trail is
 * the "felt" loop made forensic: when the commitment was deferred, when an event
 * flipped it due, when it became overdue, when a proposal resurfaced it, and the
 * positive-proof CLOSURE (or the honest reopen when a deadline passed
 * unconfirmed). closure-by-confirmation, never by timeout.
 *
 *   - `eventKind` is honest about WHAT happened (deferred | scheduled |
 *     became_due | overdue | nudged | blocked | reopened | confirmed | done |
 *     someday_resurfaced).
 *   - `proofKind` + `evidenceIds` carry the positive-proof closure.
 *   - `auditHash = sha256(previousHash || commitmentId || eventKind ||
 *     newStatus || isoTs)` stitches a per-commitment chain; `previousHash`
 *     links each row to the one before it so a truncated/mutated trail is
 *     detectable (the CLAUDE.md hash-chained, append-only audit hard rule).
 *
 * Tenant-scoped, RLS FORCE (canonical `app.current_tenant_id` GUC +
 * service-role bypass for the out-of-band reconcile sweep / someday supervisor),
 * migration 0339. NULL-tenant rows are never written by this store.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/** The honest lifecycle taxonomy of a commitment timeline event. */
export type MdTimelineEventKind =
  | 'deferred'
  | 'scheduled'
  | 'became_due'
  | 'overdue'
  | 'nudged'
  | 'blocked'
  | 'reopened'
  | 'confirmed'
  | 'done'
  | 'someday_resurfaced';

// ============================================================================
// md_commitment_timeline — the per-commitment append-only lifecycle trail.
// ============================================================================

export const mdCommitmentTimeline = pgTable(
  'md_commitment_timeline',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The md_commitments.id this lifecycle event belongs to (no FK, by convention). */
    commitmentId: text('commitment_id').notNull(),
    /** WHAT happened — honest lifecycle taxonomy. */
    eventKind: text('event_kind').$type<MdTimelineEventKind>().notNull(),
    /** When the event occurred (sink-stamped from the injected clock). */
    eventAt: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
    /** Status transition source (nullable on a non-transition event). */
    previousStatus: text('previous_status'),
    newStatus: text('new_status'),
    /** Positive-proof closure metadata (closure-by-confirmation, never timeout). */
    proofKind: text('proof_kind'),
    /** Evidence-required hard rule: the evidence ids cited at this event. */
    evidenceIds: jsonb('evidence_ids')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    /** Who/what caused it: 'mwikila' | 'owner' | 'reconcile' | 'event:<key>'. */
    actor: text('actor').notNull().default('mwikila'),
    /** Per-commitment hash-chain stitch (append-only, tamper-evident). */
    auditHash: text('audit_hash').notNull(),
    /** The prior row's auditHash this row chained from (NULL at genesis). */
    previousHash: text('previous_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A commitment's full trail, oldest → newest (living-plan /:id read).
    commitmentIdx: index('md_commitment_timeline_commitment_idx').on(
      t.tenantId,
      t.commitmentId,
      t.eventAt,
    ),
    // The tenant-wide recent-activity feed (living-plan /past read).
    tenantRecentIdx: index('md_commitment_timeline_tenant_recent_idx').on(
      t.tenantId,
      t.eventAt,
    ),
  }),
);

export type MdCommitmentTimelineRow = typeof mdCommitmentTimeline.$inferSelect;
export type MdCommitmentTimelineInsert =
  typeof mdCommitmentTimeline.$inferInsert;
