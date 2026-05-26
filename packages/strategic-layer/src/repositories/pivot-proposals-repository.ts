/**
 * Repository for `pivot_proposals` (in-memory + SQL adapters).
 */

import {
  type PivotProposal,
  type PivotProposalsRepository,
  type PivotStatus,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryPivotProposalsRepository(): PivotProposalsRepository {
  const rows = new Map<string, PivotProposal>();

  return {
    async insert(row: PivotProposal): Promise<PivotProposal> {
      const frozen = Object.freeze({ ...row });
      rows.set(frozen.id, frozen);
      return frozen;
    },

    async findById(
      tenantId: string,
      id: string,
    ): Promise<PivotProposal | null> {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async updateStatus(
      tenantId: string,
      id: string,
      status: PivotStatus,
      decidedBy: string | null,
      decidedAt: string | null,
      auditHash: string,
    ): Promise<PivotProposal> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        throw new Error(`Pivot not found: tenant=${tenantId} id=${id}`);
      }
      const updated: PivotProposal = Object.freeze({
        ...existing,
        status,
        decidedBy,
        decidedAt,
        auditHash,
      });
      rows.set(id, updated);
      return updated;
    },

    async latestOpenForObjective(
      tenantId: string,
      objectiveId: string,
    ): Promise<PivotProposal | null> {
      let latest: PivotProposal | null = null;
      for (const row of rows.values()) {
        if (
          row.tenantId !== tenantId ||
          row.objectiveId !== objectiveId ||
          row.status !== 'open'
        ) {
          continue;
        }
        if (
          latest === null ||
          new Date(row.proposedAt).getTime() >
            new Date(latest.proposedAt).getTime()
        ) {
          latest = row;
        }
      }
      return latest;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

interface SqlPivotRow {
  readonly id: string;
  readonly objective_id: string;
  readonly tenant_id: string;
  readonly proposed_at: Date | string;
  readonly rationale: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly status: string;
  readonly decided_by: string | null;
  readonly decided_at: Date | string | null;
  readonly audit_hash: string;
}

export function createSqlPivotProposalsRepository(
  sql: SqlRunner,
): PivotProposalsRepository {
  return {
    async insert(row: PivotProposal): Promise<PivotProposal> {
      await sql.query(
        `INSERT INTO pivot_proposals
           (id, objective_id, tenant_id, proposed_at, rationale,
            evidence, status, decided_by, decided_at, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          row.id,
          row.objectiveId,
          row.tenantId,
          row.proposedAt,
          row.rationale,
          JSON.stringify(row.evidence),
          row.status,
          row.decidedBy,
          row.decidedAt,
          row.auditHash,
        ],
      );
      return row;
    },

    async findById(
      tenantId: string,
      id: string,
    ): Promise<PivotProposal | null> {
      const result = await sql.query<SqlPivotRow>(
        `SELECT * FROM pivot_proposals
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },

    async updateStatus(
      tenantId: string,
      id: string,
      status: PivotStatus,
      decidedBy: string | null,
      decidedAt: string | null,
      auditHash: string,
    ): Promise<PivotProposal> {
      const result = await sql.query<SqlPivotRow>(
        `UPDATE pivot_proposals
            SET status = $3,
                decided_by = $4,
                decided_at = $5,
                audit_hash = $6
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [tenantId, id, status, decidedBy, decidedAt, auditHash],
      );
      const first = result.rows[0];
      if (first === undefined) {
        throw new Error(
          `Pivot not found for updateStatus: tenant=${tenantId} id=${id}`,
        );
      }
      return mapSqlRow(first);
    },

    async latestOpenForObjective(
      tenantId: string,
      objectiveId: string,
    ): Promise<PivotProposal | null> {
      const result = await sql.query<SqlPivotRow>(
        `SELECT * FROM pivot_proposals
          WHERE tenant_id = $1
            AND objective_id = $2
            AND status = 'open'
          ORDER BY proposed_at DESC
          LIMIT 1`,
        [tenantId, objectiveId],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },
  };
}

function mapSqlRow(row: SqlPivotRow): PivotProposal {
  return Object.freeze({
    id: row.id,
    objectiveId: row.objective_id,
    tenantId: row.tenant_id,
    proposedAt: typeof row.proposed_at === 'string'
      ? row.proposed_at
      : row.proposed_at.toISOString(),
    rationale: row.rationale,
    evidence: row.evidence,
    status: row.status as PivotStatus,
    decidedBy: row.decided_by,
    decidedAt:
      row.decided_at === null
        ? null
        : typeof row.decided_at === 'string'
          ? row.decided_at
          : row.decided_at.toISOString(),
    auditHash: row.audit_hash,
  });
}
