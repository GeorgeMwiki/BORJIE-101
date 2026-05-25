/**
 * sovereign_action_ledger — hash-chained audit ledger of executed
 * sovereign-tier actions.
 *
 * LITFIN parity gap C (`.planning/parity-litfin/07-agency.md`):
 *   LITFIN's `sovereign_action_ledger` carries `prev_hash` + `this_hash`
 *   (`audit-ledger.ts:46-71,77-100,260-299`) for tamper-evident replay.
 *   BORJIE's `kernel_action_audit` (migration 0123) is append-only
 *   but NOT hash-chained — a row edited post-hoc is undetectable.
 *
 * This table is the AGENCY-side ledger for executed sovereign-tier
 * actions (tenant eviction proposed, owner payout executed, KRA MRI
 * filed, GePG control number revoked, etc.). It complements the
 * kernel-side `kernel_action_audit` (which captures *every* executor
 * step transition, including pending/awaiting-approval) by recording
 * only the *executed* outcomes that crossed the four-eye gate.
 *
 * Hash chain shape (matches LITFIN `computeLedgerHash`):
 *
 *     this_hash = sha256(prev_hash || tenant_id || action_type
 *                        || payload_hash || executed_at_iso)
 *
 * `prev_hash` of the first row per (tenant_id) is GENESIS_HASH (a
 * constant of 64 zeroes). The chain is per-tenant — verification walks
 * rows ordered by (tenant_id, executed_at, id) and rejects on mismatch.
 *
 * Append-only by convention. There is NO update path on this table —
 * the service exposes only `appendLedgerEntry`, `getLedgerTail`, and
 * `verifyLedgerChain`. The Postgres role used by the gateway should
 * grant only INSERT + SELECT; a separate operator role can grant
 * DELETE for retention sweeps (a follow-up).
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Per-tenant chain origin. SHA-256 of 64 zero hex digits, used as the
 * `prev_hash` of the first appended row for every tenant. Keeping it
 * fixed lets `verifyLedgerChain` re-derive the head deterministically.
 */
export const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

export const sovereignActionLedger = pgTable(
  'sovereign_action_ledger',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    actionType: text('action_type').notNull(),
    payloadJson: jsonb('payload_json').notNull().default({}),
    /** SHA-256 over canonical-key-sorted JSON of `payload_json`. */
    payloadHash: text('payload_hash').notNull(),
    proposer: text('proposer').notNull(),
    /** Set of approver user-ids that signed off (typically 2 in
     *  four-eye flow). Stored as JSONB array so signers and timestamps
     *  can co-locate; the service writes only `[userId, ...]`. */
    approvers: jsonb('approvers').notNull().default([]),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
    /** Hash of the previous row in this tenant's chain. First row
     *  uses `GENESIS_HASH`. */
    prevHash: text('prev_hash').notNull(),
    /** sha256(prev_hash || tenant_id || action_type || payload_hash
     *  || executed_at_iso). Computed on insert; immutable after. */
    thisHash: text('this_hash').notNull(),
    /**
     * Optional reversal-plan payload (Phase D D2). Shape is action-
     * type specific (e.g. for `tenant.evict`: { unitId, customerId,
     * restoreLeaseId } — for `owner.payout`: { disbursementId,
     * clawbackBankRef }). Operators use this to drive a recovery
     * workflow if a sovereign action needs to be undone. NOT included
     * in the hash chain — see migration 0144 for the rationale.
     */
    rollbackPayload: jsonb('rollback_payload'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index('idx_sovereign_action_ledger_tenant_time').on(
      t.tenantId,
      t.executedAt,
      t.id,
    ),
    actionTypeIdx: index('idx_sovereign_action_ledger_action_type').on(
      t.tenantId,
      t.actionType,
    ),
    thisHashIdx: index('idx_sovereign_action_ledger_this_hash').on(
      t.thisHash,
    ),
  }),
);
