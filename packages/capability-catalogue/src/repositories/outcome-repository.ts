/**
 * Outcome repository — port + in-memory + SQL adapters.
 *
 * Outcomes are FK-linked to invocations. The worker reads outcomes
 * for the same invocation-window slice that powered the competence
 * computation.
 *
 * @module @borjie/capability-catalogue/repositories/outcome-repository
 */

import type { Outcome } from '../types.js';

export interface OutcomeRepository {
  insert(row: Outcome): Promise<void>;
  /**
   * Fetch the outcomes for a given set of invocation ids. Returns at
   * most one outcome per invocation id.
   */
  listForInvocations(args: {
    readonly invocationIds: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<Outcome>>;
}

export function createInMemoryOutcomeRepository(): OutcomeRepository {
  const rows: Array<Outcome> = [];

  return {
    async insert(row) {
      rows.push(Object.freeze({ ...row }));
    },
    async listForInvocations({ invocationIds }) {
      if (invocationIds.length === 0) return Object.freeze([]);
      const ids = new Set(invocationIds);
      const out: Array<Outcome> = [];
      for (const r of rows) {
        if (ids.has(r.invocationId)) out.push(r);
      }
      return Object.freeze(out);
    },
  };
}

export interface SqlOutcomeDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function rowToOutcome(r: Record<string, unknown>): Outcome {
  const ts = r['recorded_at'];
  return Object.freeze({
    id: r['id'] as string,
    invocationId: r['invocation_id'] as string,
    claimedConfidence: Number(r['claimed_confidence'] ?? 0),
    observedOutcome: r['observed_outcome'] as Outcome['observedOutcome'],
    userFollowthrough: r['user_followthrough'] as Outcome['userFollowthrough'],
    recordedAt: ts instanceof Date ? ts.toISOString() : (ts as string),
    auditHash: r['audit_hash'] as string,
  });
}

export function createSqlOutcomeRepository(args: {
  readonly driver: SqlOutcomeDriver;
}): OutcomeRepository {
  return {
    async insert(row) {
      await args.driver.query({
        text: `
          INSERT INTO capability_outcomes
            (id, invocation_id, claimed_confidence, observed_outcome,
             user_followthrough, recorded_at, audit_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        values: [
          row.id,
          row.invocationId,
          row.claimedConfidence,
          row.observedOutcome,
          row.userFollowthrough,
          row.recordedAt,
          row.auditHash,
        ],
      });
    },
    async listForInvocations({ invocationIds }) {
      if (invocationIds.length === 0) return Object.freeze([]);
      const rows = await args.driver.query({
        text: `
          SELECT id, invocation_id, claimed_confidence, observed_outcome,
                 user_followthrough, recorded_at, audit_hash
            FROM capability_outcomes
           WHERE invocation_id = ANY($1::uuid[])
        `,
        values: [invocationIds],
      });
      return Object.freeze(rows.map(rowToOutcome));
    },
  };
}
