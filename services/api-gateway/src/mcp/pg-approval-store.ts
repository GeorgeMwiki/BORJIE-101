/**
 * Postgres-backed four-eye ApprovalStore for the public MCP surface.
 *
 * TIER-1 durability fix. The four-eye gate on the HIGH-risk sovereign
 * tool prefixes (kill_switch.* | four_eye.* | sovereign.* |
 * policy_rollout.*) used an in-memory ApprovalStore
 * (`createInMemoryApprovalStore`) in production, so every pending /
 * approved four-eye row VANISHED on gateway restart and was invisible
 * across replicas — a durability + correctness hole on the strongest
 * security gate.
 *
 * This adapter implements the SAME `ApprovalStore` port
 * (`@borjie/mcp-server-borjie`) over the durable `oauth_action_approvals`
 * table (migration 0121 + the `initiated_by` column from 0375). It
 * preserves the port's semantics exactly:
 *
 *   - separation-of-duties: `approve` rejects a self-approval (approver
 *     === initiator) with `SelfApprovalError`;
 *   - expiry: an approve after `expires_at` flips the row to `expired`
 *     rather than approving;
 *   - single-use: `consume` is an atomic compare-and-set
 *     (approved → consumed), so a replay after the row is already
 *     consumed fails.
 *
 * All state-transition writes are CONDITIONAL UPDATEs (compare-and-set on
 * `status`) so two replicas racing the same row converge on one winner —
 * the durable equivalent of the in-memory `status !== 'pending'` guards.
 */

import { and, eq } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { getSharedDatabaseClient } from '@borjie/database';
import {
  createInMemoryApprovalStore,
  SelfApprovalError,
  type ApprovalStore,
  type ActionApproval,
  type ApprovalStatus,
} from '@borjie/mcp-server-borjie';

type DatabaseClient = ReturnType<typeof getSharedDatabaseClient>;

/**
 * Drizzle view of `oauth_action_approvals` (migration 0121 +
 * `initiated_by` from 0375). Co-located here (not in the database
 * package barrel) so the durable store is a self-contained api-gateway
 * adapter; the SQL migration remains the single source of truth for the
 * table shape, RLS, and constraints.
 */
