/**
 * Mr. Mwikila inbox recorder.
 *
 * Writes proposals / executions / reversals / commitments into
 * `mwikila_actions_inbox`. Every write:
 *
 *   1. Validates the input via zod.
 *   2. Picks the correct status given the tier (proposed for T0/T1,
 *      executed for T2/T3).
 *   3. Generates a reversal_token + reversal_until for T2.
 *   4. Persists the inbox row.
 *   5. Publishes a MwikilaProposesEvent or MwikilaActedEvent on the
 *      cockpit bus.
 *   6. Returns the immutable row.
 *
 * The decision-journal + audit-hash chain are stitched by the
 * higher-level `runAutonomousHandler` orchestrator (see
 * `handler-runtime.ts`) so the recorder stays narrow.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { publishCockpitEvent } from '../cockpit-events/index.js';
import { autonomy } from '@borjie/central-intelligence';
import {
  MwikilaError,
  RecordActionInputSchema,
  type ActionStatus,
  type DelegationTier,
  type MwikilaInboxRow,
  type RecordActionInput,
} from './types.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function rowToInbox(row: ExecRow): MwikilaInboxRow {
  return Object.freeze({
    id: row.id as string,
    tenantId: row.tenant_id as string,
    actingOnUserId: row.acting_on_user_id as string,
    actionKind: row.action_kind as string,
    category: row.category as MwikilaInboxRow['category'],
    delegationTier: row.delegation_tier as MwikilaInboxRow['delegationTier'],
    status: row.status as MwikilaInboxRow['status'],
    summary: row.summary as string,
    summarySw: row.summary_sw as string,
    rationale: row.rationale as string,
    payload: Object.freeze(
      (row.payload ?? {}) as Record<string, unknown>,
    ),
    reversalToken: (row.reversal_token as string) ?? null,
    reversalUntil: (row.reversal_until as string) ?? null,
    proposedAt: row.proposed_at as string,
    proposalTtlAt: (row.proposal_ttl_at as string) ?? null,
    executedAt: (row.executed_at as string) ?? null,
    ownerReviewedAt: (row.owner_reviewed_at as string) ?? null,
    ownerReviewedBy: (row.owner_reviewed_by as string) ?? null,
    reversedAt: (row.reversed_at as string) ?? null,
    committedAt: (row.committed_at as string) ?? null,
    auditChainHash: (row.audit_chain_hash as string) ?? null,
    decisionId: (row.decision_id as string) ?? null,
    blockedReason: (row.blocked_reason as string) ?? null,
    provenance: Object.freeze(
      (row.provenance ?? {}) as Record<string, unknown>,
    ),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  });
}

/**
 * Pick the initial status given the tier. T0/T1 → proposed; T2/T3 →
 * executed. Blocked is set externally when the inviolable rail trips.
 */
export function pickInitialStatus(tier: DelegationTier): ActionStatus {
  return autonomy.tierAllowsImmediateExecution(tier) ? 'executed' : 'proposed';
}

export interface MwikilaInboxRecorderDeps {
  readonly db: DbLike;
  readonly now?: () => Date;
}

export interface MwikilaInboxRecorder {
  recordAction(input: RecordActionInput): Promise<MwikilaInboxRow>;
  recordBlocked(input: {
    readonly tenantId: string;
    readonly actingOnUserId: string;
    readonly actionKind: string;
    readonly category: RecordActionInput['category'];
    readonly delegationTier: DelegationTier;
    readonly summary: string;
    readonly summarySw: string;
    readonly rationale: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly blockedReason: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
  }): Promise<MwikilaInboxRow>;
  approveProposal(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly reviewedByUserId: string;
  }): Promise<MwikilaInboxRow>;
  denyProposal(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly reviewedByUserId: string;
  }): Promise<MwikilaInboxRow>;
  reverseExecution(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly reversalToken: string;
    readonly reviewedByUserId: string;
  }): Promise<MwikilaInboxRow>;
  listPending(args: {
    readonly tenantId: string;
    readonly limit?: number;
  }): Promise<ReadonlyArray<MwikilaInboxRow>>;
  listRecent(args: {
    readonly tenantId: string;
    readonly limit?: number;
    readonly category?: RecordActionInput['category'];
    readonly status?: ActionStatus;
  }): Promise<ReadonlyArray<MwikilaInboxRow>>;
}

const DEFAULT_PROPOSAL_TTL_HOURS = 7 * 24;

