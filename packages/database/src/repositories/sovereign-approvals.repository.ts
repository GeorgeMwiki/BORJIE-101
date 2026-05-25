/**
 * Postgres ApprovalStore — Drizzle adapter for the four-eye
 * approval gate's `ApprovalStore` port (defined in
 * @borjie/central-intelligence/kernel/four-eye-approval).
 *
 * Stored as a single row per ProposedAction: one mutable `status` and
 * a JSON `signatures` array that grows append-only as approvers sign.
 */

import { and, eq } from 'drizzle-orm';
import { sovereignApprovals } from '../schemas/sovereign-approvals.schema.js';
import type { DatabaseClient } from '../client.js';

export type ApprovalStatus =
  | 'pending' | 'one-eye' | 'approved' | 'rejected' | 'expired';

export interface ApprovalSignature {
  readonly approverUserId: string;
  readonly verdict: 'approve' | 'reject';
  readonly comment: string | null;
  readonly signedAt: string;
}

export interface ProposedAction {
  readonly id: string;
  readonly proposerUserId: string;
  readonly thoughtId: string;
  readonly summary: string;
  readonly toolName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly stakes: 'medium' | 'high' | 'critical';
  readonly proposedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalRecord {
  readonly action: ProposedAction;
  readonly status: ApprovalStatus;
  readonly signatures: ReadonlyArray<ApprovalSignature>;
}

export interface ApprovalStore {
  put(record: ApprovalRecord): Promise<void>;
  get(actionId: string): Promise<ApprovalRecord | null>;
  list(filter?: { status?: ApprovalStatus }): Promise<ReadonlyArray<ApprovalRecord>>;
}

export interface PgApprovalStoreScope {
  readonly tenantId: string | null;
}

export function createPgApprovalStore(
  db: DatabaseClient,
  scope: PgApprovalStoreScope,
): ApprovalStore {
  return {
    async put(record) {
      const row = recordToRow(record, scope.tenantId);
      await db
        .insert(sovereignApprovals)
        .values(row as never)
        .onConflictDoUpdate({
          target: sovereignApprovals.actionId,
          set: {
            status: record.status,
            signatures: record.signatures.map((s) => ({ ...s })),
            updatedAt: new Date(),
          } as never,
        });
    },

    async get(actionId) {
      const rows = await db
        .select()
        .from(sovereignApprovals)
        .where(eq(sovereignApprovals.actionId, actionId))
        .limit(1);
      const r = rows[0];
      return r ? rowToRecord(r) : null;
    },

    async list(filter) {
      const baseConditions = scope.tenantId
        ? [eq(sovereignApprovals.tenantId, scope.tenantId)]
        : [];
      if (filter?.status) baseConditions.push(eq(sovereignApprovals.status, filter.status));
      const where = baseConditions.length > 0 ? and(...baseConditions) : undefined;

      const rows = where
        ? await db.select().from(sovereignApprovals).where(where)
        : await db.select().from(sovereignApprovals);

      return rows.map(rowToRecord);
    },
  };
}

function recordToRow(
  record: ApprovalRecord,
  tenantId: string | null,
): Record<string, unknown> {
  return {
    actionId: record.action.id,
    tenantId,
    proposerUserId: record.action.proposerUserId,
    thoughtId: record.action.thoughtId,
    summary: record.action.summary,
    toolName: record.action.toolName,
    payload: { ...record.action.payload },
    stakes: record.action.stakes,
    status: record.status,
    signatures: record.signatures.map((s) => ({ ...s })),
    proposedAt: new Date(record.action.proposedAt),
    expiresAt: new Date(record.action.expiresAt),
    updatedAt: new Date(),
  };
}

function rowToRecord(r: typeof sovereignApprovals.$inferSelect): ApprovalRecord {
  const signatures: ApprovalSignature[] = Array.isArray(r.signatures)
    ? (r.signatures as ApprovalSignature[])
    : [];
  return {
    action: {
      id: r.actionId,
      proposerUserId: r.proposerUserId,
      thoughtId: r.thoughtId,
      summary: r.summary,
      toolName: r.toolName,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      stakes: r.stakes as 'medium' | 'high' | 'critical',
      proposedAt: r.proposedAt instanceof Date ? r.proposedAt.toISOString() : String(r.proposedAt),
      expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : String(r.expiresAt),
    },
    status: r.status as ApprovalStatus,
    signatures,
  };
}