export const oauthActionApprovals = pgTable('oauth_action_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenId: uuid('token_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments').notNull().default({}),
  status: text('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  initiatedBy: text('initiated_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  deniedAt: timestamp('denied_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

type ApprovalRow = typeof oauthActionApprovals.$inferSelect;

const KNOWN_STATUSES: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>([
  'pending',
  'approved',
  'denied',
  'expired',
  'consumed',
]);

function narrowStatus(raw: string): ApprovalStatus {
  return (KNOWN_STATUSES as Set<string>).has(raw) ? (raw as ApprovalStatus) : 'pending';
}

function toMillis(value: Date | string | null): number | undefined {
  if (value === null) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return d.getTime();
}

function rowToApproval(row: ApprovalRow): ActionApproval {
  const base = {
    id: row.id,
    tokenId: row.tokenId,
    toolName: row.toolName,
    arguments: Object.freeze({ ...((row.arguments as Record<string, unknown>) ?? {}) }),
    status: narrowStatus(row.status),
    requestedAt: toMillis(row.requestedAt) ?? Date.now(),
    expiresAt: toMillis(row.expiresAt) ?? Date.now(),
    // `initiated_by` is NULL only for pre-0375 historical rows; empty
    // string keeps the field a string so a self-approval check never
    // silently coerces `null === approver`.
    initiatedBy: row.initiatedBy ?? '',
    approvedAt: toMillis(row.approvedAt),
    approvedBy: row.approvedBy ?? undefined,
    deniedAt: toMillis(row.deniedAt),
    consumedAt: toMillis(row.consumedAt),
  };
  return Object.freeze(base) as ActionApproval;
}

/**
 * Build the durable Postgres ApprovalStore over `oauth_action_approvals`.
 *
 * RLS: the table is FORCE-RLS with a token-isolation policy (migration
 * 0121). The caller binds `app.current_tenant_id` before invoking, so
 * every read/write is already tenant-scoped by the SQL layer.
 */
export function createPgApprovalStore(
  db: DatabaseClient,
  deps: { readonly now?: () => number } = {},
): ApprovalStore {
  const now = deps.now ?? (() => Date.now());

  async function getRow(id: string): Promise<ApprovalRow | null> {
    const rows = await db
      .select()
      .from(oauthActionApprovals)
      .where(eq(oauthActionApprovals.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  const store: ApprovalStore = {
    async create(input) {
      const inserted = await db
        .insert(oauthActionApprovals)
        .values({
          tokenId: input.tokenId,
          toolName: input.toolName,
          arguments: { ...input.arguments },
          status: 'pending',
          requestedAt: new Date(now()),
          expiresAt: new Date(input.expiresAt),
          initiatedBy: input.initiatedBy,
        } as typeof oauthActionApprovals.$inferInsert)
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('failed to persist approval');
      return rowToApproval(row);
    },

    async get(id) {
      const row = await getRow(id);
      return row ? rowToApproval(row) : null;
    },

    async approve(id, approver) {
      const existing = await getRow(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      if (existing.status !== 'pending') return rowToApproval(existing);

      // Separation-of-duties: the approver MUST differ from the initiator.
      // Enforced here so no caller can bypass — mirrors the in-memory store.
      if (existing.initiatedBy && approver === existing.initiatedBy) {
        throw new SelfApprovalError(id);
      }

      // Expiry: an approve after the deadline flips the row to `expired`
      // (compare-and-set on the still-pending row) rather than approving.
      if (toMillis(existing.expiresAt)! < now()) {
        await db
          .update(oauthActionApprovals)
          .set({ status: 'expired' })
          .where(
            and(
              eq(oauthActionApprovals.id, id),
              eq(oauthActionApprovals.status, 'pending'),
            ),
          );
        const after = await getRow(id);
        return rowToApproval(after ?? existing);
      }

      // Compare-and-set: only the replica that still sees `pending` wins.
      const updated = await db
        .update(oauthActionApprovals)
        .set({ status: 'approved', approvedAt: new Date(now()), approvedBy: approver })
        .where(
          and(
            eq(oauthActionApprovals.id, id),
            eq(oauthActionApprovals.status, 'pending'),
          ),
        )
        .returning();
      const row = updated[0] ?? (await getRow(id));
      if (!row) throw new Error(`unknown approval: ${id}`);
      return rowToApproval(row);
    },

    async deny(id, approver) {
      const existing = await getRow(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      if (existing.status !== 'pending') return rowToApproval(existing);
      const updated = await db
        .update(oauthActionApprovals)
        .set({ status: 'denied', deniedAt: new Date(now()), approvedBy: approver })
        .where(
          and(
            eq(oauthActionApprovals.id, id),
            eq(oauthActionApprovals.status, 'pending'),
          ),
        )
        .returning();
      const row = updated[0] ?? (await getRow(id));
      if (!row) throw new Error(`unknown approval: ${id}`);
      return rowToApproval(row);
    },

    async consume(id) {
      // Single-use: atomic compare-and-set approved → consumed. A replay
      // after the row is already consumed matches zero rows, so the caller
      // (dispatcher actions/execute) sees the guard fire and refuses the
      // re-run. Never a double-execution of a sovereign action.
      const updated = await db
        .update(oauthActionApprovals)
        .set({ status: 'consumed', consumedAt: new Date(now()) })
        .where(
          and(
            eq(oauthActionApprovals.id, id),
            eq(oauthActionApprovals.status, 'approved'),
          ),
        )
        .returning();
      const row = updated[0];
      if (row) return rowToApproval(row);
      // Nothing flipped — surface the real reason (unknown vs not-approved)
      // exactly like the in-memory store.
      const existing = await getRow(id);
      if (!existing) throw new Error(`unknown approval: ${id}`);
      throw new Error(`approval not approved: ${id} (${narrowStatus(existing.status)})`);
    },
  };

  return Object.freeze(store);
}

/**
 * Factory: durable Postgres store when a live db is present, in-memory
 * fallback (dev / test / registry-not-live) otherwise. The in-memory
 * store keeps the same port so the four-eye gate never fails closed for
 * a missing store; the durability guarantee only applies when db exists.
 */
export function createApprovalStore(
  db: DatabaseClient | null | undefined,
  deps: { readonly now?: () => number } = {},
): ApprovalStore {
  if (!db) return createInMemoryApprovalStore(deps);
  return createPgApprovalStore(db, deps);
}
