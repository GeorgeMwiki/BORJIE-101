/**
 * MD commitments persistence — the brain's DEFERRAL / FOLLOW-THROUGH commitment
 * ledger (prospective memory + the closed loop).
 *
 * Companion to migration 0321_md_commitments.sql and the
 * `MdCommitmentRepository` port (../repositories/md-commitment-repository.ts).
 *
 * One durable row per deferred MD commitment. Mr. Mwikila externalises every
 * intention here the moment it is formed (an LLM brain has no native
 * prospective memory), so the commitment SURVIVES a worker restart, a model-
 * context reset, and a week of owner silence — the EstateMind RECONCILE sweep
 * re-reads every OPEN row each tick and NEVER drops a thread.
 *
 *   - The GTD taxonomy collapses into ONE `class` discriminator
 *     (next_action | waiting_for | tickler | someday).
 *   - The WAIT-FOR trigger is ONE of three typed shapes carried in
 *     `triggerKind` + `triggerSpec` (jsonb: { dueAt } | { eventKey } |
 *     { predicate }); `triggerDueAt` is the time-fire / fallback-deadline
 *     timestamp so silence still surfaces.
 *   - The lifecycle is honest: open | scheduled | overdue | blocked | done |
 *     reopened — `done` is set ONLY on positive proof (`confirmedAt` +
 *     `confirmationKind`), never optimistically.
 *   - `sovereign=true` (licence/royalty/money/deletion) → HITL forever; the
 *     reconcile sweep + ladder route it to the mwikila_actions_inbox safe-halt,
 *     never auto-actuating.
 *
 * Tenant-scoped, RLS FORCE (canonical `app.current_tenant_id` GUC +
 * service-role bypass for the out-of-band reconcile worker), migration 0321.
 * NULL-tenant rows are never written by this store.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** GTD discriminator — the four commitment classes. */
export type MdCommitmentClass =
  | 'next_action'
  | 'waiting_for'
  | 'tickler'
  | 'someday';

/** The WAIT-FOR trigger family. */
export type MdCommitmentTriggerKind = 'time' | 'event' | 'condition';

/** Honest lifecycle — never optimistic. */
export type MdCommitmentStatus =
  | 'open'
  | 'scheduled'
  | 'overdue'
  | 'blocked'
  | 'done'
  | 'reopened';

/**
 * Discriminated trigger spec stored in `trigger_spec` jsonb.
 *   time      → { dueAt: ISO-8601 }
 *   event     → { eventKey: string }            (e.g. 'ledger.credit')
 *   condition → { predicate: Record<...> }       (serialised over estate state)
 */
export interface MdCommitmentTriggerSpec {
  readonly dueAt?: string;
  readonly eventKey?: string;
  readonly predicate?: Record<string, unknown>;
}

// ============================================================================
// md_commitments — the per-tenant durable deferral backlog.
// ============================================================================

export const mdCommitments = pgTable(
  'md_commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The owner the commitment is held for (surface target; forensic replay). */
    ownerId: text('owner_id').notNull().default('mwikila'),
    /** Ties to a work-cycle pending_thread / chat thread for continuity. */
    threadId: text('thread_id'),
    /** GTD class: next_action | waiting_for | tickler | someday. */
    class: text('class').$type<MdCommitmentClass>().notNull(),
    /** Domain verb: royalty.filing | licence.renewal | offtake.confirm ... */
    kind: text('kind').notNull().default('general'),
    title: text('title').notNull(),
    /** Bilingual absolutism — complete SW copy alongside EN. */
    titleSw: text('title_sw').notNull(),
    rationale: text('rationale').notNull(),
    /** Evidence-required hard rule: >=1 evidence id. */
    evidenceIds: jsonb('evidence_ids')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    /** WAIT-FOR family: time | event | condition. */
    triggerKind: text('trigger_kind')
      .$type<MdCommitmentTriggerKind>()
      .notNull(),
    /** Discriminated trigger spec ({ dueAt } | { eventKey } | { predicate }). */
    triggerSpec: jsonb('trigger_spec')
      .$type<MdCommitmentTriggerSpec>()
      .notNull()
      .default({}),
    /** Time-fire / event+condition fallback deadline (silence still surfaces). */
    triggerDueAt: timestamp('trigger_due_at', { withTimezone: true }),
    /** Honest lifecycle. */
    status: text('status')
      .$type<MdCommitmentStatus>()
      .notNull()
      .default('open'),
    /** Current ladder rung: 0=in-app .. 4=mining_escalations. */
    rungLevel: integer('rung_level').notNull().default(0),
    /** HIGH-risk: licence/royalty/money/deletion → safe-halt, HITL forever. */
    sovereign: boolean('sovereign').notNull().default(false),
    /** Idempotent resurfacing stamp. */
    lastNudgedAt: timestamp('last_nudged_at', { withTimezone: true }),
    /** Positive-proof acknowledgement of a surfaced rung (gates rung advance). */
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    /** Set ONLY on positive proof of completion. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** 'regulator_ack' | 'ledger_entry' | 'owner_approved' | ... */
    confirmationKind: text('confirmation_kind'),
    /** Why a commitment was blocked / abandoned (honest status). */
    blockedReason: text('blocked_reason'),
    /** Reuse the 0303 retry discipline for surface/delivery attempts. */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Hash-chained closure stitch (append-only). */
    auditChainHash: text('audit_chain_hash'),
    /** UNIQUE(tenant_id, idempotency_key) — never double-create a deferral. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dueIdx: index('md_commitments_due_idx').on(t.triggerDueAt),
    openIdx: index('md_commitments_open_idx').on(
      t.tenantId,
      t.status,
      t.updatedAt,
    ),
    deadlineIdx: index('md_commitments_deadline_idx').on(t.triggerDueAt),
    eventIdx: index('md_commitments_event_idx').on(
      t.tenantId,
      t.triggerKind,
      t.status,
    ),
    idemUniq: uniqueIndex('md_commitments_idem_uniq').on(
      t.tenantId,
      t.idempotencyKey,
    ),
  }),
);

export type MdCommitmentRow = typeof mdCommitments.$inferSelect;
export type MdCommitmentInsert = typeof mdCommitments.$inferInsert;
