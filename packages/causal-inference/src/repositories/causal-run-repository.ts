/**
 * `causal_runs` repository — in-memory + SQL adapter.
 *
 * Two adapters:
 *
 *  - In-memory — drives unit tests and the default composition root.
 *  - SQL — wired by the host service against drizzle. Kept drizzle-
 *    free at the package boundary so we can import from the edge.
 *
 * Rows are frozen on insert. Every row carries an `auditHash` that
 * chains against the prior row in the tenant's chain — tamper-evident
 * audit. The chain head is tracked per tenant in memory; the SQL
 * adapter reads it back from the latest row.
 *
 * @module @borjie/causal-inference/repositories/causal-run-repository
 */

import { randomUUID } from 'node:crypto';
import { GENESIS_HASH, chainHash } from '@borjie/audit-hash-chain';
import {
  type CausalRunInsert,
  type CausalRunRecord,
  type CausalRunRepository,
  type IdentificationStrategy,
} from '../types.js';

export interface InMemoryCausalRunRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryCausalRunRepository(
  deps: InMemoryCausalRunRepoDeps = { now: () => new Date() },
): CausalRunRepository {
  const rows = new Map<string, CausalRunRecord>();
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string | null {
    return chainHead.get(tenantId) ?? null;
  }

  return {
    async insert(input: CausalRunInsert): Promise<CausalRunRecord> {
      const id = randomUUID();
      const ranAt = deps.now();
      const headValue = head(input.tenantId);
      // Persist '' for the genesis row to match the SQL schema default
      // (`prev_hash text NOT NULL DEFAULT ''`). Hashing uses GENESIS_HASH.
      const prevHashStored = headValue ?? '';
      const prevHashForChain = headValue ?? GENESIS_HASH;
      const auditHash = chainHash({
        prev: prevHashForChain,
        payload: {
          op: 'insert',
          tenantId: input.tenantId,
          question: input.question,
          treatment: input.treatment,
          outcome: input.outcome,
          identification: input.identification,
          effectEstimate: input.effectEstimate,
          ciLow: input.ciLow,
          ciHigh: input.ciHigh,
          ranAt: ranAt.toISOString(),
        },
      });
      const row: CausalRunRecord = Object.freeze({
        id,
        tenantId: input.tenantId,
        question: input.question,
        treatment: input.treatment,
        outcome: input.outcome,
        identification: input.identification,
        effectEstimate: input.effectEstimate,
        ciLow: input.ciLow,
        ciHigh: input.ciHigh,
        ranAt,
        prevHash: prevHashStored,
        auditHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) return null;
      return row;
    },

    async listForTenant(tenantId, filter) {
      const out: CausalRunRecord[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (
          filter?.identification !== undefined &&
          row.identification !== filter.identification
        ) {
          continue;
        }
        out.push(row);
      }
      out.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
      if (filter?.limit !== undefined) return out.slice(0, filter.limit);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — host wires drizzle at composition root
// ---------------------------------------------------------------------------

export interface SqlCausalRunDriver {
  query(args: {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface SqlCausalRunRepoDeps {
  readonly driver: SqlCausalRunDriver;
  readonly now?: () => Date;
}

function rowToRecord(r: Record<string, unknown>): CausalRunRecord {
  const ranAtRaw = r['ran_at'];
  const ranAt =
    ranAtRaw instanceof Date ? ranAtRaw : new Date(String(ranAtRaw));
  return Object.freeze({
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    question: String(r['question']),
    treatment: String(r['treatment']),
    outcome: String(r['outcome']),
    identification: String(r['identification']) as IdentificationStrategy,
    effectEstimate: Number(r['effect_estimate']),
    ciLow: Number(r['ci_low']),
    ciHigh: Number(r['ci_high']),
    ranAt,
    prevHash: String(r['prev_hash'] ?? ''),
    auditHash: String(r['audit_hash']),
  });
}

export function createSqlCausalRunRepository(
  deps: SqlCausalRunRepoDeps,
): CausalRunRepository {
  const now = deps.now ?? (() => new Date());
  return {
    async insert(input) {
      const ranAt = now();
      const prevRows = await deps.driver.query({
        text:
          'SELECT audit_hash FROM causal_runs WHERE tenant_id = $1 ORDER BY ran_at DESC LIMIT 1',
        values: [input.tenantId],
      });
      const prevHash =
        prevRows.length === 0 ? '' : String((prevRows[0] as Record<string, unknown>)['audit_hash']);
      const auditHash = chainHash({
        prev: prevHash === '' ? GENESIS_HASH : prevHash,
        payload: {
          op: 'insert',
          tenantId: input.tenantId,
          question: input.question,
          treatment: input.treatment,
          outcome: input.outcome,
          identification: input.identification,
          effectEstimate: input.effectEstimate,
          ciLow: input.ciLow,
          ciHigh: input.ciHigh,
          ranAt: ranAt.toISOString(),
        },
      });
      const inserted = await deps.driver.query({
        text:
          'INSERT INTO causal_runs (tenant_id, question, treatment, outcome, identification, effect_estimate, ci_low, ci_high, ran_at, prev_hash, audit_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
        values: [
          input.tenantId,
          input.question,
          input.treatment,
          input.outcome,
          input.identification,
          input.effectEstimate,
          input.ciLow,
          input.ciHigh,
          ranAt,
          prevHash,
          auditHash,
        ],
      });
      const row = inserted[0];
      if (row === undefined) {
        throw new Error('causal_runs: insert returned no rows');
      }
      return rowToRecord(row);
    },

    async findById(tenantId, id) {
      const rows = await deps.driver.query({
        text: 'SELECT * FROM causal_runs WHERE tenant_id = $1 AND id = $2',
        values: [tenantId, id],
      });
      if (rows.length === 0) return null;
      const first = rows[0];
      if (first === undefined) return null;
      return rowToRecord(first);
    },

    async listForTenant(tenantId, filter) {
      const parts: string[] = ['SELECT * FROM causal_runs WHERE tenant_id = $1'];
      const values: unknown[] = [tenantId];
      if (filter?.identification !== undefined) {
        parts.push(`AND identification = $${values.length + 1}`);
        values.push(filter.identification);
      }
      parts.push('ORDER BY ran_at DESC');
      if (filter?.limit !== undefined) {
        parts.push(`LIMIT $${values.length + 1}`);
        values.push(filter.limit);
      }
      const rows = await deps.driver.query({
        text: parts.join(' '),
        values,
      });
      return rows.map(rowToRecord);
    },
  };
}
