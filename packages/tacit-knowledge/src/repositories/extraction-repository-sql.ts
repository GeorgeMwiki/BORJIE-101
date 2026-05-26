/**
 * SQL-backed `TacitExtractionRepository`.
 *
 * Wave HARVEST. Issues parameterised SQL against the
 * `tacit_extractions` table created by migration
 * `0044_tacit_knowledge.sql`.
 */

import type {
  EntityKind,
  Extraction,
  ExtractionEntity,
  TacitExtractionRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

interface RawRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly interview_id: string;
  readonly tenant_id: string;
  readonly entity_kind: string;
  readonly entity: string;
  readonly confidence: number;
  readonly novel: boolean;
  readonly redundant_with_cell_id: string | null;
  readonly persisted_cell_id: string | null;
  readonly created_at: string;
  readonly audit_hash: string;
}

function mapRow(row: RawRow): Extraction {
  const parsed = JSON.parse(row.entity) as ExtractionEntity;
  return Object.freeze({
    id: row.id,
    interviewId: row.interview_id,
    tenantId: row.tenant_id,
    entityKind: row.entity_kind as EntityKind,
    entity: Object.freeze({
      text: parsed.text,
      structured: Object.freeze({ ...parsed.structured }),
      citations: Object.freeze([...parsed.citations]),
    }),
    confidence: row.confidence,
    novel: row.novel,
    redundantWithCellId: row.redundant_with_cell_id,
    persistedCellId: row.persisted_cell_id,
    createdAt: row.created_at,
    auditHash: row.audit_hash,
  });
}

export function createSqlTacitExtractionRepository(
  runner: SqlRunner,
): TacitExtractionRepository {
  return {
    async insert(row: Extraction): Promise<Extraction> {
      const sql = `
        INSERT INTO tacit_extractions (
          id, interview_id, tenant_id, entity_kind, entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb,
          $6, $7, $8, $9, $10, $11
        )
        RETURNING
          id, interview_id, tenant_id, entity_kind, entity::text AS entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
      `;
      const rs = await runner.execute<RawRow>(sql, [
        row.id,
        row.interviewId,
        row.tenantId,
        row.entityKind,
        JSON.stringify(row.entity),
        row.confidence,
        row.novel,
        row.redundantWithCellId,
        row.persistedCellId,
        row.createdAt,
        row.auditHash,
      ]);
      const head = rs[0];
      if (head === undefined) {
        throw new Error('tacit_extractions insert returned no row');
      }
      return mapRow(head);
    },

    async read(id: string, tenantId: string): Promise<Extraction | null> {
      const sql = `
        SELECT
          id, interview_id, tenant_id, entity_kind, entity::text AS entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
        FROM tacit_extractions
        WHERE id = $1 AND tenant_id = $2
      `;
      const rs = await runner.execute<RawRow>(sql, [id, tenantId]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },

    async listForInterview(
      interviewId: string,
      tenantId: string,
    ): Promise<ReadonlyArray<Extraction>> {
      const sql = `
        SELECT
          id, interview_id, tenant_id, entity_kind, entity::text AS entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
        FROM tacit_extractions
        WHERE interview_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC
      `;
      const rs = await runner.execute<RawRow>(sql, [interviewId, tenantId]);
      return Object.freeze(rs.map(mapRow));
    },

    async setRedundantWith(
      id: string,
      tenantId: string,
      cellId: string,
    ): Promise<Extraction | null> {
      const sql = `
        UPDATE tacit_extractions
        SET redundant_with_cell_id = $3, novel = FALSE
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, interview_id, tenant_id, entity_kind, entity::text AS entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
      `;
      const rs = await runner.execute<RawRow>(sql, [id, tenantId, cellId]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },

    async setPersisted(
      id: string,
      tenantId: string,
      cellId: string,
    ): Promise<Extraction | null> {
      const sql = `
        UPDATE tacit_extractions
        SET persisted_cell_id = $3
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, interview_id, tenant_id, entity_kind, entity::text AS entity,
          confidence, novel, redundant_with_cell_id,
          persisted_cell_id, created_at, audit_hash
      `;
      const rs = await runner.execute<RawRow>(sql, [id, tenantId, cellId]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },
  };
}
