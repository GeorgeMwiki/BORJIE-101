/**
 * SQL-backed `TacitInterviewRepository`.
 *
 * Wave HARVEST. Issues parameterised SQL against the
 * `tacit_interviews` table created by migration
 * `0044_tacit_knowledge.sql`. Goes through the `SqlRunner` port — the
 * package never imports drizzle or pg directly.
 *
 * `location_geog` is round-tripped as the canonical EWKT
 * `POINT(lng lat)` form; pgsql's `ST_AsText` / `ST_GeogFromText`
 * functions handle the conversion. Null is passed straight through.
 */

import type {
  GeoPoint,
  Interview,
  InterviewMode,
  InterviewStatus,
  TacitInterviewRepository,
  TranscriptTurn,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

interface RawRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly tenant_id: string;
  readonly subject_user_id: string;
  readonly interviewer: string;
  readonly mode: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly status: string;
  readonly transcript: string;
  readonly location_geog_text: string | null;
  readonly audit_hash: string;
  readonly prev_hash: string;
}

function parsePoint(text: string | null): GeoPoint | null {
  if (text === null || text === '') return null;
  const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(text);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return { lng: Number(match[1]), lat: Number(match[2]) };
}

function serialisePoint(point: GeoPoint | null | undefined): string | null {
  if (point === null || point === undefined) return null;
  return `POINT(${point.lng} ${point.lat})`;
}

function mapRow(row: RawRow): Interview {
  const transcriptParsed = JSON.parse(row.transcript) as ReadonlyArray<TranscriptTurn>;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    subjectUserId: row.subject_user_id,
    interviewer: row.interviewer,
    mode: row.mode as InterviewMode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as InterviewStatus,
    transcript: Object.freeze([...transcriptParsed]),
    locationGeog: parsePoint(row.location_geog_text),
    auditHash: row.audit_hash,
    prevHash: row.prev_hash,
  });
}

export function createSqlTacitInterviewRepository(
  runner: SqlRunner,
): TacitInterviewRepository {
  return {
    async insert(row: Interview): Promise<Interview> {
      const geogText = serialisePoint(row.locationGeog);
      const sql = `
        INSERT INTO tacit_interviews (
          id, tenant_id, subject_user_id, interviewer, mode,
          started_at, ended_at, status, transcript,
          location_geog, audit_hash, prev_hash
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9::jsonb,
          CASE WHEN $10::text IS NULL THEN NULL ELSE ST_GeogFromText('SRID=4326;' || $10) END,
          $11, $12
        )
        RETURNING
          id, tenant_id, subject_user_id, interviewer, mode,
          started_at, ended_at, status, transcript::text AS transcript,
          ST_AsText(location_geog) AS location_geog_text,
          audit_hash, prev_hash
      `;
      const result = await runner.execute<RawRow>(sql, [
        row.id,
        row.tenantId,
        row.subjectUserId,
        row.interviewer,
        row.mode,
        row.startedAt,
        row.endedAt,
        row.status,
        JSON.stringify(row.transcript),
        geogText,
        row.auditHash,
        row.prevHash,
      ]);
      const head = result[0];
      if (head === undefined) {
        throw new Error('tacit_interviews insert returned no row');
      }
      return mapRow(head);
    },

    async read(id: string, tenantId: string): Promise<Interview | null> {
      const sql = `
        SELECT
          id, tenant_id, subject_user_id, interviewer, mode,
          started_at, ended_at, status, transcript::text AS transcript,
          ST_AsText(location_geog) AS location_geog_text,
          audit_hash, prev_hash
        FROM tacit_interviews
        WHERE id = $1 AND tenant_id = $2
      `;
      const rs = await runner.execute<RawRow>(sql, [id, tenantId]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },

    async appendTurn(
      id: string,
      tenantId: string,
      turn: TranscriptTurn,
    ): Promise<Interview | null> {
      const sql = `
        UPDATE tacit_interviews
        SET transcript = transcript || $3::jsonb
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, tenant_id, subject_user_id, interviewer, mode,
          started_at, ended_at, status, transcript::text AS transcript,
          ST_AsText(location_geog) AS location_geog_text,
          audit_hash, prev_hash
      `;
      const rs = await runner.execute<RawRow>(sql, [
        id,
        tenantId,
        JSON.stringify([turn]),
      ]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },

    async setStatus(
      id: string,
      tenantId: string,
      status: InterviewStatus,
      endedAt: string,
    ): Promise<Interview | null> {
      const sql = `
        UPDATE tacit_interviews
        SET status = $3, ended_at = $4
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, tenant_id, subject_user_id, interviewer, mode,
          started_at, ended_at, status, transcript::text AS transcript,
          ST_AsText(location_geog) AS location_geog_text,
          audit_hash, prev_hash
      `;
      const rs = await runner.execute<RawRow>(sql, [
        id,
        tenantId,
        status,
        endedAt,
      ]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },
  };
}