export function createMwikilaInboxRecorder(
  deps: MwikilaInboxRecorderDeps,
): MwikilaInboxRecorder {
  const now = deps.now ?? (() => new Date());

  async function loadById(
    tenantId: string,
    id: string,
  ): Promise<MwikilaInboxRow | null> {
    const rows = rowsOf(
      await deps.db.execute(sql`
        SELECT * FROM mwikila_actions_inbox
         WHERE tenant_id = ${tenantId} AND id = ${id}
         LIMIT 1
      `),
    );
    if (rows.length === 0) return null;
    return rowToInbox(rows[0] as ExecRow);
  }

  return Object.freeze({
    async recordAction(input) {
      const parsed = RecordActionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new MwikilaError(
          'invalid_input',
          `recordAction invalid: ${parsed.error.message}`,
        );
      }
      const value = parsed.data;
      const tier = value.delegationTier as DelegationTier;
      const initialStatus = pickInitialStatus(tier);
      const nowIso = now().toISOString();
      const proposedAt = nowIso;

      const proposalTtl = value.proposalTtlHours ?? DEFAULT_PROPOSAL_TTL_HOURS;
      const proposalTtlAt =
        initialStatus === 'proposed'
          ? new Date(now().getTime() + proposalTtl * 3600 * 1000).toISOString()
          : null;

      const executedAt =
        initialStatus === 'executed'
          ? value.executedAt ?? nowIso
          : null;

      const reversalToken =
        tier === 'T2' && initialStatus === 'executed' ? randomUUID() : null;
      const reversalUntil =
        reversalToken !== null
          ? new Date(
              now().getTime() +
                (value.reversalWindowHours ?? 24) * 3600 * 1000,
            ).toISOString()
          : null;

      const provenance = value.provenance ?? { via: 'mwikila' };

      let rows: ReadonlyArray<ExecRow>;
      try {
        rows = rowsOf(
          await deps.db.execute(sql`
            INSERT INTO mwikila_actions_inbox (
              tenant_id, acting_on_user_id, action_kind, category,
              delegation_tier, status, summary, summary_sw, rationale,
              payload, reversal_token, reversal_until,
              proposed_at, proposal_ttl_at, executed_at, provenance
            ) VALUES (
              ${value.tenantId},
              ${value.actingOnUserId},
              ${value.actionKind},
              ${value.category},
              ${tier},
              ${initialStatus},
              ${value.summary},
              ${value.summarySw},
              ${value.rationale},
              ${JSON.stringify(value.payload)}::jsonb,
              ${reversalToken},
              ${reversalUntil ? sql`${reversalUntil}::timestamptz` : null},
              ${proposedAt}::timestamptz,
              ${proposalTtlAt ? sql`${proposalTtlAt}::timestamptz` : null},
              ${executedAt ? sql`${executedAt}::timestamptz` : null},
              ${JSON.stringify(provenance)}::jsonb
            )
            RETURNING *
          `),
        );
      } catch (err) {
        throw new MwikilaError(
          'persistence_failed',
          `recordAction insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const row = rowToInbox(rows[0] as ExecRow);

      // Cockpit SSE notify — proposes vs acted.
      publishCockpitEvent({
        kind:
          initialStatus === 'executed'
            ? 'mwikila.acted'
            : 'mwikila.proposes',
        tenantId: row.tenantId,
        emittedAt: nowIso,
        actionId: row.id,
        actionKind: row.actionKind,
        category: row.category,
        delegationTier: tier,
        summary: row.summary,
      });

      return row;
    },

    async recordBlocked(input) {
      const nowIso = now().toISOString();
      let rows: ReadonlyArray<ExecRow>;
      try {
        rows = rowsOf(
          await deps.db.execute(sql`
            INSERT INTO mwikila_actions_inbox (
              tenant_id, acting_on_user_id, action_kind, category,
              delegation_tier, status, summary, summary_sw, rationale,
              payload, proposed_at, blocked_reason, provenance
            ) VALUES (
              ${input.tenantId},
              ${input.actingOnUserId},
              ${input.actionKind},
              ${input.category},
              ${input.delegationTier},
              'blocked_by_inviolable',
              ${input.summary},
              ${input.summarySw},
              ${input.rationale},
              ${JSON.stringify(input.payload)}::jsonb,
              ${nowIso}::timestamptz,
              ${input.blockedReason},
              ${JSON.stringify(input.provenance ?? { via: 'mwikila' })}::jsonb
            )
            RETURNING *
          `),
        );
      } catch (err) {
        throw new MwikilaError(
          'persistence_failed',
          `recordBlocked insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const row = rowToInbox(rows[0] as ExecRow);
      publishCockpitEvent({
        kind: 'mwikila.proposes',
        tenantId: row.tenantId,
        emittedAt: nowIso,
        actionId: row.id,
        actionKind: row.actionKind,
        category: row.category,
        delegationTier: input.delegationTier,
        summary: `Blocked by safety rail (${input.blockedReason}): ${row.summary}`,
      });
      return row;
    },

    async approveProposal({ tenantId, id, reviewedByUserId }) {
      const existing = await loadById(tenantId, id);
      if (!existing) {
        throw new MwikilaError('not_found', `inbox row ${id} not found`);
      }
      if (existing.status !== 'proposed') {
        throw new MwikilaError(
          'wrong_status',
          `cannot approve in status=${existing.status}`,
        );
      }
      const nowIso = now().toISOString();
      const rows = rowsOf(
        await deps.db.execute(sql`
          UPDATE mwikila_actions_inbox
             SET status = 'owner_approved',
                 owner_reviewed_at = ${nowIso}::timestamptz,
                 owner_reviewed_by = ${reviewedByUserId},
                 updated_at = ${nowIso}::timestamptz
           WHERE tenant_id = ${tenantId} AND id = ${id}
           RETURNING *
        `),
      );
      return rowToInbox(rows[0] as ExecRow);
    },

    async denyProposal({ tenantId, id, reviewedByUserId }) {
      const existing = await loadById(tenantId, id);
      if (!existing) {
        throw new MwikilaError('not_found', `inbox row ${id} not found`);
      }
      if (existing.status !== 'proposed') {
        throw new MwikilaError(
          'wrong_status',
          `cannot deny in status=${existing.status}`,
        );
      }
      const nowIso = now().toISOString();
      const rows = rowsOf(
        await deps.db.execute(sql`
          UPDATE mwikila_actions_inbox
             SET status = 'owner_denied',
                 owner_reviewed_at = ${nowIso}::timestamptz,
                 owner_reviewed_by = ${reviewedByUserId},
                 updated_at = ${nowIso}::timestamptz
           WHERE tenant_id = ${tenantId} AND id = ${id}
           RETURNING *
        `),
      );
      return rowToInbox(rows[0] as ExecRow);
    },

    async reverseExecution({ tenantId, id, reversalToken, reviewedByUserId }) {
      const existing = await loadById(tenantId, id);
      if (!existing) {
        throw new MwikilaError('not_found', `inbox row ${id} not found`);
      }
      if (existing.status !== 'executed') {
        throw new MwikilaError(
          'wrong_status',
          `cannot reverse in status=${existing.status}`,
        );
      }
      if (
        existing.reversalToken === null ||
        existing.reversalToken !== reversalToken
      ) {
        throw new MwikilaError(
          'reversal_token_mismatch',
          'reversal token does not match',
        );
      }
      if (existing.reversalUntil !== null) {
        const until = new Date(existing.reversalUntil).getTime();
        if (now().getTime() > until) {
          throw new MwikilaError(
            'reversal_window_expired',
            'reversal window has passed',
          );
        }
      }
      const nowIso = now().toISOString();
      const rows = rowsOf(
        await deps.db.execute(sql`
          UPDATE mwikila_actions_inbox
             SET status = 'reversed',
                 reversed_at = ${nowIso}::timestamptz,
                 owner_reviewed_at = ${nowIso}::timestamptz,
                 owner_reviewed_by = ${reviewedByUserId},
                 updated_at = ${nowIso}::timestamptz
           WHERE tenant_id = ${tenantId} AND id = ${id}
           RETURNING *
        `),
      );
      return rowToInbox(rows[0] as ExecRow);
    },

    async listPending({ tenantId, limit = 50 }) {
      const rows = rowsOf(
        await deps.db.execute(sql`
          SELECT * FROM mwikila_actions_inbox
           WHERE tenant_id = ${tenantId}
             AND status IN ('proposed','executed','blocked_by_inviolable')
           ORDER BY proposed_at DESC
           LIMIT ${limit}
        `),
      );
      return rows.map(rowToInbox);
    },

    // Param shape annotated explicitly: with noImplicitAny disabled the
    // destructured params would otherwise widen to `any`, which causes
    // the optional `category` to look required to the interface check.
    async listRecent({
      tenantId,
      limit = 100,
      category,
      status,
    }: {
      readonly tenantId: string;
      readonly limit?: number;
      readonly category?: RecordActionInput['category'];
      readonly status?: ActionStatus;
    }) {
      const rows = rowsOf(
        await deps.db.execute(sql`
          SELECT * FROM mwikila_actions_inbox
           WHERE tenant_id = ${tenantId}
             AND (${category ?? null}::text IS NULL OR category = ${category ?? null})
             AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
           ORDER BY proposed_at DESC
           LIMIT ${limit}
        `),
      );
      return rows.map(rowToInbox);
    },
  });
}
